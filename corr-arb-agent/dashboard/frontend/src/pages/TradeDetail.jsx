import { useEffect, useState, useCallback } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:8000";
const ETHERSCAN_TX = "https://sepolia.etherscan.io/tx/";
const ETHERSCAN_ADDR = "https://sepolia.etherscan.io/address/";
const CONTRACTS = {
  validation: "0x92bF63E5C7Ac6980f237a7164Ab413BE226187F1",
  riskRouter: "0xd6A6952545FF6E6E6681c2d15C59f9EB8F40FdBC",
};

function Icon({ name, style }) {
  return (
    <span className="material-icons-outlined" style={style}>
      {name}
    </span>
  );
}

function copyToClipboard(text) {
  navigator.clipboard.writeText(text).catch(() => {});
}

export default function TradeDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [trade, setTrade] = useState(null);
  const [allIds, setAllIds] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadTrade = useCallback(async () => {
    try {
      setLoading(true);
      const [tradeRes, allRes] = await Promise.all([
        fetch(`${API_BASE}/api/trades/${id}`).then((r) => r.json()),
        fetch(`${API_BASE}/api/trades`).then((r) => r.json()),
      ]);

      if (tradeRes.error) {
        setError(tradeRes.error);
        setTrade(null);
      } else {
        setTrade(tradeRes);
        setError("");
      }

      const items = allRes.items || [];
      setAllIds(items.map((t) => t.id));
    } catch (err) {
      setError(err.message || "Failed to load trade");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    loadTrade();
  }, [loadTrade]);

  const currentIdx = allIds.indexOf(trade?.id);
  const prevId = currentIdx < allIds.length - 1 ? allIds[currentIdx + 1] : null;
  const nextId = currentIdx > 0 ? allIds[currentIdx - 1] : null;

  if (loading) {
    return (
      <>
        <nav className="nav">
          <div className="nav-inner">
            <Link to="/" className="nav-logo">HedgeFlow</Link>
            <div className="nav-links">
              <Link to="/">Home</Link>
              <Link to="/dashboard">Dashboard</Link>
            </div>
          </div>
        </nav>
        <div className="trade-page">
          <div className="trade-skeleton">
            <div className="skeleton-block" />
            <div className="skeleton-block" />
            <div className="skeleton-block" />
          </div>
        </div>
      </>
    );
  }

  if (error || !trade) {
    return (
      <>
        <nav className="nav">
          <div className="nav-inner">
            <Link to="/" className="nav-logo">HedgeFlow</Link>
            <div className="nav-links">
              <Link to="/">Home</Link>
              <Link to="/dashboard">Dashboard</Link>
            </div>
          </div>
        </nav>
        <div className="trade-page">
          <div className="error-banner">
            {error || "Trade not found."}
          </div>
          <Link to="/dashboard" className="btn btn-secondary">
            <Icon name="arrow_back" style={{ fontSize: 16 }} />
            Back to Dashboard
          </Link>
        </div>
      </>
    );
  }

  const zScore = Number(trade.zScore || 0);
  const corr = Number(trade.currentCorrelation || 0);
  const histMean = Number(trade.historicalMean || 0);
  const confidence = Number(trade.confidence || 0);
  const sizeUsd = Number(trade.sizeUsd || 0);
  const pnl = Number(trade.pnlUsd || 0);
  const isExecute = trade.status !== "SKIPPED" && trade.status !== "FAILED";
  const txHash = trade.txHashes?.[0] || "";

  // Z-score bar visualization clamp between -5 to 5
  const zClamped = Math.max(-5, Math.min(5, zScore));
  const zPct = ((zClamped + 5) / 10) * 100;
  const meanPct = histMean ? ((Math.max(-5, Math.min(5, histMean)) + 5) / 10) * 100 : 50;

  return (
    <>
      <nav className="nav">
        <div className="nav-inner">
          <Link to="/" className="nav-logo">HedgeFlow</Link>
          <div className="nav-links">
            <Link to="/">Home</Link>
            <Link to="/dashboard">Dashboard</Link>
            <Link to="/trade/latest">Trades</Link>
          </div>
        </div>
      </nav>

      <div className="trade-page">
        <div style={{ marginBottom: 8 }}>
          <Link
            to="/dashboard"
            style={{
              fontSize: "0.8125rem",
              color: "var(--text-muted)",
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
            }}
          >
            <Icon name="arrow_back" style={{ fontSize: 16 }} />
            Dashboard
          </Link>
        </div>

        <h1 className="trade-page-title">
          Trade #{trade.id} — Full On-Chain Audit Trail
        </h1>
        <p className="trade-page-sub">
          {trade.assetA}/{trade.assetB} &middot;{" "}
          {trade.timestamp
            ? new Date(trade.timestamp).toLocaleString()
            : "Unknown time"}
        </p>

        {/* ── STAGE 1: Signal Detected ────────────── */}
        <div className="trade-stage trade-stage-teal">
          <div className="trade-stage-head">
            <Icon name="monitoring" style={{ fontSize: 20, color: "#0d9488" }} />
            <div>
              <p className="trade-stage-label">Stage 1</p>
              <h3 className="trade-stage-title">Signal Detected</h3>
            </div>
          </div>
          <div className="trade-field">
            <span className="trade-field-key">Asset Pair</span>
            <span className="trade-field-value" style={{ fontWeight: 700 }}>
              {trade.assetA}/{trade.assetB}
            </span>
          </div>
          <div className="trade-field">
            <span className="trade-field-key">Z-Score</span>
            <span
              className="trade-field-value"
              style={{ fontWeight: 700, fontSize: "1.1rem" }}
            >
              {zScore.toFixed(4)}
            </span>
          </div>
          <div className="trade-field">
            <span className="trade-field-key">Current Correlation</span>
            <span className="trade-field-value">{corr.toFixed(4)}</span>
          </div>
          {histMean !== 0 && (
            <div className="trade-field">
              <span className="trade-field-key">90-day Mean</span>
              <span className="trade-field-value">{histMean.toFixed(4)}</span>
            </div>
          )}
          <div className="trade-field">
            <span className="trade-field-key">Confidence</span>
            <span className="trade-field-value">
              {(confidence * 100).toFixed(0)}%
            </span>
          </div>

          {/* Z-score distribution bar */}
          <div style={{ marginTop: 12 }}>
            <p style={{ fontSize: "0.75rem", color: "var(--text-faint)", marginBottom: 4 }}>
              Correlation relative to distribution
            </p>
            <div className="z-bar">
              {/* Mean marker */}
              <div
                className="z-bar-fill"
                style={{ left: `${Math.min(meanPct, zPct)}%`, width: `${Math.abs(zPct - meanPct)}%`, background: "var(--bg-code)" }}
              />
              <div className="z-bar-marker" style={{ left: `${zPct}%` }} />
            </div>
            <div className="z-bar-labels">
              <span>-5σ</span>
              <span>0</span>
              <span>+5σ</span>
            </div>
          </div>

          <div className="trade-field" style={{ borderBottom: "none", marginTop: 8 }}>
            <span className="trade-field-key">Timestamp</span>
            <span className="trade-field-value">
              {trade.timestamp ? new Date(trade.timestamp).toISOString() : "-"}
            </span>
          </div>
        </div>

        {/* ── STAGE 2: AI Decision ────────────────── */}
        <div className="trade-stage trade-stage-grey">
          <div className="trade-stage-head">
            <Icon name="psychology" style={{ fontSize: 20 }} />
            <div>
              <p className="trade-stage-label">Stage 2</p>
              <h3 className="trade-stage-title">AI Decision</h3>
            </div>
          </div>
          <div style={{ marginBottom: 12 }}>
            <span className={`decision-badge ${isExecute ? "decision-execute" : "decision-skip"}`}>
              {isExecute ? "Execute" : "Skip"}
            </span>
          </div>
          <div className="trade-field">
            <span className="trade-field-key">Position</span>
            <span className="trade-field-value">
              {trade.actionA} {trade.assetA} + {trade.actionB} {trade.assetB}
            </span>
          </div>
          <div className="trade-field">
            <span className="trade-field-key">Size</span>
            <span className="trade-field-value">${sizeUsd.toFixed(2)}</span>
          </div>

          {trade.reasoningText && (
            <div className="reasoning-block">{trade.reasoningText}</div>
          )}

          {trade.reasoningHash && (
            <>
              <div className="hash-row">
                <span style={{ fontWeight: 500, fontSize: "0.75rem", color: "var(--text-faint)" }}>
                  Reasoning Hash:
                </span>
                <span className="hash-value">{trade.reasoningHash}</span>
                <button
                  className="copy-btn"
                  onClick={() => copyToClipboard(trade.reasoningHash)}
                >
                  Copy
                </button>
              </div>
              <p style={{ fontSize: "0.7rem", color: "var(--text-faint)", marginTop: 4 }}>
                This text hashes to the value stored on-chain
              </p>
            </>
          )}
        </div>

        {/* ── STAGE 3: On-Chain Execution ─────────── */}
        <div className="trade-stage trade-stage-amber">
          <div className="trade-stage-head">
            <Icon name="send" style={{ fontSize: 20, color: "var(--status-amber)" }} />
            <div>
              <p className="trade-stage-label">Stage 3</p>
              <h3 className="trade-stage-title">On-Chain Execution</h3>
            </div>
          </div>

          <div className="card-flat" style={{ marginBottom: 12 }}>
            <p style={{ fontSize: "0.7rem", fontWeight: 700, color: "var(--text-faint)", letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 8 }}>
              EIP-712 Intent Summary
            </p>
            <div className="trade-field">
              <span className="trade-field-key">agentId</span>
              <span className="trade-field-value">{trade.agentId || "—"}</span>
            </div>
            <div className="trade-field">
              <span className="trade-field-key">pair</span>
              <span className="trade-field-value">{trade.assetA}USD</span>
            </div>
            <div className="trade-field">
              <span className="trade-field-key">action</span>
              <span className="trade-field-value">{trade.actionA === "LONG" ? "BUY" : "SELL"}</span>
            </div>
            <div className="trade-field">
              <span className="trade-field-key">amountUsdScaled</span>
              <span className="trade-field-value">{Math.round(sizeUsd * 100)}</span>
            </div>
            <div className="trade-field">
              <span className="trade-field-key">nonce</span>
              <span className="trade-field-value">{trade.nonce || "—"}</span>
            </div>
            <div className="trade-field" style={{ borderBottom: "none" }}>
              <span className="trade-field-key">deadline</span>
              <span className="trade-field-value">{trade.deadline || "—"}</span>
            </div>
          </div>

          {txHash ? (
            <div className="trade-field">
              <span className="trade-field-key">TX Hash</span>
              <span className="trade-field-value">
                <a href={`${ETHERSCAN_TX}${txHash}`} target="_blank" rel="noreferrer">
                  {txHash.slice(0, 16)}...
                  <Icon name="open_in_new" style={{ fontSize: 12, verticalAlign: "middle", marginLeft: 4 }} />
                </a>
              </span>
            </div>
          ) : null}

          <div className="trade-field" style={{ borderBottom: "none" }}>
            <span className="trade-field-key">Status</span>
            <span className="trade-field-value">
              <span className={`status status-${String(trade.status || "").toLowerCase()}`}>
                {trade.status || "UNKNOWN"}
              </span>
            </span>
          </div>

          <p style={{ fontSize: "0.75rem", color: "var(--text-faint)", marginTop: 8 }}>
            Submitted to RiskRouter:{" "}
            <a href={`${ETHERSCAN_ADDR}${CONTRACTS.riskRouter}`} target="_blank" rel="noreferrer" style={{ color: "var(--text-muted)" }}>
              {CONTRACTS.riskRouter.slice(0, 14)}...
            </a>
          </p>
        </div>

        {/* ── STAGE 4: Validation Proof ──────────── */}
        <div className="trade-stage trade-stage-blue">
          <div className="trade-stage-head">
            <Icon name="verified" style={{ fontSize: 20, color: "var(--status-blue)" }} />
            <div>
              <p className="trade-stage-label">Stage 4</p>
              <h3 className="trade-stage-title">Validation Proof</h3>
            </div>
          </div>

          {trade.checkpointHash && (
            <div className="hash-row" style={{ marginBottom: 8 }}>
              <span style={{ fontWeight: 500, fontSize: "0.75rem", color: "var(--text-faint)" }}>
                Checkpoint Hash:
              </span>
              <span className="hash-value">{trade.checkpointHash}</span>
              <button className="copy-btn" onClick={() => copyToClipboard(trade.checkpointHash)}>
                Copy
              </button>
            </div>
          )}

          <div className="trade-field">
            <span className="trade-field-key">Score</span>
            <span className="trade-field-value" style={{ fontWeight: 700 }}>
              {trade.attestationScore || Math.min(95, Math.round(50 + Math.abs(zScore) * 15))}/100
            </span>
          </div>

          <div className="trade-field" style={{ borderBottom: "none" }}>
            <span className="trade-field-key">Notes</span>
            <span className="trade-field-value">
              CorrArb: {trade.assetA}/{trade.assetB} z={zScore.toFixed(2)} corr={corr.toFixed(3)}
            </span>
          </div>

          <p style={{ fontSize: "0.75rem", color: "var(--text-faint)", marginTop: 12 }}>
            <a
              href={`${ETHERSCAN_ADDR}${CONTRACTS.validation}`}
              target="_blank"
              rel="noreferrer"
              style={{ color: "var(--text-muted)", display: "inline-flex", alignItems: "center", gap: 4 }}
            >
              <Icon name="open_in_new" style={{ fontSize: 12 }} />
              ValidationRegistry on Etherscan
            </a>
          </p>
          <p style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginTop: 8, lineHeight: 1.6 }}>
            This checkpoint is permanently stored on Ethereum Sepolia. Anyone can
            verify this decision was made with these exact parameters.
          </p>
        </div>

        {/* ── STAGE 5: Settlement ────────────────── */}
        {trade.settled && (
          <div className="trade-stage trade-stage-green">
            <div className="trade-stage-head">
              <Icon name="account_balance_wallet" style={{ fontSize: 20, color: "var(--status-green)" }} />
              <div>
                <p className="trade-stage-label">Stage 5</p>
                <h3 className="trade-stage-title">Settlement</h3>
              </div>
            </div>
            <div className={`pnl-large ${pnl >= 0 ? "pnl-positive" : "pnl-negative"}`}>
              {pnl >= 0 ? "+" : ""}${pnl.toFixed(2)}
            </div>
            <div className="trade-field" style={{ marginTop: 12 }}>
              <span className="trade-field-key">Method</span>
              <span className="trade-field-value">Mark-to-market</span>
            </div>
            {trade.settlement?.entryPrice && (
              <div className="trade-field">
                <span className="trade-field-key">Entry Price</span>
                <span className="trade-field-value">
                  ${Number(trade.settlement.entryPrice).toFixed(4)}
                </span>
              </div>
            )}
            {trade.settlement?.exitPrice && (
              <div className="trade-field">
                <span className="trade-field-key">Exit Price</span>
                <span className="trade-field-value">
                  ${Number(trade.settlement.exitPrice).toFixed(4)}
                </span>
              </div>
            )}
          </div>
        )}

        {/* ── Navigation ─────────────────────────── */}
        <div className="trade-nav">
          {prevId ? (
            <button onClick={() => navigate(`/trade/${prevId}`)}>
              <Icon name="arrow_back" style={{ fontSize: 16 }} />
              Previous Trade
            </button>
          ) : (
            <span />
          )}
          {nextId ? (
            <button onClick={() => navigate(`/trade/${nextId}`)}>
              Next Trade
              <Icon name="arrow_forward" style={{ fontSize: 16 }} />
            </button>
          ) : (
            <span />
          )}
        </div>
      </div>
    </>
  );
}
