from __future__ import annotations

import math
import os
import sys
from datetime import datetime, timezone
from itertools import combinations
from pathlib import Path
from typing import Any

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

PROJECT_ROOT = Path(__file__).resolve().parents[2]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from agent.correlation_engine import CorrelationEngine
from agent.price_client import PriceClient
from agent.reputation_reader import ReputationReader
from config.settings import ASSETS, LIVE_ASSETS, LOOKBACK_DAYS, ZSCORE_THRESHOLD

DATA_DIR = PROJECT_ROOT / "data"
TRADES_FILE = DATA_DIR / "pending_trades.json"
BASESCAN_TX_URL = "https://sepolia.etherscan.io/tx/"


class DashboardState:
    def __init__(self):
        self.assets = [asset for asset in LIVE_ASSETS if asset in ASSETS] or list(ASSETS)
        self.prism = PriceClient()
        self.engine = CorrelationEngine(lookback_days=LOOKBACK_DAYS, zscore_threshold=ZSCORE_THRESHOLD)
        self.reputation = ReputationReader()
        self.seeded = False
        self.last_update_time = 0.0

    def seed_history(self):
        if self.seeded:
            return

        import time
        for asset in self.assets:
            prices = self.prism.get_price_history(asset, days=LOOKBACK_DAYS)
            if prices:
                self.engine.load_history(asset, prices)
            time.sleep(1.5)

        self.seeded = True


state = DashboardState()
app = FastAPI(title="HedgeFlow Dashboard API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def on_startup() -> None:
    state.seed_history()


def _pick(source: dict[str, Any], keys: list[str], default: Any = None) -> Any:
    for key in keys:
        value = source.get(key)
        if value is not None:
            return value
    return default


def _load_trades() -> list[dict[str, Any]]:
    if not TRADES_FILE.exists():
        return []

    try:
        import json

        with TRADES_FILE.open("r", encoding="utf-8") as file:
            loaded = json.load(file)
            if isinstance(loaded, list):
                return loaded
            return []
    except Exception:
        return []


def _extract_tx_hashes(trade: dict[str, Any]) -> list[str]:
    tx_hashes: list[str] = []
    for leg in trade.get("executionResults", []):
        tx_hash = (leg.get("submit") or {}).get("txHash")
        if isinstance(tx_hash, str) and tx_hash:
            tx_hashes.append(tx_hash)
    return tx_hashes


def _format_trade(trade: dict[str, Any]) -> dict[str, Any]:
    signal = trade.get("signal") or {}
    decision = trade.get("decision") or {}
    tx_hashes = _extract_tx_hashes(trade)

    action_a = str(_pick(decision, ["action_a", "actionA"], "")).upper()
    action_b = str(_pick(decision, ["action_b", "actionB"], "")).upper()

    return {
        "id": trade.get("id"),
        "timestamp": trade.get("timestamp"),
        "updatedAt": trade.get("updatedAt"),
        "status": trade.get("status", "UNKNOWN"),
        "assetA": _pick(signal, ["assetA", "asset_a"], ""),
        "assetB": _pick(signal, ["assetB", "asset_b"], ""),
        "zScore": float(_pick(signal, ["zScore", "z_score"], 0) or 0),
        "currentCorrelation": float(
            _pick(signal, ["currentCorrelation", "current_correlation"], 0) or 0
        ),
        "sizeUsd": float(_pick(decision, ["size_usd", "sizeUsd"], 0) or 0),
        "confidence": float(_pick(decision, ["confidence"], 0) or 0),
        "actionA": action_a,
        "actionB": action_b,
        "txHashes": tx_hashes,
        "basescanUrls": [f"{BASESCAN_TX_URL}{tx_hash}" for tx_hash in tx_hashes],
        "settled": bool(trade.get("settled", False)),
        "pnlUsd": float((trade.get("settlement") or {}).get("pnlUsd", 0) or 0),
        "reasoningHash": _pick(decision, ["reasoning_hash", "reasoningHash"], ""),
    }


def _compute_performance(trades: list[dict[str, Any]]) -> dict[str, Any]:
    settled = [trade for trade in trades if trade.get("settled") and trade.get("settlement")]
    pnls = [float((trade.get("settlement") or {}).get("pnlUsd", 0) or 0) for trade in settled]

    if not pnls:
        return {
            "tradeCount": 0,
            "winRate": 0,
            "totalPnlUsd": 0,
            "avgPnlUsd": 0,
            "stdPnlUsd": 0,
            "sharpe": 0,
        }

    trade_count = len(pnls)
    wins = sum(1 for pnl in pnls if pnl > 0)
    total_pnl = sum(pnls)
    avg_pnl = total_pnl / trade_count
    variance = sum((pnl - avg_pnl) ** 2 for pnl in pnls) / trade_count
    std_pnl = math.sqrt(variance)
    sharpe = avg_pnl / std_pnl if std_pnl > 0 else 0.0

    return {
        "tradeCount": trade_count,
        "winRate": round((wins / trade_count) * 100, 2),
        "totalPnlUsd": round(total_pnl, 6),
        "avgPnlUsd": round(avg_pnl, 6),
        "stdPnlUsd": round(std_pnl, 6),
        "sharpe": round(sharpe, 6),
    }


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/agent")
def get_agent() -> dict[str, Any]:
    stats = state.reputation.get_full_stats()
    paused, paused_until = state.reputation.is_paused()

    paused_iso = None
    if paused and paused_until > 0:
        paused_iso = datetime.fromtimestamp(paused_until, tz=timezone.utc).isoformat()

    return {
        "agentId": int(os.getenv("AGENT_NFT_ID", "0") or 0),
        "agentWallet": os.getenv("AGENT_WALLET_ADDRESS", ""),
        "assets": state.assets,
        "strategy": "Correlation Arbitrage",
        "repScore": int(stats.get("rep_score", 50) or 50),
        "totalTrades": int(stats.get("total_trades", 0) or 0),
        "winningTrades": int(stats.get("winning_trades", 0) or 0),
        "losingTrades": int(stats.get("losing_trades", 0) or 0),
        "totalPnlUsd": float(stats.get("total_pnl_usd", 0.0) or 0.0),
        "positionMultiplier": state.reputation.get_position_multiplier(),
        "isPaused": paused,
        "pausedUntil": paused_until,
        "pausedUntilIso": paused_iso,
        "circuitBreaker": {
            "maxConsecutiveLosses": int(os.getenv("CIRCUIT_BREAKER_MAX_CONSECUTIVE_LOSSES", "3") or 3),
            "pauseSeconds": int(os.getenv("CIRCUIT_BREAKER_PAUSE_SECONDS", "3600") or 3600),
        },
    }


@app.get("/api/correlations")
def get_correlations() -> Any:
    prices = state.prism.get_all_prices(state.assets, save_history=False)
    if not prices:
        return JSONResponse(status_code=503, content={"error": "Could not fetch prices"})

    import time
    if time.time() - state.last_update_time >= 300:
        state.engine.update_prices(prices)
        state.last_update_time = time.time()

    rows: list[dict[str, Any]] = []
    signals: list[dict[str, Any]] = []

    for asset_a, asset_b in combinations(state.assets, 2):
        result = state.engine.compute_zscore(asset_a, asset_b)
        if result is None:
            continue

        current_corr = float(result["current_correlation"])
        hist_mean = float(result["historical_mean"])
        z_score = float(result["z_score"])

        row = {
            "pair": f"{asset_a}/{asset_b}",
            "assetA": asset_a,
            "assetB": asset_b,
            "currentCorrelation": round(current_corr, 4),
            "historicalMean": round(hist_mean, 4),
            "zScore": round(z_score, 4),
            "isSignal": abs(z_score) >= ZSCORE_THRESHOLD,
        }
        rows.append(row)

        if row["isSignal"]:
            signals.append(row)

    signals.sort(key=lambda item: abs(item["zScore"]), reverse=True)

    return {
        "assets": state.assets,
        "prices": prices,
        "rows": rows,
        "activeSignals": signals,
        "threshold": ZSCORE_THRESHOLD,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


@app.get("/api/trades")
def get_trades() -> dict[str, Any]:
    trades = _load_trades()
    formatted = [_format_trade(trade) for trade in reversed(trades[-100:])]
    return {
        "total": len(trades),
        "items": formatted,
    }


@app.get("/api/trades/{trade_id}")
def get_trade_by_id(trade_id: str) -> Any:
    trades = _load_trades()

    for trade in trades:
        if str(trade.get("id", "")) == trade_id:
            formatted = _format_trade(trade)

            # Attach additional raw fields for the trade detail page
            decision = trade.get("decision") or {}
            signal = trade.get("signal") or {}
            settlement = trade.get("settlement") or {}

            formatted["historicalMean"] = float(
                _pick(signal, ["historicalMean", "historical_mean"], 0) or 0
            )
            formatted["reasoningText"] = _pick(
                decision, ["reasoning_text", "reasoningText", "reasoning"], ""
            )
            formatted["checkpointHash"] = _pick(
                trade, ["checkpointHash", "checkpoint_hash"], ""
            )
            formatted["attestationScore"] = int(
                _pick(trade, ["attestationScore", "attestation_score"], 0) or 0
            )
            formatted["nonce"] = _pick(trade, ["nonce"], "")
            formatted["deadline"] = _pick(trade, ["deadline"], "")
            formatted["agentId"] = int(os.getenv("AGENT_NFT_ID", "0") or 0)
            formatted["settlement"] = {
                "pnlUsd": float(settlement.get("pnlUsd", 0) or 0),
                "entryPrice": settlement.get("entryPrice"),
                "exitPrice": settlement.get("exitPrice"),
                "method": settlement.get("method", "mark-to-market"),
            }

            return formatted

    return JSONResponse(status_code=404, content={"error": f"Trade {trade_id} not found"})


@app.get("/api/performance")
def get_performance() -> dict[str, Any]:
    trades = _load_trades()
    return _compute_performance(trades)
