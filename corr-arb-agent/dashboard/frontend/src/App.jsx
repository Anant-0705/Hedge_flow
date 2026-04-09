import { useEffect, useMemo, useState } from "react";
import PropTypes from "prop-types";

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:8000";
const REFRESH_MS = 30000;

function scoreClass(score) {
  if (score >= 80) return "score-good";
  if (score >= 50) return "score-mid";
  return "score-low";
}

function PairGrid({ rows }) {
  if (!rows?.length) {
    return <div className="empty">No correlation rows yet.</div>;
  }

  return (
    <div className="pair-grid">
      {rows.map((row) => {
        const cls = row.isSignal ? "pair-cell signal" : "pair-cell";
        return (
          <article className={cls} key={row.pair}>
            <p className="pair-name">{row.pair}</p>
            <p className="pair-corr">{row.currentCorrelation.toFixed(3)}</p>
            <p className="pair-z">z {row.zScore.toFixed(2)}</p>
          </article>
        );
      })}
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

function App() {
  const [agent, setAgent] = useState(null);
  const [correlations, setCorrelations] = useState(null);
  const [trades, setTrades] = useState([]);
  const [tradeTotal, setTradeTotal] = useState(0);
  const [performance, setPerformance] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [error, setError] = useState("");

  async function loadAll() {
    try {
      const [agentRes, corrRes, tradesRes, perfRes] = await Promise.all([
        fetch(`${API_BASE}/api/agent`).then((res) => res.json()),
        fetch(`${API_BASE}/api/correlations`).then((res) => res.json()),
        fetch(`${API_BASE}/api/trades`).then((res) => res.json()),
        fetch(`${API_BASE}/api/performance`).then((res) => res.json()),
      ]);

      if (corrRes?.error) {
        throw new Error(corrRes.error);
      }

      setAgent(agentRes);
      setCorrelations(corrRes);
      setTrades(tradesRes.items || []);
      setTradeTotal(tradesRes.total || 0);
      setPerformance(perfRes);
      setLastUpdated(new Date());
      setError("");
    } catch (err) {
      setError(err.message || "Failed to refresh dashboard data");
    }
  }

  useEffect(() => {
    loadAll();
    const timer = setInterval(loadAll, REFRESH_MS);
    return () => clearInterval(timer);
  }, []);

  const topSignal = useMemo(() => {
    const signals = correlations?.activeSignals || [];
    return signals[0] || null;
  }, [correlations]);

  return (
    <main className="page">
      <header className="hero">
        <div>
          <p className="eyebrow">HedgeFlow</p>
          <h1>Correlation Agent Control Room</h1>
          <p className="subtitle">
            Live strategy telemetry with pair divergence, runtime health, and execution snapshots.
          </p>
        </div>
        <aside className="refresh-card">
          <p>Auto refresh</p>
          <strong>{REFRESH_MS / 1000}s</strong>
          <p>{lastUpdated ? `Last update ${lastUpdated.toLocaleTimeString()}` : "Starting..."}</p>
        </aside>
      </header>

      {error && <section className="error-banner">{error}</section>}

      <section className="metrics">
        <article className="metric">
          <p>Reputation</p>
          <h2 className={scoreClass(agent?.repScore || 0)}>{agent?.repScore ?? "--"}</h2>
          <span>mult x{(agent?.positionMultiplier || 0).toFixed(2)}</span>
        </article>

        <article className="metric">
          <p>Total Trades</p>
          <h2>{agent?.totalTrades ?? 0}</h2>
          <span>wins {agent?.winningTrades ?? 0} / losses {agent?.losingTrades ?? 0}</span>
        </article>

        <article className="metric">
          <p>Local PnL</p>
          <h2>{agent ? `$${(agent.totalPnlUsd || 0).toFixed(2)}` : "--"}</h2>
          <span>{agent?.isPaused ? "circuit breaker active" : "runtime active"}</span>
        </article>

        <article className="metric">
          <p>Sharpe Proxy</p>
          <h2>{performance?.sharpe ?? 0}</h2>
          <span>{performance?.tradeCount ?? 0} settled trades</span>
        </article>
      </section>

      <section className="main-grid">
        <article className="panel">
          <div className="panel-head">
            <h3>Pair Matrix</h3>
            <span>{(correlations?.rows || []).length} rows</span>
          </div>
          {topSignal ? (
            <p className="top-signal">
              Top signal: <strong>{topSignal.pair}</strong> z={topSignal.zScore.toFixed(2)} corr=
              {topSignal.currentCorrelation.toFixed(3)}
            </p>
          ) : (
            <p className="top-signal">No active threshold break right now.</p>
          )}
          <PairGrid rows={correlations?.rows || []} />
        </article>

        <article className="panel">
          <div className="panel-head">
            <h3>Latest Prices</h3>
            <span>{(correlations?.assets || []).length} assets</span>
          </div>
          <ul className="price-list">
            {Object.entries(correlations?.prices || {}).map(([asset, price]) => (
              <li key={asset}>
                <span>{asset}</span>
                <strong>${Number(price).toFixed(4)}</strong>
              </li>
            ))}
          </ul>
        </article>
      </section>

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
                  <td>{trade.assetA}/{trade.assetB}</td>
                  <td>{trade.actionA} / {trade.actionB}</td>
                  <td>{Number(trade.zScore || 0).toFixed(2)}</td>
                  <td>${Number(trade.sizeUsd || 0).toFixed(0)}</td>
                  <td>
                    <span className={`status status-${String(trade.status || "").toLowerCase()}`}>
                      {trade.status}
                    </span>
                  </td>
                  <td>
                    {trade.txHashes?.length ? (
                      <a href={trade.basescanUrls[0]} target="_blank" rel="noreferrer">
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
  );
}

export default App;
