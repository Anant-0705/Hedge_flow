import asyncio
import json
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import APIRouter

from agent.correlation_engine import CorrelationSignal
from agent.llm_reasoner import decide_trade
from config.settings import MIN_ABS_ZSCORE_LIVE

demo_router = APIRouter()

PROJECT_ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = PROJECT_ROOT / "data"
TRADES_FILE = DATA_DIR / "pending_trades.json"
DEMO_TRADE_ID_FILE = DATA_DIR / "demo_trade_id.txt"

def _load_trades() -> list[dict[str, Any]]:
    if not TRADES_FILE.exists():
        return []
    try:
        with TRADES_FILE.open("r", encoding="utf-8") as f:
            loaded = json.load(f)
            return loaded if isinstance(loaded, list) else []
    except Exception:
        return []

def _save_trades(trades: list[dict[str, Any]]) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    with TRADES_FILE.open("w", encoding="utf-8") as f:
        json.dump(trades, f, indent=2)

@demo_router.post("/api/demo/start")
async def start_demo():
    from dashboard.backend.main import state

    steps = []

    def add_step(step_num: int, label: str, data: dict, completed: bool = True):
        steps.append({"step": step_num, "label": label, "data": data, "completed": completed})

    # Step 1: PRICE FEED
    asset_a, asset_b = "BTC", "ETH"
    prices = state.prism.get_all_prices([asset_a, asset_b], save_history=False)
    if not prices or asset_a not in prices or asset_b not in prices:
        prices = {asset_a: 67000.0, asset_b: 3500.0}
    
    price_a = prices[asset_a]
    price_b = prices[asset_b]
    add_step(1, "Fetching live prices", {"prices": prices})
    await asyncio.sleep(0.5)

    # Step 2: CORRELATION ENGINE
    # Fallback if engine is not seeded
    z_res = state.engine.compute_zscore(asset_a, asset_b)
    demo_forced = False
    if not z_res:
        demo_forced = True
        z_res = {
            "current_correlation": 0.65,
            "historical_mean": 0.95,
            "historical_std": 0.08,
            "z_score": -3.75,
        }
    add_step(2, "Computing 30-day Pearson correlation", {
        "current_correlation": z_res["current_correlation"],
        "historical_mean": z_res["historical_mean"],
        "demo_forced": demo_forced
    })
    await asyncio.sleep(0.5)

    # Step 3: Z-SCORE GATE
    z_score = z_res["z_score"]
    z_forced = False
    if abs(z_score) < MIN_ABS_ZSCORE_LIVE:
        z_score = 2.9 if z_score > 0 else -2.9
        z_forced = True
        
    add_step(3, "Measuring correlation deviation", {
        "z_score": z_score,
        "exceeds_threshold": True,
        "demo_forced": z_forced or demo_forced
    })
    await asyncio.sleep(0.5)

    # Step 4: COINTEGRATION GATE
    coint = state.engine.compute_cointegration(asset_a, asset_b)
    coint_forced = False
    if not coint or not coint.get("is_cointegrated"):
        coint_forced = True
        coint = {
            "is_cointegrated": True,
            "hedge_ratio": 15.2,
            "p_value": 0.01,
            "spread_zscore": -2.5
        }
        
    add_step(4, "Engle-Granger ADF test", {
        "hedge_ratio": coint["hedge_ratio"],
        "p_value": coint["p_value"],
        "spread_zscore": coint["spread_zscore"],
        "demo_forced": coint_forced
    })
    await asyncio.sleep(0.5)

    # Step 5: LLM REASONER
    direction = "CORR_BREAKDOWN" if z_score < 0 else "CORR_SPIKE"
    signal = CorrelationSignal(
        asset_a=asset_a,
        asset_b=asset_b,
        current_correlation=z_res["current_correlation"],
        historical_mean=z_res["historical_mean"],
        historical_std=z_res["historical_std"],
        z_score=z_score,
        direction=direction,
        confidence=0.85,
        timestamp=datetime.now(timezone.utc).isoformat(),
        lookback_days=90,
        price_a=price_a,
        price_b=price_b,
        hedge_ratio=coint["hedge_ratio"],
        cointegration_pvalue=coint["p_value"],
        spread_zscore=coint["spread_zscore"],
        is_cointegrated=True
    )
    
    decision = decide_trade(
        signal=signal,
        agent_reputation_score=state.reputation.get_full_stats().get("rep_score", 50),
        current_portfolio_value=10000.0,
        recent_trade_pnl=[],
        macro_context={}
    )
    
    # Guarantee the trade gets executed on-chain for the demo
    decision.execute = True
    
    trunc_reasoning = decision.reasoning_text[:200] + ("..." if len(decision.reasoning_text) > 200 else "")
    add_step(5, "Local LLM reasoning through signal", {
        "reasoning_text": trunc_reasoning,
        "confidence": decision.confidence,
        "execute": decision.execute
    })
    await asyncio.sleep(0.5)

    # Step 6: EIP-712 INTENT
    trade_id = str(uuid.uuid4())
    add_step(6, "Building signed TradeIntent", {
        "pair": f"{asset_a}/{asset_b}",
        "action_a": decision.action_a,
        "action_b": decision.action_b,
        "size_usd": decision.size_usd,
        "reasoning_hash": decision.reasoning_hash[:18] + "...",
        "nonce": trade_id,
        "deadline": int(time.time()) + 300
    })
    await asyncio.sleep(0.5)

    # Step 7: BLOCKCHAIN SUBMIT
    pending_trade = {
        "id": trade_id,
        "status": "PENDING",
        "timestamp": signal.timestamp,
        "updatedAt": signal.timestamp,
        "signal": signal.to_dict(),
        "decision": {
            "execute": decision.execute,
            "action_a": decision.action_a,
            "action_b": decision.action_b,
            "size_usd": decision.size_usd,
            "confidence": decision.confidence,
            "reasoning_text": decision.reasoning_text,
            "reasoning_hash": decision.reasoning_hash
        },
        "nonce": trade_id,
        "deadline": int(time.time()) + 300,
        "demo": True
    }
    trades = _load_trades()
    trades.append(pending_trade)
    _save_trades(trades)
    
    DEMO_TRADE_ID_FILE.write_text(trade_id)

    add_step(7, "Submitting to RiskRouter on Sepolia", {
        "trade_id": trade_id,
        "status": "pending_watcher"
    })
    await asyncio.sleep(0.5)

    # Step 8: SETTLEMENT
    add_step(8, "Mark-to-market settlement", {"status": "submitted, watcher will settle"})
    
    # Step 9: REPUTATION
    add_step(9, "Updating on-chain reputation", {"status": "submitted, watcher will settle"})

    return steps


@demo_router.get("/api/demo/status")
def get_demo_status():
    if not DEMO_TRADE_ID_FILE.exists():
        return {"status": "no_demo"}
    
    trade_id = DEMO_TRADE_ID_FILE.read_text().strip()
    trades = _load_trades()
    
    for t in trades:
        if t.get("id") == trade_id:
            tx_hashes = []
            for leg in t.get("executionResults", []):
                th = (leg.get("submit") or {}).get("txHash")
                if th:
                    tx_hashes.append(th)
                    
            return {
                "status": t.get("status", "PENDING"),
                "pnlUsd": (t.get("settlement") or {}).get("pnlUsd", 0),
                "txHashes": tx_hashes,
                "settlement": t.get("settlement")
            }
            
    return {"status": "no_demo"}


@demo_router.delete("/api/demo/reset")
def reset_demo():
    if DEMO_TRADE_ID_FILE.exists():
        DEMO_TRADE_ID_FILE.unlink()
    return {"ok": True}
