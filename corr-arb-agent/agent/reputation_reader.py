import json
import logging
import os
import time
from pathlib import Path

try:
    from web3 import Web3
except Exception:  # pragma: no cover - optional fallback when web3 is not installed
    Web3 = None

logger = logging.getLogger(__name__)

REPUTATION_ABI = [
    {
        "inputs": [{"name": "agentId", "type": "uint256"}],
        "name": "getAverageScore",
        "outputs": [{"name": "", "type": "uint256"}],
        "stateMutability": "view",
        "type": "function",
    }
]

PROJECT_ROOT = Path(__file__).resolve().parents[1]
STATE_FILE = PROJECT_ROOT / "data" / "reputation_state.json"


class ReputationReader:
    """Read shared on-chain reputation and local circuit-breaker state."""

    def __init__(self):
        self.agent_id = int(os.getenv("AGENT_NFT_ID", "0"))
        self.registry = None

        if Web3 is None:
            logger.warning("web3 is not installed; using fallback reputation score=50")
            return

        rpc_url = os.getenv("RPC_URL", "https://ethereum-sepolia-rpc.publicnode.com")
        self.w3 = Web3(Web3.HTTPProvider(rpc_url))

        rep_addr = os.getenv(
            "REPUTATION_REGISTRY_ADDRESS",
            "0x423a9904e39537a9997fbaF0f220d79D7d545763",
        )

        try:
            self.registry = self.w3.eth.contract(
                address=Web3.to_checksum_address(rep_addr),
                abi=REPUTATION_ABI,
            )
        except Exception as exc:
            logger.warning("Could not initialize reputation registry contract: %s", exc)
            self.registry = None

    def _load_local_state(self) -> dict:
        if not STATE_FILE.exists():
            return {
                "isPaused": False,
                "pausedUntil": 0,
                "stats": {
                    "totalTrades": 0,
                    "winningTrades": 0,
                    "losingTrades": 0,
                    "totalPnlUsd": 0.0,
                    "consecutiveLosses": 0,
                },
            }

        try:
            with STATE_FILE.open("r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as exc:
            logger.warning("Could not read local reputation state: %s", exc)
            return {
                "isPaused": False,
                "pausedUntil": 0,
                "stats": {
                    "totalTrades": 0,
                    "winningTrades": 0,
                    "losingTrades": 0,
                    "totalPnlUsd": 0.0,
                    "consecutiveLosses": 0,
                },
            }

    def get_reputation_score(self) -> int:
        if self.registry is None:
            return 50

        try:
            score = self.registry.functions.getAverageScore(self.agent_id).call()
            return int(score)
        except Exception as exc:
            logger.warning("Could not read reputation score: %s", exc)
            return 50

    def get_position_multiplier(self) -> float:
        score = self.get_reputation_score()
        if score < 30:
            return 0.25
        if score < 60:
            return 0.50
        if score < 80:
            return 0.75
        return 1.0

    def is_paused(self) -> tuple[bool, int]:
        state = self._load_local_state()
        paused = bool(state.get("isPaused", False))
        until = int(state.get("pausedUntil", 0) or 0)

        if not paused:
            return False, 0

        now_ts = int(time.time())
        if until <= now_ts:
            return False, 0

        return True, until

    def get_full_stats(self) -> dict:
        state = self._load_local_state()
        stats = state.get("stats", {})

        return {
            "total_trades": int(stats.get("totalTrades", 0) or 0),
            "winning_trades": int(stats.get("winningTrades", 0) or 0),
            "losing_trades": int(stats.get("losingTrades", 0) or 0),
            "total_pnl_usd": float(stats.get("totalPnlUsd", 0.0) or 0.0),
            "rep_score": self.get_reputation_score(),
            "is_paused": bool(state.get("isPaused", False)),
            "consecutive_losses": int(stats.get("consecutiveLosses", 0) or 0),
        }
