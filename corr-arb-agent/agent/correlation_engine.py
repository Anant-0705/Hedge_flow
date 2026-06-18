from dataclasses import dataclass, field
from datetime import datetime, timezone
from itertools import combinations
import logging
import time

import numpy as np
import pandas as pd
from scipy import stats
# pyrefly: ignore [missing-import]
from statsmodels.tsa.stattools import adfuller

from config.settings import COINTEGRATION_PVALUE_THRESHOLD

logger = logging.getLogger(__name__)

# How long to cache a cointegration result before recomputing (seconds).
# Cointegration is expensive (OLS + ADF) and slow-changing — 1 hour is fine.
_COINT_CACHE_TTL = 3600


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

    # Cointegration fields (added by the Engle-Granger gate)
    hedge_ratio: float = 0.0          # β: units of B to hold per unit of A
    cointegration_pvalue: float = 1.0 # ADF p-value on the spread; <0.05 = cointegrated
    spread_zscore: float = 0.0        # z-score of the actual price spread (more actionable than corr z-score)
    is_cointegrated: bool = False

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
            # Cointegration
            "hedgeRatio": round(self.hedge_ratio, 6),
            "cointegrationPvalue": round(self.cointegration_pvalue, 6),
            "spreadZscore": round(self.spread_zscore, 4),
            "isCointegrated": self.is_cointegrated,
        }


class CorrelationEngine:
    """
    Core correlation and z-score engine with Engle-Granger cointegration gate.

    Signal flow:
      1. Pearson correlation z-score flags candidate pairs (existing logic).
      2. Engle-Granger two-step test gates each candidate:
           a. OLS regression  →  hedge ratio β
           b. ADF test on spread  →  p-value
         Pairs that fail (p >= COINTEGRATION_PVALUE_THRESHOLD) are dropped.
         Pairs that pass get hedge_ratio and spread_zscore added to their signal.
      3. Only cointegrated pairs reach the LLM.
    """

    def __init__(self, lookback_days: int = 90, zscore_threshold: float = 2.0):
        self.lookback_days = lookback_days
        self.zscore_threshold = zscore_threshold
        self.price_history: dict[str, list[float]] = {}
        self.correlation_history: dict[str, list[float]] = {}

        # Cache: pair_key -> (computed_at_timestamp, result_dict | None)
        self._coint_cache: dict[str, tuple[float, dict | None]] = {}

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

        daily = prices[::288]
        return np.array(daily[-self.lookback_days:])

    def compute_current_correlation(self, asset_a: str, asset_b: str) -> float | None:
        """Compute Pearson correlation over recent 30-day window."""
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

    def _coint_cache_key(self, asset_a: str, asset_b: str) -> str:
        return "/".join(sorted([asset_a, asset_b]))

    def compute_cointegration(self, asset_a: str, asset_b: str) -> dict | None:
        """
        Engle-Granger two-step cointegration test.
        Step 1: OLS regression log(A) = α + β·log(B) → hedge ratio β
        Step 2: ADF test on spread = log(A) - α - β·log(B)
        If ADF p-value < COINTEGRATION_PVALUE_THRESHOLD the pair is
        genuinely cointegrated (spread is stationary, mean reversion guaranteed).
        Results are cached for _COINT_CACHE_TTL seconds.
        """
        cache_key = self._coint_cache_key(asset_a, asset_b)
        cached_at, cached_result = self._coint_cache.get(cache_key, (0.0, None))

        if time.time() - cached_at < _COINT_CACHE_TTL:
            logger.debug("Cointegration cache hit for %s", cache_key)
            return cached_result

        prices_a = self._get_daily_prices(asset_a)
        prices_b = self._get_daily_prices(asset_b)
        min_len = min(len(prices_a), len(prices_b))

        if min_len < 30:
            self._coint_cache[cache_key] = (time.time(), None)
            return None

        prices_a = prices_a[-min_len:]
        prices_b = prices_b[-min_len:]

        if np.any(prices_a <= 0) or np.any(prices_b <= 0):
            self._coint_cache[cache_key] = (time.time(), None)
            return None

        try:
            log_a = np.log(prices_a)
            log_b = np.log(prices_b)

            X = np.column_stack([np.ones(min_len), log_b])
            coeffs, _, _, _ = np.linalg.lstsq(X, log_a, rcond=None)
            alpha, beta = float(coeffs[0]), float(coeffs[1])

            spread = log_a - alpha - beta * log_b
            spread_mean = float(np.mean(spread))
            spread_std = float(np.std(spread))

            if spread_std < 1e-8:
                self._coint_cache[cache_key] = (time.time(), None)
                return None

            spread_zscore = float((spread[-1] - spread_mean) / spread_std)
            adf_stat, p_value, _, _, _, _ = adfuller(spread, autolag="AIC")
            is_cointegrated = p_value < COINTEGRATION_PVALUE_THRESHOLD

            result = {
                "is_cointegrated": is_cointegrated,
                "p_value": float(p_value),
                "adf_stat": float(adf_stat),
                "hedge_ratio": beta,
                "alpha": alpha,
                "spread_mean": spread_mean,
                "spread_std": spread_std,
                "spread_zscore": spread_zscore,
                "n_obs": min_len,
            }
            self._coint_cache[cache_key] = (time.time(), result)

            logger.info(
                "Cointegration %s/%s: p=%.4f (%s) β=%.4f spread_z=%.2f",
                asset_a, asset_b, p_value,
                "PASS" if is_cointegrated else "FAIL",
                beta, spread_zscore,
            )
            return result

        except Exception as exc:
            logger.error("Cointegration error for %s/%s: %s", asset_a, asset_b, exc)
            self._coint_cache[cache_key] = (time.time(), None)
            return None

    def invalidate_coint_cache(self, asset_a: str | None = None, asset_b: str | None = None):
        if asset_a is None:
            self._coint_cache.clear()
        else:
            key = self._coint_cache_key(asset_a, asset_b)
            self._coint_cache.pop(key, None)

    def scan_all_pairs(
        self, assets: list[str], current_prices: dict[str, float]
    ) -> list[CorrelationSignal]:
        signals: list[CorrelationSignal] = []
        pairs = list(combinations(assets, 2))
        logger.info("Scanning %s pairs (correlation + cointegration gate)", len(pairs))
        cointegration_failures = 0

        for asset_a, asset_b in pairs:
            if asset_a not in current_prices or asset_b not in current_prices:
                continue

            result = self.compute_zscore(asset_a, asset_b)
            if result is None:
                continue

            z = result["z_score"]
            if abs(z) < self.zscore_threshold:
                continue

            coint = self.compute_cointegration(asset_a, asset_b)
            if coint is None:
                logger.debug("Skipping %s/%s — cointegration inconclusive", asset_a, asset_b)
                continue
            if not coint["is_cointegrated"]:
                logger.info(
                    "REJECTED %s/%s z=%.2f p=%.4f — not cointegrated, no mean reversion guarantee",
                    asset_a, asset_b, z, coint["p_value"],
                )
                cointegration_failures += 1
                continue

            direction = "CORR_BREAKDOWN" if z < 0 else "CORR_SPIKE"
            
            corr_conf = min(1.0, (abs(z) - self.zscore_threshold) / 2.0)
            coint_conf = max(0.0, 1.0 - (coint["p_value"] / COINTEGRATION_PVALUE_THRESHOLD))
            confidence = round((corr_conf * 0.6 + coint_conf * 0.4), 4)

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
                hedge_ratio=coint["hedge_ratio"],
                cointegration_pvalue=coint["p_value"],
                spread_zscore=coint["spread_zscore"],
                is_cointegrated=True,
            )
            signals.append(signal)

            logger.info(
                "SIGNAL %s/%s z=%.2f corr=%.3f spread_z=%.2f β=%.4f p=%.4f conf=%.2f",
                asset_a, asset_b, z, result["current_correlation"],
                coint["spread_zscore"], coint["hedge_ratio"],
                coint["p_value"], confidence,
            )

        if cointegration_failures:
            logger.info(
                "%d pair(s) had z-score signals but failed cointegration gate.",
                cointegration_failures,
            )

        return signals

    def get_correlation_matrix(self, assets: list[str]) -> pd.DataFrame:
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
        if not signals:
            return None
        return max(signals, key=lambda s: abs(s.z_score) * s.confidence)
