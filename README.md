# HedgeFlow CorrArbAgent-v1

Trustless correlation-arbitrage agent for the ERC-8004 hackathon stack.

This project monitors multi-asset correlation dislocations, asks an LLM for market-neutral leg decisions, submits signed intents on shared hackathon contracts, posts validation attestations, and runs a local settler for strategy telemetry.

## Architecture

- `agent/signal_monitor.py`
  - Fetches prices from PRISM
  - Computes pair signals via z-score of rolling correlation
  - Applies hardening gates (asset allowlist, confidence thresholds, pair disable)
  - Writes `PENDING` trades to `data/pending_trades.json`

- `executor/trade_watcher.js`
  - Reads pending trades
  - Builds EIP-712 TradeIntent
  - Posts checkpoint attestation to `ValidationRegistry`
  - Simulates + submits intent to `RiskRouter`
  - Updates local trade status to `SUBMITTED` or `FAILED`

- `executor/trade_settler.js`
  - Watches submitted trades
  - Waits hold window, then computes mark-to-market local PnL
  - Updates local risk/reputation telemetry in `data/reputation_state.json`

## Shared Contract Network

- Network: Sepolia (11155111)
- AgentRegistry: `0x97b07dDc405B0c28B17559aFFE63BdB3632d0ca3`
- HackathonVault: `0x0E7CD8ef9743FEcf94f9103033a044caBD45fC90`
- RiskRouter: `0xd6A6952545FF6E6E6681c2d15C59f9EB8F40FdBC`
- ReputationRegistry: `0x423a9904e39537a9997fbaF0f220d79D7d545763`
- ValidationRegistry: `0x92bF63E5C7Ac6980f237a7164Ab413BE226187F1`

## Prerequisites

- Python 3.13+ (project currently used with Python 3.14)
- Node.js 20+
- PRISM API key and LLM key configured in `.env`
- Registered `AGENT_NFT_ID`

## Setup

```bash
cd /Users/satviiikkk/HedgeFlow/corr-arb-agent

# Python deps
./venv/bin/pip install -r requirements.txt

# Node deps
cd executor
npm install
```

## Running the System (Windows)

You need to open 5 separate terminal windows. Here are the exact commands to run in each window:

### 1. Dashboard Backend (API Server)
```powershell
cd c:\Users\LENOVO\Desktop\Hedge_flow\corr-arb-agent
.\venv\Scripts\uvicorn dashboard.backend.main:app --host 0.0.0.0 --port 8000
```

### 2. Dashboard Frontend (UI)
```powershell
cd c:\Users\LENOVO\Desktop\Hedge_flow\corr-arb-agent\dashboard\frontend
npm run dev
```

### 3. Core Python Agent (The Brain)
```powershell
cd c:\Users\LENOVO\Desktop\Hedge_flow\corr-arb-agent
.\venv\Scripts\python -m agent.signal_monitor
```

### 4. Trade Watcher (Blockchain Executor)
```powershell
cd c:\Users\LENOVO\Desktop\Hedge_flow\corr-arb-agent\executor
node trade_watcher.js
```

### 5. Trade Settler (PnL Tracker)
```powershell
cd c:\Users\LENOVO\Desktop\Hedge_flow\corr-arb-agent\executor
node trade_settler.js
```

## Health Checks

```bash
# process check
ps aux | grep -E "agent.signal_monitor|trade_watcher.js|trade_settler.js" | grep -v grep

# quick queue snapshot
cd /Users/satviiikkk/HedgeFlow/corr-arb-agent
./venv/bin/python - <<'PY'
import json
from pathlib import Path
from collections import Counter
tr = json.loads(Path('data/pending_trades.json').read_text())
print(dict(Counter(t.get('status') for t in tr)))
PY
```

## Notes

- Shared on-chain reputation (`ReputationRegistry`) is externally scored; operator self-rating is blocked.
- Validation score is actively updated by your own attestations.
- Local settler score/PnL is internal telemetry and separate from shared on-chain reputation.
