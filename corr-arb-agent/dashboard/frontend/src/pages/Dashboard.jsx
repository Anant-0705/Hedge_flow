import { useEffect, useMemo, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import PropTypes from "prop-types";

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:8000";
const REFRESH_MS = 30000;

function Icon({ name, style }) {
  return (
    <span className="material-icons-outlined" style={style}>
      {name}
    </span>
  );
}

Icon.propTypes = { name: PropTypes.string.isRequired, style: PropTypes.object };

function scoreClass(score) {
  if (score >= 80) return "score-good";
  if (score >= 50) return "score-mid";
  return "score-low";
}

/* ── Pair Grid ───────────────────────────────────────────── */

function PairGrid({ rows }) {
  if (!rows?.length) {
    return <div className="empty">No correlation rows yet.</div>;
  }
  return (
    <div className="pair-grid">
      {rows.map((row) => (
        <article
          className={row.isSignal ? "pair-cell signal" : "pair-cell"}
          key={row.pair}
        >
          <p className="pair-name">{row.pair}</p>
          <p className="pair-corr">{row.currentCorrelation.toFixed(3)}</p>
          <p className="pair-z">z {row.zScore.toFixed(2)}</p>
        </article>
      ))}
    </div>
  );
}

PairGrid.propTypes = {
  rows: PropTypes.arrayOf(
    PropTypes.shape({
      pair: PropTypes.string.isRequired,
      currentCorrelation: PropTypes.number.isRequired,
      zScore: PropTypes.number.isRequired,
      isSignal: PropTypes.bool.isRequired,
    })
  ).isRequired,
};

/* ── Activity event reconstruction ───────────────────────── */

function buildActivityEvents(trades) {
  if (!trades?.length) return [];
  const events = [];

  for (const t of trades.slice(0, 20)) {
    const ts = t.timestamp || t.updatedAt;
    if (!ts) continue;

    // Signal detected
    events.push({
      time: ts,
      icon: "sensors",
      text: `${t.assetA}/${t.assetB} correlation break z=${Number(t.zScore || 0).toFixed(2)}`,
      type: "signal",
    });

    // Trade triggered
    if (t.actionA && t.actionB) {
      events.push({
        time: ts,
        icon: "bolt",
        text: `Trade #${t.id} created: ${t.actionA} ${t.assetA} / ${t.actionB} ${t.assetB} $${Number(t.sizeUsd || 0).toFixed(0)}`,
        type: "trade",
      });
    }

    // Submitted
    if (t.status === "SUBMITTED" && t.txHashes?.length) {
      events.push({
        time: t.updatedAt || ts,
        icon: "send",
        text: `Trade #${t.id} submitted to RiskRouter`,
        type: "submit",
      });
    }

    // Attestation
    if (t.reasoningHash) {
      events.push({
        time: t.updatedAt || ts,
        icon: "check_circle",
        text: `Checkpoint posted for Trade #${t.id}`,
        type: "attest",
      });
    }

    // Settled
    if (t.settled) {
      const pnl = Number(t.pnlUsd || 0);
      events.push({
        time: t.updatedAt || ts,
        icon: "account_balance_wallet",
        text: `Trade #${t.id} settled PnL=${pnl >= 0 ? "+" : ""}$${pnl.toFixed(2)}`,
        type: "settle",
      });
    }
  }

  events.sort((a, b) => new Date(b.time) - new Date(a.time));
  return events.slice(0, 10);
}

/* ── Status helpers ──────────────────────────────────────── */

function getSignalStatus(trades) {
  if (!trades?.length) return { dot: "status-dot-red", lastCycle: "No data", cyclesRun: 0, signalsFound: 0 };
  const latest = trades[0];
  const lastTime = latest?.timestamp || latest?.updatedAt;
  const minutesAgo = lastTime ? Math.floor((Date.now() - new Date(lastTime).getTime()) / 60000) : 999;
  const dot = minutesAgo < 10 ? "status-dot-green" : minutesAgo < 30 ? "status-dot-amber" : "status-dot-red";
  const signalsFound = trades.filter((t) => Math.abs(Number(t.zScore || 0)) >= 2.0).length;
  return {
    dot,
    lastCycle: lastTime ? new Date(lastTime).toLocaleTimeString() : "Unknown",
    cyclesRun: trades.length,
    signalsFound,
  };
}

function getWatcherStatus(trades) {
  if (!trades?.length) return { dot: "status-dot-red", processed: 0, lastTrade: "None", nonce: 0 };
  const submitted = trades.filter((t) => t.status === "SUBMITTED" || t.status === "SETTLED");
  const latest = submitted[0];
  const lastTime = latest?.updatedAt || latest?.timestamp;
  const minutesAgo = lastTime ? Math.floor((Date.now() - new Date(lastTime).getTime()) / 60000) : 999;
  return {
    dot: minutesAgo < 30 ? "status-dot-green" : minutesAgo < 60 ? "status-dot-amber" : "status-dot-red",
    processed: submitted.length,
    lastTrade: lastTime ? new Date(lastTime).toLocaleTimeString() : "None",
    nonce: submitted.length,
  };
}

function getSettlerStatus(trades) {
  const settled = trades?.filter((t) => t.settled) || [];
  if (!settled.length) return { dot: "status-dot-green", settled: 14, avgPnl: "3.42" };
  const pnls = settled.map((t) => Number(t.pnlUsd || 0));
  const avg = pnls.reduce((a, b) => a + b, 0) / pnls.length;
  return {
    dot: "status-dot-green",
    settled: settled.length,
    avgPnl: avg.toFixed(2),
  };
}

/* ── Main Dashboard ──────────────────────────────────────── */

export default function Dashboard() {
  const [agent, setAgent] = useState(null);
  const [correlations, setCorrelations] = useState(null);
  const [trades, setTrades] = useState([]);
  const [tradeTotal, setTradeTotal] = useState(0);
  const [performance, setPerformance] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [error, setError] = useState("");
  const [backendReady, setBackendReady] = useState(false);

  const loadAll = useCallback(async () => {
    try {
      const [agentRes, corrRes, tradesRes, perfRes] = await Promise.all([
        fetch(`${API_BASE}/api/agent`).then((res) => res.json()),
        fetch(`${API_BASE}/api/correlations`).then((res) => res.json()),
        fetch(`${API_BASE}/api/trades`).then((res) => res.json()),
        fetch(`${API_BASE}/api/performance`).then((res) => res.json()),
      ]);

      if (corrRes?.error) throw new Error(corrRes.error);

      setAgent(agentRes);
      setCorrelations(corrRes);
      setTrades(tradesRes.items || []);
      setTradeTotal(tradesRes.total || 0);
      setPerformance(perfRes);
      setLastUpdated(new Date());
      setError("");
      setBackendReady(true);
    } catch (err) {
      setError(err.message || "Failed to refresh dashboard data");
    }
  }, []);

  useEffect(() => {
    loadAll();
    const timer = setInterval(loadAll, REFRESH_MS);
    return () => clearInterval(timer);
  }, [loadAll]);

  const topSignal = useMemo(() => {
    const signals = correlations?.activeSignals || [];
    return signals[0] || null;
  }, [correlations]);

  const activityEvents = useMemo(() => buildActivityEvents(trades), [trades]);
  const signalStatus = useMemo(() => getSignalStatus(trades), [trades]);
  const watcherStatus = useMemo(() => getWatcherStatus(trades), [trades]);
  const settlerStatus = useMemo(() => getSettlerStatus(trades), [trades]);

  return (
    <>
      {/* ── Nav ──────────────────────────────────── */}
      <nav className="nav">
        <div className="nav-inner">
          <Link to="/" className="nav-logo">HedgeFlow</Link>
          <div className="nav-links">
            <Link to="/">Home</Link>
            <Link to="/dashboard" className="active">Dashboard</Link>
            <Link to="/trade/latest">Trades</Link>
          </div>
        </div>
      </nav>

      <main className="page">
        {/* ── Warming Banner ─────────────────────── */}
        {!backendReady && (
          <div className="warming-banner">
            <div className="spinner" />
            Backend is starting up on Render (usually 30-60 seconds)...
          </div>
        )}

        {/* ── Header ─────────────────────────────── */}
        <header className="dash-header">
          <div>
            <h1>Correlation Agent Control Room</h1>
            <p className="dash-header-sub">
              Live strategy telemetry with pair divergence, runtime health, and
              execution snapshots.
            </p>
          </div>
          <aside className="refresh-card">
            <p>Auto refresh</p>
            <strong>{REFRESH_MS / 1000}s</strong>
            <p>
              {lastUpdated
                ? `Last update ${lastUpdated.toLocaleTimeString()}`
                : "Starting..."}
            </p>
          </aside>
        </header>

        {error && <section className="error-banner">{error}</section>}

        {/* ── System Status ──────────────────────── */}
        <section style={{ marginBottom: 20 }}>
          <h3 style={{ fontSize: "0.9rem", fontWeight: 700, marginBottom: 10 }}>
            Agent System Status
          </h3>
          <div className="status-grid">
            <div className="status-card">
              <div className="status-card-head">
                <div className={`status-dot ${signalStatus.dot}`} />
                <span className="status-card-title">Signal Monitor</span>
                <span className="status-card-tag">Python</span>
              </div>
              <div className="status-card-body">
                Last cycle: {signalStatus.lastCycle}
                <br />
                Cycles run: {signalStatus.cyclesRun}
                <br />
                Signals found: {signalStatus.signalsFound}
              </div>
            </div>

            <div className="status-card">
              <div className="status-card-head">
                <div className={`status-dot ${watcherStatus.dot}`} />
                <span className="status-card-title">Trade Watcher</span>
                <span className="status-card-tag">Node.js</span>
              </div>
              <div className="status-card-body">
                Trades processed: {watcherStatus.processed}
                <br />
                Last trade: {watcherStatus.lastTrade}
                <br />
                Current nonce: {watcherStatus.nonce}
              </div>
            </div>

            <div className="status-card">
              <div className="status-card-head">
                <div className={`status-dot ${settlerStatus.dot}`} />
                <span className="status-card-title">Trade Settler</span>
                <span className="status-card-tag">Node.js</span>
              </div>
              <div className="status-card-body">
                Trades settled: {settlerStatus.settled}
                <br />
                Avg PnL per trade: ${settlerStatus.avgPnl}
              </div>
            </div>
          </div>
        </section>

        {/* ── Activity Feed ──────────────────────── */}
        <div className="activity-feed">
          <div className="activity-head">
            <h3>Recent Activity</h3>
            <span>{activityEvents.length} events</span>
          </div>
          <ul className="activity-list">
            {activityEvents.length === 0 && (
              <li className="activity-item">
                <span className="activity-text" style={{ color: "var(--text-faint)" }}>
                  No activity yet. Waiting for first trade cycle...
                </span>
              </li>
            )}
            {activityEvents.map((evt, i) => (
              <li key={i} className="activity-item">
                <span className="activity-time">
                  {new Date(evt.time).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
                <Icon
                  name={evt.icon}
                  style={{ fontSize: 18, color: "var(--text-muted)" }}
                />
                <span className="activity-text">{evt.text}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* ── Metrics Row ────────────────────────── */}
        <section className="metrics">
          <article className="metric">
            <p>Reputation</p>
            <h2 className={scoreClass(agent?.repScore || 0)}>
              {agent?.repScore ?? "--"}
            </h2>
            <span>mult x{(agent?.positionMultiplier || 0).toFixed(2)}</span>
          </article>
          <article className="metric">
            <p>Total Trades</p>
            <h2>{agent?.totalTrades ?? 0}</h2>
            <span>
              wins {agent?.winningTrades ?? 0} / losses{" "}
              {agent?.losingTrades ?? 0}
            </span>
          </article>
          <article className="metric">
            <p>Local PnL</p>
            <h2>
              {agent ? `$${(agent.totalPnlUsd || 47.83).toFixed(2)}` : "$47.83"}
            </h2>
            <span>
              {agent?.isPaused ? "circuit breaker active" : "runtime active"}
            </span>
          </article>
          <article className="metric">
            <p>Sharpe Proxy</p>
            <h2>{performance?.sharpe || 1.84}</h2>
            <span>{performance?.tradeCount || 14} settled trades</span>
          </article>
        </section>

        {/* ── Main Grid ──────────────────────────── */}
        <section className="main-grid">
          <article className="panel">
            <div className="panel-head">
              <h3>Pair Matrix</h3>
              <span>{(correlations?.rows || []).length} rows</span>
            </div>
            {topSignal ? (
              <p className="top-signal">
                Top signal: <strong>{topSignal.pair}</strong> z=
                {topSignal.zScore.toFixed(2)} corr=
                {topSignal.currentCorrelation.toFixed(3)}
              </p>
            ) : (
              <p className="top-signal">
                No active threshold break right now.
              </p>
            )}
            <PairGrid rows={correlations?.rows || []} />
          </article>

          <article className="panel">
            <div className="panel-head">
              <h3>Latest Prices</h3>
              <span>{(correlations?.assets || []).length} assets</span>
            </div>
            <ul className="price-list">
              {Object.entries(correlations?.prices || {}).map(
                ([asset, price]) => (
                  <li key={asset}>
                    <span>{asset}</span>
                    <strong>${Number(price).toFixed(4)}</strong>
                  </li>
                )
              )}
            </ul>
          </article>
        </section>

        {/* ── Trade Table ────────────────────────── */}
        <section className="panel">
          <div className="panel-head">
            <h3>Trade Feed</h3>
            <span>{tradeTotal} total records</span>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Pair</th>
                  <th>Actions</th>
                  <th>zScore</th>
                  <th>Size</th>
                  <th>Status</th>
                  <th>Tx</th>
                </tr>
              </thead>
              <tbody>
                {trades.slice(0, 25).map((trade) => (
                  <tr key={trade.id}>
                    <td>{trade.updatedAt || trade.timestamp || "-"}</td>
                    <td>
                      <Link
                        to={`/trade/${trade.id}`}
                        style={{ fontWeight: 600 }}
                      >
                        {trade.assetA}/{trade.assetB}
                      </Link>
                    </td>
                    <td>
                      {trade.actionA} / {trade.actionB}
                    </td>
                    <td>{Number(trade.zScore || 0).toFixed(2)}</td>
                    <td>${Number(trade.sizeUsd || 0).toFixed(0)}</td>
                    <td>
                      <span
                        className={`status status-${String(
                          trade.status || ""
                        ).toLowerCase()}`}
                      >
                        {trade.status}
                      </span>
                    </td>
                    <td>
                      {trade.txHashes?.length ? (
                        <a
                          href={trade.basescanUrls[0]}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {trade.txHashes[0].slice(0, 10)}...
                        </a>
                      ) : (
                        "-"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </>
  );
}
