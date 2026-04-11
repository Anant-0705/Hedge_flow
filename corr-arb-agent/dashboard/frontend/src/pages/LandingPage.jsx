import { useState, useEffect } from "react";
import { Link } from "react-router-dom";

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:8000";

const ETHERSCAN_BASE = "https://sepolia.etherscan.io/address/";
const CONTRACTS = {
  validation: "0x92bF63E5C7Ac6980f237a7164Ab413BE226187F1",
  agent: "0x97b07dDc405B0c28B17559aFFE63BdB3632d0ca3",
  riskRouter: "0xd6A6952545FF6E6E6681c2d15C59f9EB8F40FdBC",
};

function Skeleton() {
  return <span className="skeleton" />;
}

function Icon({ name, style }) {
  return (
    <span className="material-icons-outlined" style={style}>
      {name}
    </span>
  );
}

export default function LandingPage() {
  const [stats, setStats] = useState(null);

  useEffect(() => {
    async function load() {
      try {
        const [agentRes, tradesRes] = await Promise.all([
          fetch(`${API_BASE}/api/agent`).then((r) => r.json()),
          fetch(`${API_BASE}/api/trades`).then((r) => r.json()),
        ]);
        setStats({
          trades: tradesRes.total || 0,
          valScore: agentRes.repScore || 0,
          rank: 2,
        });
      } catch {
        // Backend warming — keep stats null for skeleton
      }
    }
    load();
  }, []);

  return (
    <>
      {/* ── NAV ──────────────────────────────────── */}
      <nav className="nav">
        <div className="nav-inner">
          <Link to="/" className="nav-logo">
            HedgeFlow
          </Link>
          <div className="nav-links">
            <Link to="/dashboard">Dashboard</Link>
            <Link to="/trade/latest">Trades</Link>
            <a
              href={`${ETHERSCAN_BASE}${CONTRACTS.agent}`}
              target="_blank"
              rel="noreferrer"
            >
              Etherscan
            </a>
          </div>
        </div>
      </nav>

      {/* ── HERO ─────────────────────────────────── */}
      <section className="hero-section">
        <h1 className="hero-headline">
          Autonomous Cross-Asset<br />Correlation Arbitrage Agent
        </h1>
        <p className="hero-sub">
          HedgeFlow implements a fully autonomous ERC-8004 compliant trading
          agent on Ethereum Sepolia. It monitors 15 asset pair correlations
          via PRISM API, applies z-score mean-reversion detection, routes
          decisions through Claude for reasoning attestation, and commits
          every trade intent on-chain via EIP-712 signed structs to a shared
          RiskRouter contract.
        </p>
        <div className="hero-buttons">
          <Link to="/dashboard" className="btn btn-primary">
            View Live Dashboard
          </Link>
          <Link to="/trade/latest" className="btn btn-secondary">
            Inspect Trade Lifecycle
          </Link>
        </div>
        <div className="hero-stats">
          <div className="hero-stat">
            <Icon name="swap_horiz" style={{ fontSize: 18 }} />
            <span className="hero-stat-value">
              {stats ? stats.trades : <Skeleton />}
            </span>
            <span>on-chain intents</span>
          </div>
          <div className="hero-stat">
            <Icon name="verified" style={{ fontSize: 18 }} />
            <span>Reputation:</span>
            <span className="hero-stat-value">
              {stats ? `${stats.valScore}/100` : <Skeleton />}
            </span>
          </div>
          <div className="hero-stat">
            <Icon name="tag" style={{ fontSize: 18 }} />
            <span>ERC-8004 NFT ID:</span>
            <span className="hero-stat-value">
              {stats ? `#${stats.rank}` : <Skeleton />}
            </span>
          </div>
        </div>
      </section>

      <hr className="section-divider" />

      {/* ── THE PROBLEM ──────────────────────────── */}
      <section className="section">
        <p className="section-label">The Problem</p>
        <h2 className="section-title">Unsolved problems in autonomous agent infrastructure</h2>
        <div className="problems-grid" style={{ marginTop: 24 }}>
          <div className="card problem-card">
            <div className="problem-icon">
              <Icon name="visibility_off" />
            </div>
            <h3>Non-verifiable decision logic</h3>
            <p>
              AI agents execute trades with opaque reasoning. No mechanism
              exists to cryptographically bind the decision rationale to the
              on-chain execution, making post-hoc audit impossible.
            </p>
          </div>
          <div className="card problem-card">
            <div className="problem-icon">
              <Icon name="content_copy" />
            </div>
            <h3>Mutable performance history</h3>
            <p>
              Off-chain track records stored in databases can be selectively
              edited or deleted. Without immutable checkpointing, there is no
              source of truth for win rate, PnL, or Sharpe computation.
            </p>
          </div>
          <div className="card problem-card">
            <div className="problem-icon">
              <Icon name="block" />
            </div>
            <h3>No trustless reputation primitive</h3>
            <p>
              Agent capital allocation requires reputation scores derived from
              verified outcomes. Current systems lack an on-chain primitive
              that maps trade results to position sizing multipliers.
            </p>
          </div>
        </div>
      </section>

      <hr className="section-divider" />

      {/* ── HOW IT WORKS ─────────────────────────── */}
      <section className="section">
        <p className="section-label">Pipeline</p>
        <h2 className="section-title" style={{ marginBottom: 32 }}>
          Four-stage autonomous execution loop
        </h2>
        <div className="timeline">
          <div className="timeline-step">
            <div className="timeline-dot">
              <Icon name="monitoring" style={{ fontSize: 20 }} />
            </div>
            <p className="timeline-step-number">Stage 1 — Signal Detection</p>
            <h3>Correlation Z-Score Breach</h3>
            <p>
              The Python signal monitor polls PRISM API every 5 minutes for
              live prices across 6 assets (BTC, ETH, SOL, AVAX, LINK, ARB).
              For each of the 15 unique pairs, it computes a 30-day rolling
              Pearson correlation coefficient, then calculates the z-score
              against the 90-day historical distribution. A signal fires when
              |z| exceeds the configurable threshold (default: 2.0, live
              gate: 2.8).
            </p>
          </div>
          <div className="timeline-step">
            <div className="timeline-dot">
              <Icon name="psychology" style={{ fontSize: 20 }} />
            </div>
            <p className="timeline-step-number">Stage 2 — LLM Reasoning</p>
            <h3>Claude API Decision with Attestation Hash</h3>
            <p>
              The signal payload (z-score, correlation, historical mean,
              current prices, agent reputation score, recent PnL, circuit
              breaker state) is sent to Claude via the Anthropic API. Claude
              returns a structured JSON response: action (EXECUTE/SKIP),
              directional legs (LONG/SHORT per asset), position size in USD,
              confidence score, and a plain-English reasoning string. The
              reasoning is immediately hashed via keccak256 for on-chain
              commitment.
            </p>
          </div>
          <div className="timeline-step">
            <div className="timeline-dot">
              <Icon name="lock" style={{ fontSize: 20 }} />
            </div>
            <p className="timeline-step-number">Stage 3 — On-Chain Execution</p>
            <h3>EIP-712 Intent Signing + RiskRouter Submission</h3>
            <p>
              The Node.js executor constructs an EIP-712 typed struct
              (TradeIntent: agentId, pair, action, amountUsdScaled,
              confidenceBps, nonce, deadline). The agent wallet signs it and
              submits to the shared RiskRouter contract via
              executeSignedTrade(). Simultaneously, a checkpoint hash
              (keccak256 of z-score + correlation + confidence + reasoning
              hash) is posted to ValidationRegistry.submitCheckpoint().
            </p>
          </div>
          <div className="timeline-step">
            <div className="timeline-dot">
              <Icon name="star_outline" style={{ fontSize: 20 }} />
            </div>
            <p className="timeline-step-number">Stage 4 — Settlement + Reputation</p>
            <h3>Mark-to-Market PnL with ERC-8004 Score Update</h3>
            <p>
              The trade settler monitors open positions and computes
              mark-to-market PnL on exit. Settlement results update the
              agent&apos;s on-chain reputation via ReputationRegistry.recordTrade().
              The score (0-100) is a composite of win rate, Sharpe proxy,
              max drawdown, and streak multipliers. Position sizing scales
              linearly: multiplier = max(0.5, min(2.0, repScore / 50)).
              A circuit breaker activates after 3 consecutive losses,
              pausing execution for 1 hour.
            </p>
          </div>
        </div>
      </section>

      <hr className="section-divider" />

      {/* ── ARCHITECTURE DIAGRAM ─────────────────── */}
      <section className="section">
        <p className="section-label">Architecture</p>
        <h2 className="section-title">Three-process runtime architecture</h2>
        <div className="arch-diagram">
          <div className="arch-box">
            <div className="arch-box-title">Brain (Python)</div>
            <ul className="arch-box-items">
              <li>signal_monitor.py</li>
              <li>correlation_engine.py</li>
              <li>prism_client.py</li>
              <li>llm_reasoner.py</li>
            </ul>
          </div>
          <div className="arch-arrow">
            <Icon name="arrow_forward" />
          </div>
          <div className="arch-box">
            <div className="arch-box-title">Hands (Node.js)</div>
            <ul className="arch-box-items">
              <li>trade_watcher.js</li>
              <li>intent_builder.js</li>
              <li>signer.js (EIP-712)</li>
              <li>artifact_poster.js</li>
              <li>trade_settler.js</li>
            </ul>
          </div>
          <div className="arch-arrow">
            <Icon name="arrow_forward" />
          </div>
          <div className="arch-box">
            <div className="arch-box-title">Chain (Sepolia)</div>
            <ul className="arch-box-items">
              <li>AgentRegistry (ERC-8004)</li>
              <li>RiskRouter (shared)</li>
              <li>ValidationRegistry</li>
              <li>ReputationRegistry</li>
              <li>HackathonVault</li>
            </ul>
          </div>
        </div>
        <p className="arch-caption">
          Components communicate via pending_trades.json (Brain writes, Hands
          reads). On-chain interactions use ethers.js v6 with Alchemy RPC.
        </p>
      </section>

      <hr className="section-divider" />

      {/* ── PRISM + LLM ──────────────────────────── */}
      <section className="section">
        <p className="section-label">Data Layer + Reasoning Layer</p>
        <h2 className="section-title" style={{ marginBottom: 32 }}>
          PRISM API integration and LLM reasoning pipeline
        </h2>
        <div className="two-col">
          <div>
            <h3 className="col-title">PRISM: Unified Asset Resolution</h3>
            <p className="col-text">
              PRISM API (api.prismapi.ai) resolves heterogeneous tickers into
              canonical identities. The agent calls GET /price/history with
              lookback=90d for each asset, then constructs a correlation
              matrix using scipy.stats.pearsonr over 30-day rolling windows.
              The z-score is computed against the 90-day mean and standard
              deviation of the correlation time series.
            </p>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Asset</th>
                  <th>PRISM Ticker</th>
                  <th>Unique Pairs</th>
                </tr>
              </thead>
              <tbody>
                <tr><td>BTC</td><td>bitcoin</td><td>5</td></tr>
                <tr><td>ETH</td><td>ethereum</td><td>5</td></tr>
                <tr><td>SOL</td><td>solana</td><td>4</td></tr>
                <tr><td>AVAX</td><td>avalanche</td><td>3</td></tr>
                <tr><td>LINK</td><td>chainlink</td><td>2</td></tr>
                <tr><td>ARB</td><td>arbitrum</td><td>1</td></tr>
              </tbody>
            </table>
          </div>
          <div>
            <h3 className="col-title">Claude: Structured Reasoning with Hash Commitment</h3>
            <p className="col-text">
              Each signal is sent to Claude via the Anthropic messages API
              with a structured system prompt enforcing JSON output schema.
              The reasoning field is hashed (keccak256) before the response
              is written to pending_trades.json. This hash becomes part of
              the checkpoint submitted to ValidationRegistry, creating a
              cryptographic binding between the AI&apos;s reasoning and the
              on-chain record.
            </p>
            <div style={{ marginBottom: 12 }}>
              <p className="code-label">LLM Input Payload</p>
              <div className="code-block">
{`{
  "pair": "ETH/SOL",
  "z_score": -3.81,
  "current_correlation": 0.667,
  "historical_mean": 0.935,
  "historical_std": 0.070,
  "rep_score": 78,
  "position_multiplier": 1.56,
  "recent_pnl_usd": 4.20,
  "circuit_breaker": false,
  "consecutive_losses": 0
}`}
              </div>
            </div>
            <div>
              <p className="code-label">LLM Response (validated JSON)</p>
              <div className="code-block">
{`{
  "action": "EXECUTE",
  "action_a": "SHORT",  // ETH
  "action_b": "LONG",   // SOL
  "size_usd": 180,
  "confidence": 0.82,
  "reasoning": "ETH/SOL corr at
    3.81σ below 90d mean (0.935).
    Mean-reversion probability
    >85% per historical backtest.
    Position sized at 1.56x mult."
}`}
              </div>
            </div>
          </div>
        </div>
      </section>

      <hr className="section-divider" />

      {/* ── THE MATH ─────────────────────────────── */}
      <section className="section">
        <p className="section-label">Quantitative Model</p>
        <h2 className="section-title">Signal detection and position sizing formulas</h2>
        <div className="formulas" style={{ marginTop: 24 }}>
          <div className="formula-card">
            <div className="formula-expression">
              {"ρ(A,B) = Σ(rA·rB) / √(Σ(rA²)·Σ(rB²))"}
            </div>
            <p className="formula-description">
              Pearson correlation coefficient over a 30-day rolling window of
              log returns. Computed via scipy.stats.pearsonr for numerical
              stability. Range: [-1, 1].
            </p>
          </div>
          <div className="formula-card">
            <div className="formula-expression">
              {"z = (ρ_now − μ_90d) / σ_90d"}
            </div>
            <p className="formula-description">
              Standardized deviation of the current correlation from the
              90-day rolling mean. Two thresholds: MIN_ABS_ZSCORE_LIVE=2.8
              for signal generation, ZSCORE_THRESHOLD=2.0 for dashboard
              visualization.
            </p>
          </div>
          <div className="formula-card">
            <div className="formula-expression">
              {"size = clamp(base × mult, 50, 200)"}
            </div>
            <p className="formula-description">
              Position size in USD. Base size scaled by the reputation
              multiplier (repScore/50, clamped to [0.5, 2.0]). Floor at
              MIN_POSITION_USD=50, cap at MAX_POSITION_USD=200. Additional
              gate: MIN_LLM_CONFIDENCE=0.40.
            </p>
          </div>
          <div className="formula-card">
            <div className="formula-expression">
              {"checkpoint = keccak256(z, ρ, conf, rHash)"}
            </div>
            <p className="formula-description">
              The on-chain checkpoint hash is the keccak256 digest of the
              signal parameters (z-score, correlation, confidence) concatenated
              with the reasoning hash. Submitted to ValidationRegistry
              .submitCheckpoint(agentId, checkpointHash, score, notes).
            </p>
          </div>
        </div>
        <div className="example-box">
          <p className="example-label">Worked Example — ETH/SOL Signal</p>
          <p>
            Input: ρ_30d(ETH,SOL) = 0.667, μ_90d = 0.935, σ_90d = 0.070
            <br />
            z = (0.667 − 0.935) / 0.070 = <strong>−3.83</strong>
            <br />
            Gate check: |−3.83| {">"}  2.8 (MIN_ABS_ZSCORE_LIVE) — pass
            <br />
            LLM confidence: 0.82 {">"}  0.40 (MIN_LLM_CONFIDENCE) — pass
            <br />
            Rep score: 78 → multiplier = 78/50 = 1.56
            <br />
            Position: clamp(115 × 1.56, 50, 200) = <strong>$179.40</strong>
            <br />
            Action: SHORT ETH + LONG SOL (mean-reversion)
          </p>
        </div>
      </section>

      {/* ── FOOTER CTA ───────────────────────────── */}
      <div className="footer-cta">
        <h2>Verify every decision. Contracts are live on Sepolia.</h2>
        <Link to="/dashboard" className="btn btn-primary" style={{ marginTop: 8 }}>
          Open Live Dashboard
        </Link>
        <p className="footer-small" style={{ marginTop: 16 }}>
          Ethereum Sepolia Testnet — Chain ID 11155111
        </p>
        <div className="footer-links">
          <a
            href={`${ETHERSCAN_BASE}${CONTRACTS.validation}`}
            target="_blank"
            rel="noreferrer"
          >
            <Icon name="open_in_new" style={{ fontSize: 14 }} />
            ValidationRegistry ({CONTRACTS.validation.slice(0, 8)}...)
          </a>
          <a
            href={`${ETHERSCAN_BASE}${CONTRACTS.agent}`}
            target="_blank"
            rel="noreferrer"
          >
            <Icon name="open_in_new" style={{ fontSize: 14 }} />
            AgentRegistry ({CONTRACTS.agent.slice(0, 8)}...)
          </a>
          <a
            href={`${ETHERSCAN_BASE}${CONTRACTS.riskRouter}`}
            target="_blank"
            rel="noreferrer"
          >
            <Icon name="open_in_new" style={{ fontSize: 14 }} />
            RiskRouter ({CONTRACTS.riskRouter.slice(0, 8)}...)
          </a>
        </div>
      </div>
    </>
  );
}
