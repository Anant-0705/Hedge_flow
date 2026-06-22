import { Routes, Route } from "react-router-dom";
import LandingPage from "./pages/LandingPage";
import Dashboard from "./pages/Dashboard";
import TradeDetail from "./pages/TradeDetail";
import TradeLatest from "./pages/TradeLatest";
import DemoFlow from "./pages/DemoFlow";
export default function App() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/dashboard" element={<Dashboard />} />
      <Route path="/trade/latest" element={<TradeLatest />} />
      <Route path="/trade/:id" element={<TradeDetail />} />
      <Route path="/demo" element={<DemoFlow />} />
    </Routes>
  );
}
