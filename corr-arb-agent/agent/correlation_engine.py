from dataclasses import dataclass
from datetime import datetime, timezone
from itertools import combinations
import logging

import numpy as np
import pandas as pd
from scipy import stats

logger = logging.getLogger(__name__)


@dataclass
class CorrelationSignal:
    """Represents a detected correlation break signal."""

    asset_a: str
    asset_b: str
    current_correlation: float
    historical_mean: float
    historical_std: float
    z_score: float
    direction: str
    confidence: float
    timestamp: str
    lookback_days: int
    price_a: float
    price_b: float

    def to_dict(self) -> dict:
        return {
            "assetA": self.asset_a,
            "assetB": self.asset_b,
            "currentCorrelation": round(self.current_correlation, 4),
            "historicalMean": round(self.historical_mean, 4),
            "historicalStd": round(self.historical_std, 4),
            "zScore": round(self.z_score, 4),
            "direction": self.direction,
            "confidence": round(self.confidence, 4),
            "timestamp": self.timestamp,
            "lookbackDays": self.lookback_days,
            "priceA": self.price_a,
            "priceB": self.price_b,
        }


class CorrelationEngine:
    """Core correlation and z-score engine."""

    def __init__(self, lookback_days: int = 90, zscore_threshold: float = 2.0):
        self.lookback_days = lookback_days
        self.zscore_threshold = zscore_threshold
        self.price_history: dict[str, list[float]] = {}
        self.correlation_history: dict[str, list[float]] = {}

    def update_prices(self, current_prices: dict[str, float]):
        """Append fresh prices to rolling history."""
        for asset, price in current_prices.items():
            if asset not in self.price_history:
                self.price_history[asset] = []
            self.price_history[asset].append(price)

            max_points = self.lookback_days * 288
            if len(self.price_history[asset]) > max_points:
                self.price_history[asset] = self.price_history[asset][-max_points:]

    def load_history(self, asset: str, prices: list[float]):
        """Load historical price data at startup."""
        self.price_history[asset] = prices
        logger.info("Loaded %s historical prices for %s", len(prices), asset)

    def _get_daily_prices(self, asset: str) -> np.ndarray:
        """Downsample 5-minute data into daily samples."""
        if asset not in self.price_history:
            return np.array([])

        prices = self.price_history[asset]
        if len(prices) < 288:
            return np.array(prices)

        # Keep one value per day.
        daily = prices[::288]
        return np.array(daily[-self.lookback_days:])

    def compute_current_correlation(self, asset_a: str, asset_b: str) -> float | None:
        """Compute Pearson correlation over recent window."""
        prices_a = self._get_daily_prices(asset_a)
        prices_b = self._get_daily_prices(asset_b)

        if len(prices_a) < 10 or len(prices_b) < 10:
            logger.debug("Not enough data for %s/%s", asset_a, asset_b)
            return None

        min_len = min(len(prices_a), len(prices_b))
        prices_a = prices_a[-min_len:]
        prices_b = prices_b[-min_len:]

        window = min(30, min_len)
        recent_a = prices_a[-window:]
        recent_b = prices_b[-window:]

        corr, p_value = stats.pearsonr(recent_a, recent_b)
        if p_value > 0.05:
            logger.debug("%s/%s correlation p-value %.3f is weak", asset_a, asset_b, p_value)

        return float(corr)

    def compute_rolling_correlation_history(
        self, asset_a: str, asset_b: str, window: int = 30
    ) -> list[float]:
        """Compute rolling correlation distribution over lookback period."""
        prices_a = self._get_daily_prices(asset_a)
        prices_b = self._get_daily_prices(asset_b)

        if len(prices_a) < window + 5 or len(prices_b) < window + 5:
            return []

        min_len = min(len(prices_a), len(prices_b))
        prices_a = prices_a[-min_len:]
        prices_b = prices_b[-min_len:]

        rolling_corrs = []
        for i in range(window, min_len):
            window_a = prices_a[i - window : i]
            window_b = prices_b[i - window : i]
            try:
                corr, _ = stats.pearsonr(window_a, window_b)
                rolling_corrs.append(float(corr))
            except Exception:
                continue

        return rolling_corrs

    def compute_zscore(self, asset_a: str, asset_b: str) -> dict | None:
        """Compute z-score for pairwise correlation deviation."""
        current_corr = self.compute_current_correlation(asset_a, asset_b)
        if current_corr is None:
            return None

        corr_history = self.compute_rolling_correlation_history(asset_a, asset_b)
        if len(corr_history) < 10:
            logger.debug("Not enough correlation history for %s/%s", asset_a, asset_b)
            return None

        hist_mean = float(np.mean(corr_history))
        hist_std = float(np.std(corr_history))

        if hist_std < 0.001:
            return None

        z_score = (current_corr - hist_mean) / hist_std
        return {
            "asset_a": asset_a,
            "asset_b": asset_b,
            "current_correlation": current_corr,
            "historical_mean": hist_mean,
            "historical_std": hist_std,
            "z_score": z_score,
            "history_length": len(corr_history),
        }

    def scan_all_pairs(
        self, assets: list[str], current_prices: dict[str, float]
    ) -> list[CorrelationSignal]:
        """Scan all pair combinations and emit correlation signals."""
        signals: list[CorrelationSignal] = []
        pairs = list(combinations(assets, 2))

        logger.info("Scanning %s pairs for correlation breaks", len(pairs))

        for asset_a, asset_b in pairs:
            if asset_a not in current_prices or asset_b not in current_prices:
                continue

            result = self.compute_zscore(asset_a, asset_b)
            if result is None:
                continue

            z = result["z_score"]
            if abs(z) < self.zscore_threshold:
                continue

            direction = "CORR_BREAKDOWN" if z < 0 else "CORR_SPIKE"
            confidence = min(1.0, (abs(z) - self.zscore_threshold) / 2.0)

            signal = CorrelationSignal(
                asset_a=asset_a,
                asset_b=asset_b,
                current_correlation=result["current_correlation"],
                historical_mean=result["historical_mean"],
                historical_std=result["historical_std"],
                z_score=z,
                direction=direction,
                confidence=confidence,
                timestamp=datetime.now(timezone.utc).isoformat(),
                lookback_days=self.lookback_days,
                price_a=current_prices[asset_a],
                price_b=current_prices[asset_b],
            )
            signals.append(signal)

            logger.info(
                "SIGNAL %s/%s z=%.2f corr=%.3f hist=%.3f conf=%.2f",
                asset_a,
                asset_b,
                z,
                result["current_correlation"],
                result["historical_mean"],
                confidence,
            )

        return signals

    def get_correlation_matrix(self, assets: list[str]) -> pd.DataFrame:
        """Return full pairwise correlation matrix."""
        corr_dict: dict[str, dict[str, float]] = {}

        for a in assets:
            corr_dict[a] = {}
            for b in assets:
                if a == b:
                    corr_dict[a][b] = 1.0
                else:
                    corr = self.compute_current_correlation(a, b)
                    corr_dict[a][b] = corr if corr is not None else 0.0

        return pd.DataFrame(corr_dict)

    def get_strongest_signal(
        self, signals: list[CorrelationSignal]
    ) -> CorrelationSignal | None:
        """Return strongest signal to avoid over-trading in one cycle."""
        if not signals:
            return None
        return max(signals, key=lambda s: abs(s.z_score) * s.confidence)
