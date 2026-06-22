import { useState, useEffect, useRef } from "react";
import { Link } from "react-router-dom";

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:8000";
const ETHERSCAN_BASE = "https://sepolia.etherscan.io/tx/";

function Icon({ name, style, className }) {
  return (
    <span className={`material-icons-outlined ${className || ""}`} style={style}>
      {name}
    </span>
  );
}

const STEP_ICONS = [
  "show_chart",
  "timeline",
  "speed",
  "science",
  "psychology",
  "receipt_long",
  "link",
  "account_balance",
  "stars"
];

const STEP_LABELS = [
  "Fetching live prices",
  "Computing 30-day Pearson correlation",
  "Measuring correlation deviation",
  "Engle-Granger ADF test",
  "Local LLM reasoning through signal",
  "Building signed TradeIntent",
  "Submitting to RiskRouter on Sepolia",
  "Mark-to-market settlement",
  "Updating on-chain reputation"
];

export default function DemoFlow() {
  const [running, setRunning] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [activeStepIndex, setActiveStepIndex] = useState(-1);
  const [stepsData, setStepsData] = useState([]);
  const [logs, setLogs] = useState([]);
  const [pollData, setPollData] = useState(null);

  const pollIntervalRef = useRef(null);

  useEffect(() => {
    return () => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    };
  }, []);

  const addLog = (msg) => {
    const time = new Date().toLocaleTimeString("en-US", { hour12: false });
    setLogs((prev) => [...prev, `[${time}] ${msg}`]);
  };

  const handleRunDemo = async () => {
    if (running || completed) return;
    
    setRunning(true);
    setActiveStepIndex(0);
    setStepsData([]);
    setLogs([]);
    setPollData(null);
    if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);

    try {
      addLog("Started Live Trade Demo...");
      const res = await fetch(`${API_BASE}/api/demo/start`, { method: "POST" });
      const data = await res.json();
      
      // Animate steps revealing one by one
      for (let i = 0; i < data.length; i++) {
        await new Promise((resolve) => setTimeout(resolve, 600));
        
        setActiveStepIndex(i);
        setStepsData((prev) => {
          const next = [...prev];
          next[i] = data[i];
          return next;
        });
        
        // Add specific log messages based on step data
        const sData = data[i].data;
        if (i === 0) {
          const prices = sData.prices || {};
          const pStr = Object.entries(prices).map(([k,v]) => `${k}: $${v.toFixed(2)}`).join(" ");
          addLog(`✓ Price Feed — ${pStr}`);
        } else if (i === 1) {
          addLog(`✓ Correlation: ${sData.current_correlation?.toFixed(4)} (μ=${sData.historical_mean?.toFixed(4)})`);
        } else if (i === 2) {
          addLog(`✓ Z-Score: ${sData.z_score?.toFixed(2)}`);
        } else if (i === 3) {
          addLog(`✓ Cointegration: β=${sData.hedge_ratio?.toFixed(2)}, p=${sData.p_value?.toFixed(4)}`);
        } else if (i === 4) {
          addLog(`✓ LLM Decision: ${sData.execute ? "EXECUTE" : "SKIP"} (conf: ${sData.confidence?.toFixed(2)})`);
        } else if (i === 5) {
          addLog(`✓ Built TradeIntent nonce: ${sData.nonce?.slice(0, 8)}...`);
        } else if (i === 6) {
          addLog(`✓ Trade PENDING for RiskRouter submission`);
        } else if (i === 7) {
          addLog(`✓ Waiting for settlement...`);
        } else if (i === 8) {
          addLog(`✓ Awaiting reputation sync...`);
        }
      }
      
      // Step 9 complete
      await new Promise((resolve) => setTimeout(resolve, 600));
      setActiveStepIndex(9); // All done
      setRunning(false);
      setCompleted(true);
      
      // Start polling status
      pollIntervalRef.current = setInterval(pollStatus, 3000);
      pollStatus(); // initial poll
      
    } catch (e) {
      addLog(`❌ Error running demo: ${e.message}`);
      setRunning(false);
    }
  };

  const pollStatus = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/demo/status`);
      const data = await res.json();
      if (data && data.status !== "no_demo") {
        setPollData(data);
      }
    } catch (e) {
      // Ignore poll errors
    }
  };

  const handleReset = async () => {
    await fetch(`${API_BASE}/api/demo/reset`, { method: "DELETE" });
    setRunning(false);
    setCompleted(false);
    setActiveStepIndex(-1);
    setStepsData([]);
    setLogs([]);
    setPollData(null);
    if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
  };

  const renderStepData = (stepIndex, data) => {
    if (!data) return null;
    
    switch (stepIndex) {
      case 0:
        return (
          <div style={{ marginTop: 8, fontSize: "0.9rem", color: "var(--text-secondary)" }}>
            {Object.entries(data.prices || {}).map(([asset, price]) => (
              <span key={asset} style={{ marginRight: 16 }}>
                <strong>{asset}</strong>: ${price.toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </span>
            ))}
          </div>
        );
      case 1:
        return (
          <div style={{ marginTop: 8, fontSize: "0.9rem", color: "var(--text-secondary)" }}>
            Current ρ: <strong>{data.current_correlation?.toFixed(4)}</strong> <br/>
            Historical μ: {data.historical_mean?.toFixed(4)}
            {data.demo_forced && <span style={{ marginLeft: 8, color: "var(--accent)" }}>(Demo forced)</span>}
          </div>
        );
      case 2:
        return (
          <div style={{ marginTop: 8, fontSize: "0.9rem", color: "var(--text-secondary)" }}>
            Z-Score: <strong>{data.z_score?.toFixed(2)}</strong>
            {data.demo_forced && <span style={{ marginLeft: 8, color: "var(--accent)" }}>(Demo forced)</span>}
          </div>
        );
      case 3:
        return (
          <div style={{ marginTop: 8, fontSize: "0.9rem", color: "var(--text-secondary)" }}>
            Hedge Ratio β: <strong>{data.hedge_ratio?.toFixed(4)}</strong> <br/>
            ADF p-value: {data.p_value?.toFixed(4)} <br/>
            Spread z-score: {data.spread_zscore?.toFixed(2)}
            {data.demo_forced && <span style={{ marginLeft: 8, color: "var(--accent)" }}>(Demo forced)</span>}
          </div>
        );
      case 4:
        return (
          <div style={{ marginTop: 8, fontSize: "0.9rem", color: "var(--text-secondary)" }}>
            <div style={{ fontStyle: "italic", marginBottom: 4 }}>"{data.reasoning_text}"</div>
            Decision: <strong>{data.execute ? "EXECUTE" : "SKIP"}</strong> (Confidence: {data.confidence?.toFixed(2)})
          </div>
        );
      case 5:
        return (
          <div style={{ marginTop: 8, fontSize: "0.9rem", color: "var(--text-secondary)" }}>
            Pair: {data.pair} | Action: {data.action_a} / {data.action_b} | Size: ${data.size_usd?.toFixed(2)}<br/>
            Hash: {data.reasoning_hash}
          </div>
        );
      case 6:
        return (
          <div style={{ marginTop: 8, fontSize: "0.9rem", color: "var(--text-secondary)" }}>
            Status: PENDING
          </div>
        );
      case 7:
      case 8:
        return (
          <div style={{ marginTop: 8, fontSize: "0.9rem", color: "var(--text-secondary)" }}>
            Awaiting watcher/settler processes...
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: "100vh" }}>
      {/* ── NAV ──────────────────────────────────── */}
      <nav className="nav">
        <div className="nav-inner">
          <Link to="/" className="nav-logo">
            HedgeFlow
          </Link>
          <div className="nav-links">
            <Link to="/dashboard">Dashboard</Link>
            <Link to="/trade/latest">Trades</Link>
            <Link to="/demo" className="active">Demo</Link>
          </div>
        </div>
      </nav>

      {/* ── HEADER ───────────────────────────────── */}
      <section style={{ padding: "4rem 2rem 2rem", textAlign: "center" }}>
        <h1 className="hero-headline" style={{ fontSize: "2.5rem", marginBottom: "1rem" }}>Live Trade Demo</h1>
        <p className="hero-sub" style={{ maxWidth: 600, margin: "0 auto", marginBottom: "2rem" }}>
          Watch a complete correlation arbitrage trade execute end-to-end in real time.
        </p>
        
        {!completed ? (
          <button 
            className="btn btn-primary" 
            style={{ padding: "12px 32px", fontSize: "1.1rem", border: "none" }}
            onClick={handleRunDemo}
            disabled={running}
          >
            {running ? "Running..." : "▶ Run Demo Trade"}
          </button>
        ) : (
          <button 
            className="btn btn-secondary" 
            style={{ padding: "12px 32px", fontSize: "1.1rem" }}
            onClick={handleReset}
          >
            ↺ Reset & Run Again
          </button>
        )}
      </section>

      {/* ── PIPELINE & LOGS ──────────────────────── */}
      <section style={{ padding: "2rem", display: "flex", gap: "3rem", justifyContent: "center", maxWidth: 1200, margin: "0 auto", width: "100%" }}>
        
        {/* Pipeline Column */}
        <div style={{ flex: 1, maxWidth: 600 }}>
          {STEP_LABELS.map((label, i) => {
            const state = activeStepIndex > i ? "DONE" : activeStepIndex === i ? "ACTIVE" : "WAITING";
            const sData = stepsData[i]?.data;
            
            return (
              <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: "flex-start" }}>
                
                {/* Card */}
                <div 
                  className={`card ${state === "ACTIVE" ? "pulse-border" : ""}`} 
                  style={{ 
                    width: "100%", 
                    display: "flex", 
                    alignItems: "flex-start", 
                    gap: "1rem",
                    opacity: state === "WAITING" ? 0.4 : 1,
                    transition: "all 0.3s ease",
                    position: "relative",
                    overflow: "hidden"
                  }}
                >
                  <div style={{ 
                    width: 40, 
                    height: 40, 
                    borderRadius: 20, 
                    background: state === "DONE" ? "var(--status-green)" : "var(--bg-tertiary)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                    color: state === "DONE" ? "#fff" : "inherit"
                  }}>
                    <Icon name={STEP_ICONS[i]} />
                  </div>
                  
                  <div style={{ flex: 1 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <h3 style={{ margin: 0, fontSize: "1.1rem" }}>{label}</h3>
                      <span style={{ 
                        fontSize: "0.75rem", 
                        padding: "2px 8px", 
                        borderRadius: 12,
                        background: state === "DONE" ? "rgba(76, 175, 80, 0.1)" : state === "ACTIVE" ? "rgba(33, 150, 243, 0.1)" : "var(--bg-tertiary)",
                        color: state === "DONE" ? "#4caf50" : state === "ACTIVE" ? "#2196f3" : "inherit"
                      }}>
                        {state === "DONE" ? "Complete" : state === "ACTIVE" ? "Processing..." : "Waiting"}
                      </span>
                    </div>
                    {state === "DONE" && renderStepData(i, sData)}
                  </div>
                </div>

                {i < STEP_LABELS.length - 1 && (
                  <div style={{ height: 32, width: 2, background: activeStepIndex > i ? "var(--status-green)" : "var(--border-medium)", marginLeft: 40, transition: "background 0.3s ease 0.15s" }} />
                )}
              </div>
            );
          })}
        </div>

        {/* Side Panel (Logs & Result) */}
        <div style={{ width: 400, display: "flex", flexDirection: "column", gap: "2rem" }} className="desktop-only">
          
          {/* Logs */}
          <div className="card" style={{ flex: 1, maxHeight: 400, overflowY: "auto", background: "#0d1117", border: "1px solid var(--border-medium)", fontFamily: "monospace", fontSize: "0.85rem" }}>
            <h3 style={{ margin: "0 0 1rem 0", color: "var(--text-faint)" }}>Live Execution Log</h3>
            {logs.length === 0 ? (
              <div style={{ color: "var(--text-muted)" }}>Waiting for execution to start...</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {logs.map((l, idx) => (
                  <div key={idx} style={{ color: "var(--text-primary)" }}>{l}</div>
                ))}
              </div>
            )}
          </div>

          {/* Result Card */}
          {(completed || (stepsData[5] && stepsData[5].data)) && (
            <div className="card" style={{ background: "var(--bg-tertiary)" }}>
              <h3 style={{ margin: "0 0 1rem 0", display: "flex", alignItems: "center", gap: 8 }}>
                <Icon name="receipt_long" /> Trade Result
              </h3>
              
              {(() => {
                const intentData = stepsData[5]?.data || {};
                const status = pollData?.status || "PENDING";
                
                return (
                  <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span style={{ color: "var(--text-secondary)" }}>Status</span>
                      <span style={{ 
                        fontWeight: "bold",
                        color: status === "SETTLED" ? "#4caf50" : status === "SUBMITTED" ? "#2196f3" : "inherit"
                      }}>{status}</span>
                    </div>
                    
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span style={{ color: "var(--text-secondary)" }}>Pair</span>
                      <span>{intentData.pair}</span>
                    </div>
                    
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span style={{ color: "var(--text-secondary)" }}>Direction</span>
                      <span>{intentData.action_a} / {intentData.action_b}</span>
                    </div>
                    
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span style={{ color: "var(--text-secondary)" }}>Size</span>
                      <span>${intentData.size_usd?.toFixed(2)}</span>
                    </div>

                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span style={{ color: "var(--text-secondary)" }}>Reasoning</span>
                      <span style={{ fontFamily: "monospace", fontSize: "0.85rem" }}>{intentData.reasoning_hash}</span>
                    </div>

                    {pollData?.txHashes && pollData.txHashes.length > 0 && (
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8, paddingTop: 8, borderTop: "1px solid var(--border-medium)" }}>
                        <span style={{ color: "var(--text-secondary)" }}>Tx Hash</span>
                        <a href={`${ETHERSCAN_BASE}${pollData.txHashes[0]}`} target="_blank" rel="noreferrer" style={{ display: "flex", alignItems: "center", gap: 4 }}>
                          {pollData.txHashes[0].slice(0, 10)}... <Icon name="open_in_new" style={{ fontSize: 14 }} />
                        </a>
                      </div>
                    )}

                    {status === "SETTLED" && pollData?.settlement && (
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8, paddingTop: 8, borderTop: "1px solid var(--border-medium)" }}>
                        <span style={{ color: "var(--text-secondary)" }}>PnL</span>
                        <strong style={{ color: pollData.settlement.pnlUsd >= 0 ? "#4caf50" : "#f44336" }}>
                          {pollData.settlement.pnlUsd >= 0 ? "+" : ""}${pollData.settlement.pnlUsd.toFixed(2)}
                        </strong>
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
          )}

        </div>
      </section>

      {/* Pulse animation for active card */}
      <style>{`
        .pulse-border {
          box-shadow: 0 0 0 0 rgba(33, 150, 243, 0.4);
          animation: pulse-blue 1.5s infinite;
          border-color: #2196f3;
        }
        @keyframes pulse-blue {
          0% { box-shadow: 0 0 0 0 rgba(33, 150, 243, 0.4); }
          70% { box-shadow: 0 0 0 10px rgba(33, 150, 243, 0); }
          100% { box-shadow: 0 0 0 0 rgba(33, 150, 243, 0); }
        }
        @media (max-width: 900px) {
          .desktop-only { display: none !important; }
        }
      `}</style>
    </div>
  );
}
