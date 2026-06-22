import json
import logging
import os
import time
from datetime import datetime, timezone
from pathlib import Path

import schedule
from colorama import Fore, Style, init

from agent.apify_client import ApifyMacroClient
from agent.correlation_engine import CorrelationEngine
from agent.llm_reasoner import decide_trade
from agent.price_client import PriceClient
from agent.reputation_reader import ReputationReader
from config.settings import (
    ASSETS,
    CHECK_INTERVAL_MIN,
    DISABLE_HARDENING_GATES,
    LIVE_ASSETS,
    LOG_FILE,
    LOOKBACK_DAYS,
    MAX_POSITION_USD,
    MIN_ABS_ZSCORE_LIVE,
    MIN_LLM_CONFIDENCE,
    MIN_SIGNAL_CONFIDENCE,
    PAIR_DISABLE_EXPECTANCY_USD,
    PAIR_DISABLE_MIN_TRADES,
    ZSCORE_THRESHOLD,
)

init(autoreset=True)

PROJECT_ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = PROJECT_ROOT / "data"
LOGS_DIR = PROJECT_ROOT / "logs"

LOGS_DIR.mkdir(parents=True, exist_ok=True)
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    handlers=[logging.FileHandler(PROJECT_ROOT / LOG_FILE), logging.StreamHandler()],
)
logger = logging.getLogger("signal_monitor")


class SignalMonitor:
    """Main orchestration loop for signal detection and trade decisioning."""

    def __init__(self):
        self.active_assets = [asset for asset in LIVE_ASSETS if asset in ASSETS] or list(ASSETS)
        self.prism = PriceClient()
        self.apify = ApifyMacroClient()
        self.engine = CorrelationEngine(
            lookback_days=LOOKBACK_DAYS,
            zscore_threshold=ZSCORE_THRESHOLD,
        )
        self.rep_reader = ReputationReader()
        self.cycle_count = 0
        self.total_signals_found = 0
        self.total_trades_triggered = 0

        self.agent_reputation = 50
        self.portfolio_value = 1000.0
        self.recent_pnl: list[float] = []

        self._seed_history()

    def _seed_history(self):
        """Load startup history so the engine can compute signals quickly."""
        logger.info("Seeding historical price data from PRISM")

        for asset in self.active_assets:
            prices = self.prism.get_price_history(asset, days=LOOKBACK_DAYS)
            if prices and len(prices) > 10:
                self.engine.load_history(asset, prices)
                logger.info("%s loaded with %s points", asset, len(prices))
            else:
                logger.warning("%s has insufficient history (%s points)", asset, len(prices))
            time.sleep(1.5)

    @staticmethod
    def _pair_key(asset_a: str, asset_b: str) -> str:
        return "/".join(sorted([asset_a.upper(), asset_b.upper()]))

    def _get_disabled_pairs(self) -> set[str]:
        state_path = DATA_DIR / "reputation_state.json"
        if not state_path.exists():
            return set()

        try:
            state = json.loads(state_path.read_text(encoding="utf-8"))
        except Exception as exc:
            logger.warning("Failed to read local reputation state for pair stats: %s", exc)
            return set()

        outcomes = state.get("outcomes", [])
        pair_stats: dict[str, dict[str, float]] = {}

        for outcome in outcomes:
            metadata = outcome.get("metadata", {})
            pair = metadata.get("pair")
            pnl = outcome.get("pnlUsd")
            if not pair or pnl is None:
                continue

            stats = pair_stats.setdefault(pair, {"trades": 0, "sum_pnl": 0.0})
            stats["trades"] += 1
            stats["sum_pnl"] += float(pnl)

        disabled: set[str] = set()
        for pair, stats in pair_stats.items():
            trades = int(stats["trades"])
            avg_pnl = float(stats["sum_pnl"]) / max(1, trades)
            if trades >= PAIR_DISABLE_MIN_TRADES and avg_pnl <= PAIR_DISABLE_EXPECTANCY_USD:
                disabled.add(pair)

        return disabled

    def run_cycle(self):
        """Run one monitoring cycle."""
        self.cycle_count += 1
        timestamp = datetime.now(timezone.utc).isoformat()

        print(f"\n{Fore.CYAN}{'=' * 60}")
        print(f"CYCLE #{self.cycle_count} | {timestamp}")
        print(f"{'=' * 60}{Style.RESET_ALL}")

        paused, paused_until = self.rep_reader.is_paused()
        if paused:
            until_dt = datetime.fromtimestamp(paused_until, tz=timezone.utc).isoformat()
            logger.warning("Circuit breaker pause active until %s", until_dt)
            print(f"{Fore.RED}Circuit breaker pause active until {until_dt}{Style.RESET_ALL}")
            return

        self.agent_reputation = self.rep_reader.get_reputation_score()
        position_multiplier = self.rep_reader.get_position_multiplier()
        stats = self.rep_reader.get_full_stats()
        disabled_pairs = self._get_disabled_pairs()

        print(
            f"{Fore.MAGENTA}[Rep] score={self.agent_reputation}/100 "
            f"| mult={position_multiplier:.2f}x "
            f"| trades={stats['total_trades']} "
            f"| wins={stats['winning_trades']} "
            f"| pnl=${stats['total_pnl_usd']:.2f}{Style.RESET_ALL}"
        )
        if disabled_pairs:
            print(f"{Fore.MAGENTA}[Risk] Disabled pairs: {', '.join(sorted(disabled_pairs))}{Style.RESET_ALL}")

        print(f"{Fore.YELLOW}[1/4] Fetching prices from PRISM...{Style.RESET_ALL}")
        prices = self.prism.get_all_prices(self.active_assets)
        if not prices:
            logger.error("Failed to fetch prices. Skipping cycle.")
            return

        for asset, price in prices.items():
            print(f"  {asset}: ${price:,.4f}")

        self.engine.update_prices(prices)

        pair_count = len(self.active_assets) * (len(self.active_assets) - 1) // 2
        print(f"\n{Fore.YELLOW}[2/4] Scanning {pair_count} pairs...{Style.RESET_ALL}")
        signals = self.engine.scan_all_pairs(self.active_assets, prices)

        if not signals:
            print(f"  {Fore.GREEN}No signals this cycle. Correlations are normal.{Style.RESET_ALL}")
            return

        if DISABLE_HARDENING_GATES:
            filtered_signals = list(signals)
        else:
            filtered_signals = [
                signal
                for signal in signals
                if abs(signal.z_score) >= MIN_ABS_ZSCORE_LIVE
                and signal.confidence >= MIN_SIGNAL_CONFIDENCE
                and self._pair_key(signal.asset_a, signal.asset_b) not in disabled_pairs
            ]

        if not filtered_signals:
            reasons = {"zscore": 0, "signal_conf": 0, "pair_disabled": 0}
            for signal in signals:
                if abs(signal.z_score) < MIN_ABS_ZSCORE_LIVE:
                    reasons["zscore"] += 1
                if signal.confidence < MIN_SIGNAL_CONFIDENCE:
                    reasons["signal_conf"] += 1
                if self._pair_key(signal.asset_a, signal.asset_b) in disabled_pairs:
                    reasons["pair_disabled"] += 1

            print(
                f"  {Fore.YELLOW}Signals found but all filtered by hardening gates "
                f"(min|z|={MIN_ABS_ZSCORE_LIVE}, min_conf={MIN_SIGNAL_CONFIDENCE}; "
                f"z_fails={reasons['zscore']}, conf_fails={reasons['signal_conf']}, "
                f"pair_disabled={reasons['pair_disabled']}).{Style.RESET_ALL}"
            )
            return

        self.total_signals_found += len(filtered_signals)
        print(f"  {Fore.RED}Found {len(filtered_signals)} eligible signal(s){Style.RESET_ALL}")
        for signal in filtered_signals:
            print(
                f"  -> {signal.asset_a}/{signal.asset_b} "
                f"| z={signal.z_score:.2f} "
                f"| corr={signal.current_correlation:.3f} "
                f"(hist={signal.historical_mean:.3f})"
            )

        best = self.engine.get_strongest_signal(filtered_signals)
        if best is None:
            return

        print(
            f"\n{Fore.YELLOW}[3/4] Best signal: {best.asset_a}/{best.asset_b} "
            f"(z={best.z_score:.2f}){Style.RESET_ALL}"
        )

        print(f"\n{Fore.YELLOW}[4/4] Asking LLM for trade decision...{Style.RESET_ALL}")
        macro_context = self.apify.fetch()
        logger.info(
            "Macro context: F&G=%s regime=%s sentiment=%s headlines=%d",
            macro_context.get("fear_greed"),
            macro_context.get("market_regime"),
            macro_context.get("news_sentiment"),
            len(macro_context.get("top_headlines", [])),
        )

        decision = decide_trade(
            signal=best,
            agent_reputation_score=self.agent_reputation,
            current_portfolio_value=self.portfolio_value,
            recent_trade_pnl=self.recent_pnl,
            macro_context=macro_context,
        )

        if decision.execute and decision.confidence < MIN_LLM_CONFIDENCE:
            decision.execute = False
            decision.skip_reason = (
                f"LLM confidence {decision.confidence:.2f} below min {MIN_LLM_CONFIDENCE:.2f}"
            )
            logger.info(decision.skip_reason)

        if decision.execute:
            max_allowed_size = MAX_POSITION_USD * position_multiplier
            if decision.size_usd > max_allowed_size:
                logger.info(
                    "Capping decision size from %.2f to %.2f due to reputation multiplier %.2fx",
                    decision.size_usd,
                    max_allowed_size,
                    position_multiplier,
                )
                decision.size_usd = max_allowed_size

            self.total_trades_triggered += 1
            print(f"\n{Fore.GREEN}EXECUTE TRADE{Style.RESET_ALL}")
            print(f"  {best.asset_a}: {decision.action_a}")
            print(f"  {best.asset_b}: {decision.action_b}")
            print(f"  Size: ${decision.size_usd:.0f}")
            print(f"  Reasoning hash: {decision.reasoning_hash}")
            self._save_pending_trade(best, decision)
        else:
            print(f"\n{Fore.YELLOW}SKIP: {decision.skip_reason}{Style.RESET_ALL}")

        print(
            f"\n{Fore.CYAN}Session stats: {self.cycle_count} cycles | "
            f"{self.total_signals_found} signals | "
            f"{self.total_trades_triggered} trades triggered{Style.RESET_ALL}"
        )

    def _save_pending_trade(self, signal, decision):
        """Persist pending trades for the future execution phase."""
        DATA_DIR.mkdir(parents=True, exist_ok=True)

        trade = {
            "id": f"trade_{self.cycle_count}_{int(time.time())}",
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "signal": signal.to_dict(),
            "decision": {
                "execute": decision.execute,
                "action_a": decision.action_a,
                "action_b": decision.action_b,
                "size_usd": decision.size_usd,
                "confidence": decision.confidence,
                "reasoning_text": decision.reasoning_text,
                "reasoning_hash": decision.reasoning_hash,
            },
            "status": "PENDING",
        }

        pending_file = DATA_DIR / "pending_trades.json"
        trades = []
        if pending_file.exists():
            with pending_file.open("r", encoding="utf-8") as f:
                trades = json.load(f)

        trades.append(trade)

        with pending_file.open("w", encoding="utf-8") as f:
            json.dump(trades, f, indent=2)

        logger.info("Trade saved to %s with id=%s", pending_file, trade["id"])

    def start(self):
        """Start scheduler loop."""
        print(f"\n{Fore.CYAN}Starting Correlation Arb Agent{Style.RESET_ALL}")
        print(f"Assets: {', '.join(self.active_assets)}")
        print(f"Z-score threshold: {ZSCORE_THRESHOLD}")
        print(
            "Hardening gates: "
            f"min|z|={MIN_ABS_ZSCORE_LIVE}, "
            f"min_signal_conf={MIN_SIGNAL_CONFIDENCE}, "
            f"min_llm_conf={MIN_LLM_CONFIDENCE}"
        )
        print(f"Hardening enabled: {not DISABLE_HARDENING_GATES}")
        print(f"Check interval: every {CHECK_INTERVAL_MIN} minutes")
        print(f"Lookback: {LOOKBACK_DAYS} days\n")

        self.run_cycle()

        schedule.every(CHECK_INTERVAL_MIN).minutes.do(self.run_cycle)

        print(f"\n{Fore.GREEN}Agent running. Press Ctrl+C to stop.{Style.RESET_ALL}")
        while True:
            schedule.run_pending()
            time.sleep(30)


if __name__ == "__main__":
    monitor = SignalMonitor()
    monitor.start()
