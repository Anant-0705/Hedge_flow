from dataclasses import dataclass
import hashlib
import json
import logging

# pyrefly: ignore [missing-import]
import groq

from agent.correlation_engine import CorrelationSignal
from config.settings import (
    GROQ_API_KEY,
    LLM_MODEL,
    MAX_POSITION_USD,
    MIN_POSITION_USD,
)

logger = logging.getLogger(__name__)


@dataclass
class TradeDecision:
    """Output of the LLM reasoner."""

    execute: bool
    action_a: str
    action_b: str
    size_usd: float
    confidence: float
    reasoning_text: str
    skip_reason: str
    reasoning_hash: str = ""


def _clamp(value: float, lower: float, upper: float) -> float:
    return max(lower, min(upper, value))


def _sanitize_trade_decision(decision: TradeDecision, max_size_usd: float) -> TradeDecision:
    action_a = str(decision.action_a or "LONG").upper()
    action_b = str(decision.action_b or "SHORT").upper()

    if action_a not in {"LONG", "SHORT"}:
        action_a = "LONG"
    if action_b not in {"LONG", "SHORT"}:
        action_b = "SHORT"

    if action_a == action_b:
        action_b = "SHORT" if action_a == "LONG" else "LONG"

    confidence = _clamp(float(decision.confidence), 0.0, 1.0)

    if decision.execute:
        size = _clamp(float(decision.size_usd), MIN_POSITION_USD, max_size_usd)
    else:
        size = max(0.0, float(decision.size_usd))

    return TradeDecision(
        execute=decision.execute,
        action_a=action_a,
        action_b=action_b,
        size_usd=size,
        confidence=confidence,
        reasoning_text=decision.reasoning_text,
        skip_reason=decision.skip_reason,
        reasoning_hash=decision.reasoning_hash,
    )


def compute_reasoning_hash(reasoning_text: str) -> str:
    """
    Return deterministic hash for reasoning text.
    Uses SHA-256 placeholder; swap for keccak256 in production chain integration.
    """
    encoded = reasoning_text.encode("utf-8")
    return "0x" + hashlib.sha256(encoded).hexdigest()


def _extract_json_text(raw: str) -> str:
    """Handle optional fenced JSON replies from the model."""
    stripped = raw.strip()
    if not stripped.startswith("```"):
        return stripped

    lines = stripped.splitlines()
    if len(lines) >= 2 and lines[0].startswith("```"):
        lines = lines[1:]
    if lines and lines[-1].strip() == "```":
        lines = lines[:-1]
    if lines and lines[0].strip().lower() == "json":
        lines = lines[1:]
    return "\n".join(lines).strip()


def decide_trade(
    signal: CorrelationSignal,
    agent_reputation_score: int,
    current_portfolio_value: float,
    recent_trade_pnl: list[float],
    macro_context: dict,
) -> TradeDecision:
    """Ask the LLM to decide whether to execute a correlation signal trade."""
    if not GROQ_API_KEY:
        reason = "Missing GROQ_API_KEY. Skipping trade for safety."
        logger.warning(reason)
        return TradeDecision(
            execute=False,
            action_a="LONG",
            action_b="SHORT",
            size_usd=0.0,
            confidence=0.0,
            reasoning_text=reason,
            skip_reason=reason,
            reasoning_hash=compute_reasoning_hash(reason),
        )

    rep_multiplier = max(0.0, min(1.0, agent_reputation_score / 100.0))
    base_size = MIN_POSITION_USD + (MAX_POSITION_USD - MIN_POSITION_USD) * rep_multiplier
    recent_pnl_str = ", ".join([f"${p:+.1f}" for p in recent_trade_pnl]) or "no recent trades"

    prompt = f"""You are the decision engine for a trustless correlation arbitrage trading agent.

Signal:
- Pair: {signal.asset_a} / {signal.asset_b}
- Current 30-day correlation: {signal.current_correlation:.4f}
- Historical mean correlation (90-day): {signal.historical_mean:.4f}
- Historical std deviation: {signal.historical_std:.4f}
- Correlation Z-score: {signal.z_score:.4f}
- Direction: {signal.direction}
- Signal confidence: {signal.confidence:.2f}
- Current {signal.asset_a} price: ${signal.price_a:,.2f}
- Current {signal.asset_b} price: ${signal.price_b:,.2f}

Cointegration (Engle-Granger ADF test — pair is mathematically verified):
- Spread Z-score: {signal.spread_zscore:.4f}  ← primary entry signal; how far spread is from equilibrium
- Hedge ratio β: {signal.hedge_ratio:.6f}  ← hold 1 unit {signal.asset_a}, hedge with β units {signal.asset_b}
- ADF p-value: {signal.cointegration_pvalue:.6f}  ← lower = stronger mean-reversion guarantee
- Cointegrated: {signal.is_cointegrated}

Agent state:
- Reputation score: {agent_reputation_score}/100
- Portfolio value: ${current_portfolio_value:,.2f}
- Recent trade PnL (last 5): {recent_pnl_str}
- Suggested position size: ${base_size:.0f}

Macro context:
- Fear and Greed Index: {macro_context.get('fear_greed', 'unknown')}
- BTC funding rate: {macro_context.get('btc_funding_rate', 'unknown')}
- Market regime: {macro_context.get('market_regime', 'unknown')}

Task:
1) Decide EXECUTE or SKIP.
2) If EXECUTE, pick LONG for one asset and SHORT for the other (always market-neutral pair).
3) Select a size in USD between {MIN_POSITION_USD} and {base_size:.0f}.
4) Explain reasoning clearly.
5) Use hedge ratio β for position sizing: leg B USD exposure ≈ β × leg A USD exposure.
6) Spread Z-score is the primary entry strength indicator.
   spread_zscore > 0: spread is above mean → short the spread → short {signal.asset_a}, long {signal.asset_b}.
   spread_zscore < 0: spread is below mean → long the spread → long {signal.asset_a}, short {signal.asset_b}.
   If spread_zscore direction conflicts with the direction field, flag it in reasoning and set execute=false.
7) If macro context fields are unknown, treat them as neutral and do not SKIP for that reason alone.
8) Do not apply any hidden confidence cutoff. Set execute=true when the signal is tradable; runtime gates will enforce final confidence thresholds.

Respond only in valid JSON with exactly this schema:
{{
  "execute": true,
  "action_a": "LONG",
  "action_b": "SHORT",
  "size_usd": 100,
  "confidence": 0.7,
  "reasoning": "text",
  "skip_reason": "text if skipped"
}}"""

    try:
        client = groq.Groq(api_key=GROQ_API_KEY)

        response = client.chat.completions.create(
            model=LLM_MODEL,
            max_tokens=1000,
            messages=[{"role": "user", "content": prompt}],
        )

        raw = response.choices[0].message.content.strip()
        data = json.loads(_extract_json_text(raw))

        reasoning_text = data.get("reasoning", "") or data.get("skip_reason", "")
        reasoning_hash = compute_reasoning_hash(
            f"{reasoning_text}|spread_z={signal.spread_zscore:.4f}|beta={signal.hedge_ratio:.6f}|coint_p={signal.cointegration_pvalue:.6f}"
        )

        decision = TradeDecision(
            execute=bool(data.get("execute", False)),
            action_a=data.get("action_a", "LONG"),
            action_b=data.get("action_b", "SHORT"),
            size_usd=float(data.get("size_usd", MIN_POSITION_USD)),
            confidence=float(data.get("confidence", 0.5)),
            reasoning_text=reasoning_text,
            skip_reason=data.get("skip_reason", ""),
            reasoning_hash=reasoning_hash,
        )
        decision = _sanitize_trade_decision(decision, base_size)

        logger.info(
            "LLM Decision %s size=$%.0f confidence=%.2f",
            "EXECUTE" if decision.execute else "SKIP",
            decision.size_usd,
            decision.confidence,
        )
        logger.info("Reasoning hash: %s", reasoning_hash)
        return decision

    except json.JSONDecodeError as exc:
        logger.error("Failed to parse LLM response as JSON: %s", exc)
        logger.error("Raw response: %s", raw)
        reason = "LLM parse error. Skipping trade for safety."
        return TradeDecision(
            execute=False,
            action_a="LONG",
            action_b="SHORT",
            size_usd=0.0,
            confidence=0.0,
            reasoning_text=reason,
            skip_reason=reason,
            reasoning_hash=compute_reasoning_hash(reason),
        )
    except Exception as exc:
        logger.error("LLM reasoner error: %s", exc)
        reason = f"LLM request error: {exc}"
        return TradeDecision(
            execute=False,
            action_a="LONG",
            action_b="SHORT",
            size_usd=0.0,
            confidence=0.0,
            reasoning_text=reason,
            skip_reason=reason,
            reasoning_hash=compute_reasoning_hash(reason),
        )
