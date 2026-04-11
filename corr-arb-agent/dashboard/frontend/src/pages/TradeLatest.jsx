import { useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:8000";

export default function TradeLatest() {
  const navigate = useNavigate();

  useEffect(() => {
    async function redirect() {
      try {
        const res = await fetch(`${API_BASE}/api/trades`);
        const data = await res.json();
        const items = data.items || [];

        if (items.length > 0 && items[0].id) {
          navigate(`/trade/${items[0].id}`, { replace: true });
          return;
        }
      } catch {
        // Backend may be warming up
      }

      // If no trades found, redirect to dashboard after short delay
      setTimeout(() => navigate("/dashboard", { replace: true }), 2000);
    }

    redirect();
  }, [navigate]);

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
      <div
        style={{
          maxWidth: 400,
          margin: "80px auto",
          textAlign: "center",
          padding: 24,
        }}
      >
        <div className="spinner" style={{ margin: "0 auto 16px", borderColor: "var(--border-light)", borderTopColor: "var(--text-muted)" }} />
        <p style={{ color: "var(--text-muted)", fontSize: "0.9rem" }}>
          Loading latest trade...
        </p>
      </div>
    </>
  );
}
