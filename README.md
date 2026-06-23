# HedgeFlow — Trustless Correlation Arbitrage Agent

> An autonomous AI trading agent that detects statistical arbitrage opportunities, reasons through live macro context using a local LLM, executes trades via signed on-chain intents, and posts a cryptographic hash of its reasoning to a public blockchain **before the outcome is known** — making every decision permanently verifiable.

**Live Dashboard:** https://hedgeflow-production.up.railway.app  
**Blockchain:** Sepolia Testnet (Chain ID: 11155111)  
**Team:** BurgerOS — Aaditya Singhal, Anant Singhal, Satvik Srivastava  
**Institution:** KIET Group of Institutions, Ghaziabad

---

## Table of Contents

- [What HedgeFlow Does](#what-hedgeflow-does)
- [The Problem It Solves](#the-problem-it-solves)
- [Architecture Overview](#architecture-overview)
- [The Full Trade Pipeline](#the-full-trade-pipeline)
- [Component Deep Dive](#component-deep-dive)
  - [1. Price Client](#1-price-client)
  - [2. Correlation Engine](#2-correlation-engine)
  - [3. Cointegration Gate](#3-cointegration-gate)
  - [4. Apify Macro Scraper](#4-apify-macro-scraper)
  - [5. LLM Reasoner](#5-llm-reasoner)
  - [6. On-Chain Execution Layer](#6-on-chain-execution-layer)
  - [7. Settlement and Reputation](#7-settlement-and-reputation)
  - [8. Dashboard](#8-dashboard)
- [Smart Contract Integration](#smart-contract-integration)
- [Risk Management](#risk-management)
- [Key Numbers](#key-numbers)
- [Project Structure](#project-structure)
- [Environment Variables](#environment-variables)
- [Local Setup](#local-setup)
- [Deployment](#deployment)
- [Research Foundation](#research-foundation)

---

## What HedgeFlow Does

HedgeFlow is a fully autonomous, multi-process trading agent that:

1. **Scans** 15 asset pairs across 6 assets every 5 minutes for correlation breakdowns
2. **Validates** every signal with an academic-grade Engle-Granger cointegration test before the LLM ever sees it
3. **Enriches** every decision with live macro context — crypto news, sentiment, funding rates, Fear & Greed index — scraped from 5 sources every 30 minutes
4. **Decides** using a local quantized LLM running entirely on-device — no cloud API, no data sent to third parties
5. **Proves** its reasoning by hashing the full decision context and posting it to a public blockchain **before** submitting the trade
6. **Executes** trades as EIP-712 signed intents submitted to a RiskRouter smart contract on Sepolia
7. **Settles** via mark-to-market PnL 15 minutes after submission, updating an on-chain reputation score

Every step — signal, reasoning, execution, outcome — is traceable, auditable, and permanently verifiable.

---

## The Problem It Solves

Existing AI trading agents are black boxes. When they lose money, users have no way to understand what signal triggered the trade, what the agent was thinking, whether the logic made sense at the time, or whether the reasoning was fabricated after the fact.

A 2026 empirical study of 925,323 wallets across all major AI trading agent platforms found:
- **62.2%** of participants — 575,246 wallets — realised losses
- **$192 million** lost in total across platforms
- **66.6%** loss rate on the largest platform (ai16z/Eliza)
- **81.4%** of all gains captured by the top 1% of wallets
- **93%** average token price decline from all-time highs

Not one of those users could open a page and read why the agent made the decision that cost them money.

HedgeFlow's answer: post the reasoning on a public blockchain before the outcome is known. The hash is timestamped, tamper-proof, and permanently verifiable by anyone.

---

## Architecture Overview

HedgeFlow is a three-process system communicating asynchronously via local JSON files, with a fourth process serving the dashboard.

```
┌─────────────────────────────────────────────────────────────────────┐
│                        HEDGEFLOW SYSTEM                             │
│                                                                     │
│  ┌──────────────────┐    ┌──────────────────┐    ┌───────────────┐  │
│  │  Python Backend  │    │  Node.js Executor│    │  React        │  │
│  │  (signal_monitor)│    │  (watcher +      │    │  Dashboard    │  │
│  │                  │    │   settler)       │    │               │  │
│  │ • Price fetching │    │ • EIP-712 signing│    │ • Live corr.  │  │
│  │ • Correlation    │    │ • Chain submit   │    │ • Trade detail│  │
│  │ • Cointegration  │    │ • PnL settlement │    │ • Reputation  │  │
│  │ • Macro scraping │    │ • Reputation     │    │ • Demo flow   │  │
│  │ • LLM reasoning  │    │   update         │    │               │  │
│  └────────┬─────────┘    └────────┬─────────┘    └───────┬───────┘  │
│           │                       │                      │           │
│           ▼                       ▼                      ▼           │
│     data/pending_trades.json ◄──────────────────  FastAPI /api/*    │
│     data/reputation_state.json                                      │
│     data/macro_context.json                                         │
│                                                                     │
│  ┌──────────────────┐    ┌──────────────────┐                       │
│  │  Apify Scraper   │    │  Blockchain       │                       │
│  │  (cron, 30 min)  │    │  Sepolia testnet  │                       │
│  │                  │    │                   │                       │
│  │ • Fear & Greed   │    │ • RiskRouter      │                       │
│  │ • Reddit         │    │ • ReputationReg.  │                       │
│  │ • CoinDesk RSS   │    │ • ValidationReg.  │                       │
│  │ • CoinTelegraph  │    │ • AgentRegistry   │                       │
│  │ • Binance rates  │    │                   │                       │
│  └──────────────────┘    └──────────────────┘                       │
└─────────────────────────────────────────────────────────────────────┘
```

---

## The Full Trade Pipeline

Every 5 minutes, this is the complete sequence:

```
[1] PRICE FEED
    Binance vision API (crypto) + Twelve Data (GOLD, EUR)
    → 6 asset prices fetched and cached
    → Saved to data/price_history_{symbol}.json

[2] CORRELATION ENGINE
    Pearson correlation over 30-day rolling window
    90-day lookback for historical distribution
    Z-score = (current_corr - historical_mean) / historical_std
    → Flags pairs where |z_score| > 2.8

[3] COINTEGRATION GATE  ← most bots stop at step 2
    Engle-Granger two-step test:
      a. OLS regression: log(A) = α + β·log(B)  →  hedge ratio β
      b. ADF test on spread: log(A) - α - β·log(B)
    → Rejects pair if p-value ≥ 0.05
    → Cached for 1 hour (expensive computation)
    → Only cointegrated pairs proceed

[4] MACRO CONTEXT
    ApifyMacroClient.fetch() reads latest dataset item
    30-minute cache, falls back to defaults if unavailable
    → fear_greed, funding rates, market_regime, headlines

[5] LLM DECISION
    Local Groq-hosted LLM (llama-3.3-70b-versatile)
    Receives: signal data + cointegration results + macro context
    Returns strict JSON: execute, action_a, action_b, size_usd,
                         confidence, reasoning, skip_reason
    → Validated and sanitised before use

[6] REASONING HASH
    SHA-256(reasoning_text | spread_z | hedge_ratio | coint_p)
    → Posted to ValidationRegistry on Sepolia
    → Happens BEFORE trade submission

[7] TRADE INTENT
    Written to data/pending_trades.json as PENDING
    trade_watcher.js picks up within poll interval

[8] EIP-712 SIGNING + SUBMISSION
    IntentBuilder constructs typed TradeIntent struct
    Signed with AGENT_PRIVATE_KEY via ethers.js
    Submitted to RiskRouter smart contract
    → Status updated to SUBMITTED

[9] SETTLEMENT (15 min later)
    trade_settler.js re-fetches exit prices
    Computes mark-to-market PnL on both legs
    → Status updated to SETTLED
    → ReputationRegistry updated on-chain
    → Pair PnL tracked for auto-disable logic
```

---

## Component Deep Dive

### 1. Price Client

**File:** `agent/price_client.py`

Routes price requests by asset class:

| Asset Type | Source | Auth |
|---|---|---|
| Crypto (BTC, ETH, SOL, MATIC, etc.) | `data-api.binance.vision` | None — public endpoint |
| Traditional (GOLD, EUR) | `api.twelvedata.com` | `TWELVE_DATA_API_KEY` |

**Key details:**
- Uses `data-api.binance.vision` (not `api.binance.com`) to avoid geo-IP restrictions on cloud servers
- MATIC routes to `POLUSDT` on Binance — Polygon rebranded and Binance delisted MATICUSDT on 2024-09-10
- 60-second in-memory cache for current prices, avoids redundant API calls within a cycle
- 0.2s sleep between batch calls to respect Twelve Data's 8 requests/minute free tier limit
- Full retry with exponential backoff (3 attempts, 2× backoff) on all HTTP calls
- Falls back to `data/price_history_{symbol}.json` local cache if API fails
- `save_price_to_history()` maintains a rolling 180-day local cache per symbol

**Symbol mappings:**
```python
binance_symbol_aliases = {"MATIC": "POL"}  # Binance rebrand
symbol_aliases = {
    "GOLD": "XAU/USD",   # Twelve Data commodity
    "EUR": "EUR/USD",    # Twelve Data forex
}
```

---

### 2. Correlation Engine

**File:** `agent/correlation_engine.py`

Computes Pearson correlation and z-score for all asset pair combinations.

**How it works:**

```
Price history (5-min raw) → downsample to daily (prices[::288]) → 90-day window

For each pair (A, B):
  1. Compute 30-day rolling Pearson correlation
  2. Build distribution of 30-day rolling correlations over 90-day history
  3. current_z = (today_corr - mean(history)) / std(history)
  4. Flag if |current_z| > ZSCORE_THRESHOLD (default 2.0, live gate 2.8)
```

**`CorrelationSignal` dataclass fields:**

| Field | Type | Description |
|---|---|---|
| `asset_a`, `asset_b` | str | The trading pair |
| `current_correlation` | float | Today's 30-day Pearson correlation |
| `historical_mean` | float | Mean of rolling correlations over 90 days |
| `historical_std` | float | Std dev of rolling correlations |
| `z_score` | float | How many std devs from normal |
| `direction` | str | `CORR_BREAKDOWN` or `CORR_SPIKE` |
| `confidence` | float | Blended score (60% z-score + 40% cointegration) |
| `hedge_ratio` | float | β from OLS regression |
| `cointegration_pvalue` | float | ADF test p-value |
| `spread_zscore` | float | Z-score of the actual price spread |
| `is_cointegrated` | bool | Whether pair passed the ADF gate |

---

### 3. Cointegration Gate

**File:** `agent/correlation_engine.py` — `compute_cointegration()`

The most important upgrade over standard correlation-based bots. Correlation tells you two assets move together today. Cointegration tells you their spread is **stationary** — mathematically guaranteed to mean-revert over time.

**Two-step Engle-Granger procedure:**

**Step 1 — OLS Regression:**
```
log(A) = α + β·log(B) + ε
```
Uses `numpy.linalg.lstsq` to find coefficients. The slope β is the **hedge ratio** — how many units of B to hold per unit of A for a market-neutral position.

**Step 2 — ADF Test on Spread:**
```
spread = log(A) - α - β·log(B)
```
The Augmented Dickey-Fuller test checks whether this spread is **stationary** (has a constant mean it reverts to). Null hypothesis: the spread has a unit root (NOT stationary). If we can reject the null at p < 0.05, the spread is stationary and the pair is cointegrated.

**Why this matters:** Without cointegration, you might trade a pair that looks correlated but whose correlation was a coincidence. The gap widens forever. With cointegration, statistics guarantee reversion.

**Caching:** Results cached for 3600 seconds (1 hour) per pair. Cointegration is slow-changing — recomputing every 5 minutes would be wasteful.

**Confidence formula:**
```python
corr_conf = min(1.0, (abs(z_score) - zscore_threshold) / 2.0)
coint_conf = max(0.0, 1.0 - (p_value / COINTEGRATION_PVALUE_THRESHOLD))
confidence = corr_conf * 0.6 + coint_conf * 0.4
```

---

### 4. Apify Macro Scraper

**Files:** `apify/src/main.js`, `agent/apify_client.py`

A two-part system: an Apify Actor that scrapes the web on a 30-minute cron, and a Python client that fetches the results.

**Apify Actor (Node.js + Crawlee):**

| Source | Method | Data extracted |
|---|---|---|
| Alternative.me | REST API | Fear & Greed value (0–100) + label |
| Binance Futures | REST API | BTC + ETH funding rate % |
| Reddit r/CryptoCurrency | Public JSON API | Top 10 posts + bullish/bearish sentiment |
| CoinDesk | RSS feed (Cheerio) | Top 8 headlines |
| CoinTelegraph | RSS feed (Cheerio) | Top 8 headlines |

**Market regime derivation:**
```
fear_greed > 60  →  "risk_on"
fear_greed < 40  →  "risk_off"
otherwise        →  "neutral"
```

**Combined sentiment:** Majority vote across Reddit sentiment + keyword scan of all headlines. Bullish keywords: moon, pump, bull, ATH, surge, rally, breakout. Bearish keywords: crash, dump, bear, rug, sell, fear, collapse.

**Python client (`ApifyMacroClient`):**
- Fetches latest dataset item via `GET /v2/datasets/{id}/items?limit=1&desc=1`
- 30-minute in-memory cache — matches the scraper's run frequency
- Returns structured dict with `fear_greed`, `btc_funding_rate`, `market_regime`, `news_sentiment`, `top_headlines`
- Falls back to `"unknown"` values gracefully if Apify is unreachable or unconfigured
- **Never crashes** — all exceptions caught internally

**What the LLM receives (vs before):**
```
BEFORE:
  Fear and Greed: unknown
  BTC funding rate: unknown
  Market regime: unknown

AFTER:
  Fear and Greed: 31 (Fear)
  BTC funding rate: -0.003%
  ETH funding rate: -0.001%
  Market regime: risk_off
  News sentiment: bearish
  Top headlines: "Fed signals further tightening" | "BTC whale moves $800M..." | ...
```

---

### 5. LLM Reasoner

**File:** `agent/llm_reasoner.py`

Takes the validated signal + macro context and produces a structured trading decision.

**Model:** `llama-3.3-70b-versatile` via Groq API (configurable via `LLM_MODEL` env var)

**Prompt structure:**
```
Signal:
  - Pair, prices, correlation z-score, direction, confidence

Cointegration (Engle-Granger):
  - Spread Z-score ← primary entry signal
  - Hedge ratio β  ← position sizing guide
  - ADF p-value    ← mean reversion strength
  - Is cointegrated: True (always True at this stage)

Agent state:
  - Reputation score, portfolio value, recent PnL, suggested size

Macro context:
  - Fear & Greed, funding rates, market regime, news sentiment, headlines

Task instructions:
  - 8 numbered rules including spread_zscore direction logic,
    hedge ratio sizing, macro sentiment adjustment
```

**Required JSON output schema:**
```json
{
  "execute": true,
  "action_a": "LONG",
  "action_b": "SHORT",
  "size_usd": 150,
  "confidence": 0.74,
  "reasoning": "Spread z-score of -2.4 with ADF p=0.018 confirms...",
  "skip_reason": ""
}
```

**Post-LLM validation (`_sanitize_trade_decision`):**
- Forces `action_a` and `action_b` to be opposing (`LONG`/`SHORT`)
- Clamps `size_usd` to `[MIN_POSITION_USD, base_size]`
- Clamps `confidence` to `[0.0, 1.0]`
- If JSON parse fails → forces SKIP, never crashes

**Reasoning hash:**
```python
hash_input = f"{reasoning_text}|spread_z={signal.spread_zscore:.4f}|beta={signal.hedge_ratio:.6f}|coint_p={signal.cointegration_pvalue:.6f}"
reasoning_hash = "0x" + hashlib.sha256(hash_input.encode()).hexdigest()
```

The hash covers reasoning text AND the key statistical inputs — making it tamper-evident against both the reasoning and the data it was based on.

---

### 6. On-Chain Execution Layer

**Files:** `executor/trade_watcher.js`, `executor/intent_builder.js`, `executor/signer.js`, `executor/router_submitter.js`, `executor/artifact_poster.js`

**Trade Watcher (`trade_watcher.js`):**
- Polls `data/pending_trades.json` on a configurable interval
- Reads `PENDING` trades, validates they are within `MAX_SIGNAL_AGE_SECONDS`
- Builds and submits the EIP-712 intent
- Updates trade status to `SUBMITTED` with `txHash`

**Intent Builder (`intent_builder.js`):**
Constructs the `TradeIntent` typed data structure:
```js
{
  agentId: AGENT_NFT_ID,
  agentWallet: AGENT_WALLET_ADDRESS,
  pair: "BTCUSD",
  action: "BUY",
  usdAmount: 150,
  maxSlippageBps: 100,
  deadline: now + 300,
  nonce: uuid,
  reasoningHash: "0x..."
}
```

**EIP-712 Signing (`signer.js`):**
Uses `ethers.js` `signTypedData` with the agent's private key. The typed data domain is pinned to Chain ID 11155111 (Sepolia).

**Router Submitter (`router_submitter.js`):**
Calls `submitIntent(intent, signature)` on the `RiskRouter` contract.
If `RISK_ROUTER_ADDRESS` is not set → switches to **DRY RUN mode** (logs the intent, does not submit).

**Artifact Poster (`artifact_poster.js`):**
Posts a checkpoint attestation to the `ValidationRegistry` contract including the `reasoningHash`.
If `VALIDATION_REGISTRY_ADDRESS` is not set → switches to **LOG-ONLY mode**.

---

### 7. Settlement and Reputation

**Files:** `executor/trade_settler.js`, `executor/reputation_updater.js`, `executor/reputation_reader.js`

**Trade Settler:**
- Polls `data/pending_trades.json` for `SUBMITTED` trades past their hold window (default 15 min)
- Verifies the transaction receipt on-chain (confirms not reverted)
- Re-fetches exit prices from Binance/Twelve Data
- Computes mark-to-market PnL:
  ```
  Long leg:  (exit_price_a - entry_price_a) / entry_price_a × size_usd × 0.5
  Short leg: (entry_price_b - exit_price_b) / entry_price_b × size_usd × 0.5
  total_pnl = long_leg_pnl + short_leg_pnl
  ```
- Updates trade status to `SETTLED` with full settlement data
- Calls `ReputationUpdater` with the outcome

**Reputation Updater:**
- Maintains `data/reputation_state.json` locally
- Updates on-chain `ReputationRegistry` score
- Tracks consecutive losses for circuit breaker logic
- Tracks per-pair average PnL for auto-disable logic

**Reputation Reader:**
- Used by Signal Monitor to read current on-chain reputation score
- Score (0–100) maps to a `position_multiplier`:
  ```
  multiplier = max(0.0, min(1.0, score / 100.0))
  base_size = MIN_POSITION_USD + (MAX_POSITION_USD - MIN_POSITION_USD) × multiplier
  ```
  Score 50 → $125 base size. Score 0 → $50 minimum. Score 100 → $200 maximum.

---

### 8. Dashboard

**Files:** `dashboard/backend/main.py`, `dashboard/frontend/src/`

**FastAPI Backend endpoints:**

| Endpoint | Description |
|---|---|
| `GET /health` | Health check |
| `GET /api/agent` | Agent identity, reputation, stats |
| `GET /api/correlations` | Live correlation matrix for all pairs |
| `GET /api/trades` | Last 100 trades with status |
| `GET /api/trades/{id}` | Full trade detail including reasoning |
| `GET /api/performance` | Win rate, Sharpe ratio, total PnL |
| `POST /api/demo/start` | Trigger a live demo trade end-to-end |
| `GET /api/demo/status` | Poll demo trade status |
| `DELETE /api/demo/reset` | Reset demo state |

**React Frontend pages:**

| Route | Description |
|---|---|
| `/` | Landing page with project overview |
| `/dashboard` | Live correlation heatmap + active signals |
| `/trades` | Trade history table |
| `/trades/:id` | Full trade detail — signal, reasoning, hash, PnL |
| `/demo` | Animated live demo — full pipeline visualization |

**Performance metrics computed:**
```python
sharpe = avg_pnl / std_pnl  # simplified, no risk-free rate
win_rate = wins / total_settled_trades × 100
```

---

## Smart Contract Integration

All contracts on Sepolia testnet (Chain ID: 11155111):

| Contract | Address | Purpose |
|---|---|---|
| `RiskRouter` | Set via `RISK_ROUTER_ADDRESS` | Receives EIP-712 signed TradeIntents |
| `ReputationRegistry` | `0x423a9904e39537a9997fbaF0f220d79D7d545763` | On-chain agent reputation score (0–100) |
| `ValidationRegistry` | Set via `VALIDATION_REGISTRY_ADDRESS` | Stores reasoning hash attestations |
| `AgentRegistry` | `0x97b07dDc405B0c28B17559aFFE63BdB3632d0ca3` | NFT-based agent identity |
| `HackathonVault` | `0x0E7CD8ef9743FEcf94f9103033a044caBD45fC90` | ERC-8004 hackathon settlement vault |

The `ReputationRegistry` and `AgentRegistry` have hardcoded defaults in the executor — the system works out-of-the-box against the shared hackathon infrastructure without setting these variables.

---

## Risk Management

HedgeFlow implements five layers of risk control:

**Layer 1 — Statistical Gate**
Z-score must exceed `MIN_ABS_ZSCORE_LIVE` (2.8) in live mode. Filters low-conviction signals before any further processing.

**Layer 2 — Cointegration Gate**
ADF p-value must be < 0.05. Rejects pairs with real correlation but no guaranteed mean reversion. Eliminates the primary failure mode of correlation-based bots.

**Layer 3 — LLM Sanity Check**
LLM confidence must exceed `MIN_LLM_CONFIDENCE` (0.40). The model also applies its own judgment based on macro context — if sentiment is strongly bearish and regime is `risk_off`, it applies extra skepticism to marginal signals.

**Layer 4 — Pair Auto-Disable**
Each pair's average PnL is tracked. If a pair accumulates `PAIR_DISABLE_MIN_TRADES` (6) trades with average PnL below `PAIR_DISABLE_EXPECTANCY_USD` (-$0.05), it is blacklisted and skipped in future cycles. This prevents repeated losses on genuinely non-cointegrated pairs that slipped through.

**Layer 5 — On-Chain Throttling**
Position sizes are scaled by the on-chain reputation score. A losing agent automatically trades smaller. This is enforced at the code level — no human override.

**Circuit Breaker**
If consecutive losses exceed `CIRCUIT_BREAKER_MAX_CONSECUTIVE_LOSSES` (3), the agent pauses for `CIRCUIT_BREAKER_PAUSE_SECONDS` (3600 = 1 hour) before resuming.

---

## Key Numbers

| Metric | Value |
|---|---|
| Market scan frequency | Every 5 minutes (288 cycles/day) |
| Assets monitored | 6 — BTC, ETH, SOL, MATIC, GOLD, EUR |
| Pairs per cycle | 15 combinations |
| Z-score threshold (signal) | 2.0 standard deviations |
| Z-score threshold (live) | 2.8 standard deviations |
| Cointegration requirement | ADF p-value < 0.05 (95% confidence) |
| Cointegration cache TTL | 3600 seconds (1 hour) |
| Price history lookback | 90 days |
| Rolling correlation window | 30 days |
| Macro context freshness | Every 30 minutes |
| News sources | 5 (F&G, Reddit, CoinDesk, CT, Binance) |
| LLM model | llama-3.3-70b-versatile (Groq) |
| LLM inference time | ~2–5 seconds (Groq API) |
| Settlement window | 15 minutes |
| Position range | $50–$200 USD |
| Minimum confidence | 0.40 |
| Circuit breaker threshold | 3 consecutive losses |
| Circuit breaker pause | 1 hour |
| Pair disable after | 6 trades below -$0.05 avg PnL |

---

## Project Structure

```
corr-arb-agent/
│
├── agent/                          # Python analytics backend
│   ├── __init__.py
│   ├── signal_monitor.py           # Main orchestrator — runs the 5-min cycle
│   ├── correlation_engine.py       # Pearson + z-score + cointegration (ADF)
│   ├── price_client.py             # Binance + Twelve Data routed price fetcher
│   ├── apify_client.py             # Fetches macro context from Apify dataset
│   ├── llm_reasoner.py             # LLM decision engine + reasoning hash
│   └── reputation_reader.py        # Reads on-chain reputation score
│
├── executor/                       # Node.js execution layer
│   ├── trade_watcher.js            # Polls pending trades, signs + submits
│   ├── trade_settler.js            # Settles submitted trades, computes PnL
│   ├── intent_builder.js           # Builds EIP-712 TradeIntent typed data
│   ├── signer.js                   # Signs typed data with agent private key
│   ├── router_submitter.js         # Submits to RiskRouter contract
│   ├── artifact_poster.js          # Posts reasoning hash to ValidationRegistry
│   ├── reputation_updater.js       # Updates on-chain + local reputation
│   ├── reputation_reader.js        # Reads current reputation state
│   └── package.json
│
├── apify/                          # Apify web scraper Actor
│   ├── src/main.js                 # Actor — scrapes 5 sources, pushes to dataset
│   ├── .actor/actor.json           # Actor specification
│   ├── .actor/INPUT_SCHEMA.json    # Input schema (empty — no config needed)
│   └── package.json
│
├── dashboard/
│   ├── backend/
│   │   ├── main.py                 # FastAPI app — all /api/* routes
│   │   ├── demo_router.py          # Demo trade endpoints
│   │   └── requirements.txt
│   └── frontend/
│       ├── src/
│       │   ├── App.jsx             # React router
│       │   ├── pages/
│       │   │   ├── LandingPage.jsx
│       │   │   ├── Dashboard.jsx   # Live correlations + signals
│       │   │   ├── TradeDetail.jsx # Full trade — signal, reasoning, hash
│       │   │   ├── TradeLatest.jsx # Recent trades table
│       │   │   └── DemoFlow.jsx    # Animated demo pipeline
│       │   └── styles.css
│       ├── vite.config.js
│       └── vercel.json             # SPA routing fix for Vercel
│
├── config/
│   └── settings.py                 # All env vars with defaults
│
├── scripts/
│   ├── setup_agent.js              # One-time agent registration on-chain
│   └── start_agents.sh             # Legacy start script
│
├── data/                           # Runtime state (gitignored)
│   ├── pending_trades.json         # Live trade queue
│   ├── reputation_state.json       # Local reputation cache
│   ├── macro_context.json          # Latest scraped macro data
│   └── price_history_*.json        # Per-symbol price cache
│
├── start_all.sh                    # Multi-process launcher (Railway entry point)
├── railpack.json                   # Railpack build config (Python + Node)
└── requirements.txt                # Python dependencies
```

---

## Environment Variables

### Required

| Variable | Used by | Description |
|---|---|---|
| `AGENT_PRIVATE_KEY` | executor | Private key for signing trade intents |
| `AGENT_WALLET_ADDRESS` | executor | Public wallet address of the agent |
| `RPC_URL` | executor | Sepolia RPC endpoint (Alchemy/Infura) |
| `GROQ_API_KEY` | agent | Groq API key for LLM inference |
| `TWELVE_DATA_API_KEY` | agent | Twelve Data API key for GOLD/EUR prices |

### Optional — with defaults

| Variable | Default | Description |
|---|---|---|
| `APIFY_API_TOKEN` | `""` | Apify API token (scraper disabled if missing) |
| `APIFY_DATASET_ID` | `""` | Apify dataset ID for macro context |
| `ASSETS` | `BTC,ETH,SOL,MATIC,GOLD,EUR` | Assets to monitor |
| `LIVE_ASSETS` | `BTC,ETH,SOL` | Assets used in live trading |
| `LLM_MODEL` | `llama-3.3-70b-versatile` | Groq model name |
| `LOOKBACK_DAYS` | `90` | Days of price history for correlation |
| `ZSCORE_THRESHOLD` | `2.0` | Initial z-score filter |
| `MIN_ABS_ZSCORE_LIVE` | `2.8` | Live trading z-score gate |
| `COINTEGRATION_PVALUE_THRESHOLD` | `0.05` | ADF test significance level |
| `MIN_LLM_CONFIDENCE` | `0.40` | Minimum LLM confidence to execute |
| `MAX_POSITION_USD` | `200` | Maximum trade size |
| `CHECK_INTERVAL_MINUTES` | `5` | Signal scan frequency |
| `CHAIN_ID` | `11155111` | Blockchain chain ID |
| `RISK_ROUTER_ADDRESS` | — | RiskRouter contract (DRY RUN if missing) |
| `VALIDATION_REGISTRY_ADDRESS` | — | ValidationRegistry (LOG-ONLY if missing) |
| `AGENT_NFT_ID` | `0` | Agent's NFT identity token ID |
| `CIRCUIT_BREAKER_MAX_CONSECUTIVE_LOSSES` | `3` | Losses before pause |
| `CIRCUIT_BREAKER_PAUSE_SECONDS` | `3600` | Pause duration after circuit break |
| `PAIR_DISABLE_MIN_TRADES` | `6` | Min trades before pair can be disabled |
| `PAIR_DISABLE_EXPECTANCY_USD` | `-0.05` | Avg PnL threshold for pair disable |
| `SETTLEMENT_HOLD_MINUTES` | `15` | Hold time before mark-to-market |
| `DISABLE_HARDENING_GATES` | `0` | Set to `1` to bypass gates (testing only) |

---

## Local Setup

### Prerequisites
- Python 3.13+
- Node.js 20+
- A Sepolia RPC URL (free: Alchemy or Infura)
- A Groq API key (free tier at console.groq.com)
- A Twelve Data API key (free tier at twelvedata.com)

### 1. Clone and install

```bash
git clone https://github.com/Anant-0705/Hedge_flow.git
cd Hedge_flow/corr-arb-agent

# Python dependencies
pip install -r requirements.txt

# Node.js dependencies
cd executor && npm install && cd ..
```

### 2. Configure environment

```bash
cp .env.example .env   # or create .env manually
```

Minimum `.env` for local testing:
```env
GROQ_API_KEY=gsk_your_key_here
TWELVE_DATA_API_KEY=your_key_here
AGENT_PRIVATE_KEY=0xyour_sepolia_private_key
AGENT_WALLET_ADDRESS=0xyour_wallet_address
RPC_URL=https://eth-sepolia.g.alchemy.com/v2/your_key

# Optional but recommended
APIFY_API_TOKEN=apify_api_your_token
APIFY_DATASET_ID=your_dataset_id
```

### 3. Register the agent (one-time)

```bash
cd scripts
node setup_agent.js
```

This registers the agent on-chain and sets up the NFT identity.

### 4. Run everything

```bash
bash start_all.sh
```

Or run each process separately in different terminals:

```bash
# Terminal 1 — Signal monitor
python -u -m agent.signal_monitor

# Terminal 2 — Trade watcher
cd executor && node trade_watcher.js

# Terminal 3 — Trade settler
cd executor && node trade_settler.js

# Terminal 4 — Dashboard API
python -m uvicorn dashboard.backend.main:app --host 0.0.0.0 --port 8000

# Terminal 5 — Dashboard frontend
cd dashboard/frontend && npm install && npm run dev
```

### 5. Set up the Apify scraper (optional but recommended)

```bash
npm install -g apify-cli
apify login                    # enter your API token
cd apify
npm install
apify run                      # test locally
apify push                     # deploy to Apify platform
```

Then in the Apify console:
- **Schedules** → New → Cron: `*/30 * * * *`
- Copy the Dataset ID → set as `APIFY_DATASET_ID`

---

## Deployment

### Backend — Railway

1. Connect `Anant-0705/Hedge_flow` repository
2. Set **Root Directory:** `/corr-arb-agent`
3. Railway reads `railpack.json` automatically — installs Python 3.13 + Node 20
4. Start command: `bash start_all.sh` (set in `railpack.json`)
5. Add all environment variables in the **Variables** tab

The `railpack.json` configuration:
```json
{
  "$schema": "https://schema.railpack.com",
  "provider": "python",
  "packages": { "python": "3.13", "node": "20" },
  "deploy": { "startCommand": "bash start_all.sh" }
}
```

### Frontend — Vercel

1. Import `Anant-0705/Hedge_flow` repository
2. Set **Root Directory:** `corr-arb-agent/dashboard/frontend`
3. Framework: Vite
4. Build command: `npm run build`
5. Output directory: `dist`
6. Environment variable: `VITE_API_BASE=https://your-railway-url.up.railway.app`

The `vercel.json` handles SPA routing:
```json
{ "rewrites": [{ "source": "/(.*)", "destination": "/" }] }
```

---

## Research Foundation

HedgeFlow's design draws from the following academic work:

| Paper | Relevance |
|---|---|
| **TradingAgents** (UCLA/MIT, arXiv 2412.20138) | Multi-agent LLM framework with Bull/Bear debate — validates our War Room design pattern |
| **Deep Learning Statistical Arbitrage** (arXiv 2106.04028) | Three-part decomposition: portfolio selection, signal, allocation — maps directly to our architecture |
| **QuantAgent** (arXiv 2402.03755) | Self-improving LLM trading agent via memory — foundation for our lesson-injection roadmap |
| **FinMem** (arXiv 2311.13743) | Layered memory for LLM trading agents |
| **FS-ReasoningAgent** (arXiv 2410.12464) | Fact + subjectivity reasoning in crypto markets |
| **Profit Mirage** (arXiv 2510.07920) | Look-ahead bias in LLM trading — our on-chain timestamping is a direct defense |
| **Look-Ahead-Bench** (arXiv 2601.13770) | Information leakage benchmarks — forward-only live trading with pre-trade attestation is our rebuttal |
| **Paper Agents, Paper Gains** (2026) | Empirical study of 925,323 wallets — establishes the $192M problem HedgeFlow solves |

**Key architectural principle (confirmed by Intel mentors Suresh Vasu and Manjula Vidyanandarao):**

> "Let code do the price ingestion, correlation, z-score, thresholds, risk gates, sizing. Let the LLM do decision interpretation, action selection, confidence explanation, and structured JSON output. That way, even if the model is not perfect, the critical numerical logic stays deterministic."

This principle is implemented throughout HedgeFlow: all mathematical computation is in Python, all LLM output is validated against a strict schema, and no trade executes without passing multiple deterministic code-level gates first.

---

*Built for the ERC-8004 Hackathon Stack · Sepolia Testnet · 2026*
