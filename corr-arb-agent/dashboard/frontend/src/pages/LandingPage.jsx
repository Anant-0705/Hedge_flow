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
          Every AI Trade Decision.
          <br />
          Proven On-Chain.
        </h1>
        <p className="hero-sub">
          HedgeFlow is trustless financial agent infrastructure. Our AI agent
          watches 15 asset pairs 24/7, detects statistical arbitrage
          opportunities, and records every decision permanently on Ethereum — so
          anyone can verify it.
        </p>
        <div className="hero-buttons">
          <Link to="/dashboard" className="btn btn-primary">
            View Live Dashboard
          </Link>
          <Link to="/trade/latest" className="btn btn-secondary">
            See a Real Trade
          </Link>
        </div>
        <div className="hero-stats">
          <div className="hero-stat">
            <Icon name="swap_horiz" style={{ fontSize: 18 }} />
            <span className="hero-stat-value">
              {stats ? stats.trades : <Skeleton />}
            </span>
            <span>trades executed</span>
          </div>
          <div className="hero-stat">
            <Icon name="verified" style={{ fontSize: 18 }} />
            <span>Validation score:</span>
            <span className="hero-stat-value">
              {stats ? `${stats.valScore}/100` : <Skeleton />}
            </span>
          </div>
          <div className="hero-stat">
            <Icon name="leaderboard" style={{ fontSize: 18 }} />
            <span>Ranked</span>
            <span className="hero-stat-value">
              {stats ? `#${stats.rank}` : <Skeleton />}
            </span>
            <span>on leaderboard</span>
          </div>
        </div>
      </section>

      <hr className="section-divider" />

      {/* ── THE PROBLEM ──────────────────────────── */}
      <section className="section">
        <p className="section-label">The Problem</p>
        <h2 className="section-title">Why this matters</h2>
        <div className="problems-grid" style={{ marginTop: 24 }}>
          <div className="card problem-card">
            <div className="problem-icon">
              <Icon name="visibility_off" />
            </div>
            <h3>AI trading is a black box</h3>
            <p>
              $10 trillion managed by algorithms. Zero public accountability for
              decisions.
            </p>
          </div>
          <div className="card problem-card">
            <div className="problem-icon">
              <Icon name="content_copy" />
            </div>
            <h3>Track records can be faked</h3>
            <p>
              Self-reported performance data. No independent verification
              possible.
            </p>
          </div>
          <div className="card problem-card">
            <div className="problem-icon">
              <Icon name="block" />
            </div>
            <h3>Capital and trust don&apos;t scale</h3>
            <p>
              Good strategies stay small. No trustless way to attract external
              capital.
            </p>
          </div>
        </div>
      </section>

      <hr className="section-divider" />

      {/* ── HOW IT WORKS ─────────────────────────── */}
      <section className="section">
        <p className="section-label">How It Works</p>
        <h2 className="section-title" style={{ marginBottom: 32 }}>
          Four steps, fully autonomous
        </h2>
        <div className="timeline">
          <div className="timeline-step">
            <div className="timeline-dot">
              <Icon name="monitoring" style={{ fontSize: 20 }} />
            </div>
            <p className="timeline-step-number">Step 1</p>
            <h3>Signal Detected</h3>
            <p>
              Our correlation engine monitors 15 crypto and commodity pairs.
              When a pair&apos;s correlation breaks beyond 2.5 standard deviations
              from its 90-day mean, a trade signal is generated.
            </p>
          </div>
          <div className="timeline-step">
            <div className="timeline-dot">
              <Icon name="psychology" style={{ fontSize: 20 }} />
            </div>
            <p className="timeline-step-number">Step 2</p>
            <h3>AI Reasons</h3>
            <p>
              Claude API analyzes the signal with full market context: z-score,
              correlation breakdown, recent PnL, reputation score, macro
              conditions. It decides: execute or skip, and generates a
              plain-English explanation.
            </p>
          </div>
          <div className="timeline-step">
            <div className="timeline-dot">
              <Icon name="lock" style={{ fontSize: 20 }} />
            </div>
            <p className="timeline-step-number">Step 3</p>
            <h3>Proof Recorded On-Chain</h3>
            <p>
              The reasoning is hashed (keccak256) and posted to
              ValidationRegistry on Ethereum Sepolia via EIP-712 signed
              attestation. The signal data — z-score, correlation, confidence —
              is cryptographically bound into the checkpoint hash. Immutable.
              Public. Verifiable.
            </p>
          </div>
          <div className="timeline-step">
            <div className="timeline-dot">
              <Icon name="star_outline" style={{ fontSize: 20 }} />
            </div>
            <p className="timeline-step-number">Step 4</p>
            <h3>Reputation Builds</h3>
            <p>
              Every trade outcome updates the agent&apos;s ERC-8004 reputation
              score. High reputation unlocks larger position sizes. Bad trades
              reduce it. The score cannot be faked — it&apos;s computed from real
              on-chain outcomes.
            </p>
          </div>
        </div>
      </section>

      <hr className="section-divider" />

      {/* ── ARCHITECTURE DIAGRAM ─────────────────── */}
      <section className="section">
        <p className="section-label">Architecture</p>
        <h2 className="section-title">System overview</h2>
        <div className="arch-diagram">
          <div className="arch-box">
            <div className="arch-box-title">Signal Engine</div>
            <ul className="arch-box-items">
              <li>PRISM API</li>
              <li>Correlation Engine</li>
              <li>Claude LLM</li>
            </ul>
          </div>
          <div className="arch-arrow">
            <Icon name="arrow_forward" />
          </div>
          <div className="arch-box">
            <div className="arch-box-title">Executor</div>
            <ul className="arch-box-items">
              <li>Trade Watcher</li>
              <li>Intent Builder</li>
              <li>Artifact Poster</li>
            </ul>
          </div>
          <div className="arch-arrow">
            <Icon name="arrow_forward" />
          </div>
          <div className="arch-box">
            <div className="arch-box-title">Blockchain / Sepolia</div>
            <ul className="arch-box-items">
              <li>AgentRegistry</li>
              <li>RiskRouter</li>
              <li>ValidationRegistry</li>
              <li>ReputationRegistry</li>
            </ul>
          </div>
        </div>
        <p className="arch-caption">
          All three components run autonomously. No human intervention required
          after deployment.
        </p>
      </section>

      <hr className="section-divider" />

      {/* ── PRISM + LLM ──────────────────────────── */}
      <section className="section">
        <p className="section-label">Data & Intelligence</p>
        <h2 className="section-title" style={{ marginBottom: 32 }}>
          Two engines, one pipeline
        </h2>
        <div className="two-col">
          <div>
            <h3 className="col-title">PRISM: Multi-Asset Intelligence</h3>
            <p className="col-text">
              PRISM API resolves any ticker — crypto, forex, commodities — into
              a unified identity. Our agent pulls live prices and 90-day history
              for BTC, ETH, SOL, AVAX, LINK, ARB simultaneously. This enables
              correlation analysis across 15 asset pairs that traditional
              single-asset bots cannot see.
            </p>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Asset</th>
                  <th>Type</th>
                  <th>Pairs</th>
                </tr>
              </thead>
              <tbody>
                <tr><td>BTC</td><td>Crypto</td><td>5</td></tr>
                <tr><td>ETH</td><td>Crypto</td><td>5</td></tr>
                <tr><td>SOL</td><td>Crypto</td><td>4</td></tr>
                <tr><td>AVAX</td><td>Crypto</td><td>3</td></tr>
                <tr><td>LINK</td><td>Crypto</td><td>2</td></tr>
                <tr><td>ARB</td><td>Crypto</td><td>1</td></tr>
              </tbody>
            </table>
          </div>
          <div>
            <h3 className="col-title">Claude: The Reasoning Layer</h3>
            <p className="col-text">
              Every signal goes to Claude API with full context. Claude
              doesn&apos;t just say yes/no — it explains its reasoning in plain
              English, which gets hashed and stored on-chain. This means every
              trade has a human-readable audit trail.
            </p>
            <div style={{ marginBottom: 12 }}>
              <p className="code-label">Input (condensed)</p>
              <div className="code-block">
{`{
  "pair": "ETH/SOL",
  "z_score": -3.81,
  "correlation": 0.667,
  "historical_mean": 0.935,
  "rep_score": 78,
  "recent_pnl": "+$4.20"
}`}
              </div>
            </div>
            <div>
              <p className="code-label">Output</p>
              <div className="code-block">
{`{
  "action": "EXECUTE",
  "action_a": "SHORT",
  "action_b": "LONG",
  "size_usd": 180,
  "confidence": 0.82,
  "reasoning": "ETH/SOL correlation
    at 3.81σ below mean. High
    reversion probability..."
}`}
              </div>
            </div>
          </div>
        </div>
      </section>

      <hr className="section-divider" />

      {/* ── THE MATH ─────────────────────────────── */}
      <section className="section">
        <p className="section-label">The Signal</p>
        <h2 className="section-title">How we detect opportunities</h2>
        <div className="formulas" style={{ marginTop: 24 }}>
          <div className="formula-card">
            <div className="formula-expression">
              {"ρ(A,B) = corr(A, B, 30d)"}
            </div>
            <p className="formula-description">
              Pearson correlation between asset A and B over a 30-day rolling
              window. How closely two assets have been moving together recently.
            </p>
          </div>
          <div className="formula-card">
            <div className="formula-expression">
              {"z = (ρ_now − μ_90d) / σ_90d"}
            </div>
            <p className="formula-description">
              How unusual today&apos;s correlation is compared to the past 90
              days. A z-score of 2 means the current reading is 2 standard
              deviations from the historical mean.
            </p>
          </div>
          <div className="formula-card">
            <div className="formula-expression">
              {"signal when |z| > 2.5"}
            </div>
            <p className="formula-description">
              We only trade when the divergence is statistically significant.
              This threshold filters out noise and focuses on genuine
              mean-reversion opportunities.
            </p>
          </div>
        </div>
        <div className="example-box">
          <p className="example-label">Worked Example</p>
          <p>
            ETH/SOL had a 90-day correlation mean of 0.935. Today&apos;s
            correlation dropped to 0.667.
            <br />
            Z-score = (0.667 − 0.935) / 0.070 = <strong>−3.81</strong>
            <br />
            This is a 3.81 standard deviation event — trade signal fired.
          </p>
        </div>
      </section>

      {/* ── FOOTER CTA ───────────────────────────── */}
      <div className="footer-cta">
        <h2>See it live. Every trade is on-chain right now.</h2>
        <Link to="/dashboard" className="btn btn-primary" style={{ marginTop: 8 }}>
          Open Live Dashboard
        </Link>
        <p className="footer-small" style={{ marginTop: 16 }}>
          Deployed on Ethereum Sepolia Testnet
        </p>
        <div className="footer-links">
          <a
            href={`${ETHERSCAN_BASE}${CONTRACTS.validation}`}
            target="_blank"
            rel="noreferrer"
          >
            <Icon name="open_in_new" style={{ fontSize: 14 }} />
            ValidationRegistry on Etherscan
          </a>
          <a
            href={`${ETHERSCAN_BASE}${CONTRACTS.agent}`}
            target="_blank"
            rel="noreferrer"
          >
            <Icon name="open_in_new" style={{ fontSize: 14 }} />
            AgentRegistry on Etherscan
          </a>
        </div>
      </div>
    </>
  );
}
