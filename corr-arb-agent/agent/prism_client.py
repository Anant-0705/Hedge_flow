import json
import logging
import os
import time
from datetime import datetime
from pathlib import Path

import requests

from config.settings import PRISM_API_KEY, PRISM_BASE_URL

logger = logging.getLogger(__name__)
PROJECT_ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = PROJECT_ROOT / "data"


class PrismClient:
    """
    Wrapper around PRISM API.
    Handles retries, rate limiting, and local history storage.
    """

    def __init__(self):
        self.session = requests.Session()
        self.session.headers.update(
            {
                "X-API-Key": PRISM_API_KEY or "",
                "Content-Type": "application/json",
            }
        )
        self.cache: dict[str, dict] = {}
        self.cache_ttl = 60
        self.request_count = 0

        # Pragmatic cross-asset aliases verified against current PRISM endpoints.
        self.symbol_aliases = {
            "MATIC": "POL",
            "GOLD": "GLD",
            "EUR": "FXE",
        }
        self.stock_symbols = {"GLD", "FXE"}

    def _api_symbol(self, symbol: str) -> str:
        """Map user symbol to a currently supported PRISM symbol when needed."""
        return self.symbol_aliases.get(symbol, symbol)

    def _get(self, endpoint: str, retries: int = 3) -> dict:
        """Core GET request with retry logic."""
        url = f"{PRISM_BASE_URL}{endpoint}"

        for attempt in range(retries):
            try:
                response = self.session.get(url, timeout=10)
                self.request_count += 1

                if response.status_code == 200:
                    return response.json()

                if response.status_code == 429:
                    wait_time = 2**attempt
                    logger.warning("Rate limited for %s. Retrying in %ss.", endpoint, wait_time)
                    time.sleep(wait_time)
                    continue

                if response.status_code == 404:
                    logger.error("Endpoint not found: %s", endpoint)
                    return {}

                logger.error("PRISM API error %s: %s", response.status_code, response.text)
                return {}

            except requests.exceptions.Timeout:
                logger.warning("Request timeout for %s (attempt %s)", endpoint, attempt + 1)
                time.sleep(1)
            except requests.exceptions.ConnectionError:
                logger.warning("Connection error for %s (attempt %s)", endpoint, attempt + 1)
                time.sleep(2)
            except Exception as exc:
                logger.error("Unexpected PRISM error for %s: %s", endpoint, exc)
                return {}

        logger.error("All retries failed for %s", endpoint)
        return {}

    def resolve_asset(self, symbol: str) -> dict:
        """Resolve a ticker to PRISM unified metadata."""
        cache_key = f"resolve_{symbol}"

        if cache_key in self.cache:
            cached = self.cache[cache_key]
            if time.time() - cached["timestamp"] < 3600:
                return cached["data"]

        data = self._get(f"/resolve/{symbol}")
        if data:
            self.cache[cache_key] = {"timestamp": time.time(), "data": data}
        return data

    def get_current_price(self, symbol: str) -> float | None:
        """Get current price for a symbol."""
        cache_key = f"price_{symbol}"
        api_symbol = self._api_symbol(symbol)

        if cache_key in self.cache:
            cached = self.cache[cache_key]
            if time.time() - cached["timestamp"] < self.cache_ttl:
                return cached["data"]

        if api_symbol in self.stock_symbols:
            data = self._get(f"/stocks/{api_symbol}/quote")
            if not data or data.get("object") == "error":
                data = self._get(f"/crypto/price/{api_symbol}")
        else:
            data = self._get(f"/crypto/price/{api_symbol}")
            if not data or data.get("object") == "error":
                # Fallback for non-crypto assets and unresolved symbols.
                data = self._get(f"/stocks/{api_symbol}/quote")

        if not data or data.get("object") == "error":
            # Last attempt: resolve with live_price for compatible assets.
            data = self._get(f"/resolve/{api_symbol}?live_price=true")

        if not data:
            return None

        price = (
            data.get("price_usd")
            or data.get("price")
            or data.get("last")
            or data.get("close")
        )
        if price is None:
            return None

        price_float = float(price)
        self.cache[cache_key] = {"timestamp": time.time(), "data": price_float}
        return price_float

    def get_risk_metrics(self, symbol: str) -> dict:
        """Get volatility and risk metrics for a symbol."""
        data = self._get(f"/risk/{symbol}")
        return data if data else {}

    def get_price_history(self, symbol: str, days: int = 90) -> list[float]:
        """
        Get daily close history from PRISM.
        Falls back to local history if API history is unavailable.
        """
        api_symbol = self._api_symbol(symbol)
        data = self._get(f"/historical/{api_symbol}/prices?days={days}&interval=daily")

        if data and "prices" in data:
            prices = []
            for candle in data["prices"]:
                if isinstance(candle, dict):
                    close = candle.get("close")
                    if close is not None:
                        prices.append(float(close))
                elif candle is not None:
                    prices.append(float(candle))
            if prices:
                return prices

        if data and "candles" in data:
            return [
                float(candle["close"])
                for candle in data["candles"]
                if isinstance(candle, dict) and candle.get("close") is not None
            ]

        # Secondary endpoint for registry chart candles.
        alt_data = self._get(f"/assets/{api_symbol}/prices?interval=1d&limit={days}&asset_type=crypto")
        if alt_data and "candles" in alt_data:
            return [
                float(candle["close"])
                for candle in alt_data["candles"]
                if isinstance(candle, dict) and candle.get("close") is not None
            ]

        logger.warning("History endpoint unavailable for %s. Using local cache.", symbol)
        return self._load_local_history(symbol, days)

    def _load_local_history(self, symbol: str, days: int) -> list[float]:
        """Load price history from local JSON cache."""
        cache_file = DATA_DIR / f"price_history_{symbol}.json"
        if not cache_file.exists():
            return []

        try:
            with cache_file.open("r", encoding="utf-8") as f:
                history = json.load(f)
        except Exception as exc:
            logger.error("Failed reading local history for %s: %s", symbol, exc)
            return []

        prices = [entry.get("price") for entry in history[-days:] if entry.get("price") is not None]
        return [float(price) for price in prices]

    def save_price_to_history(self, symbol: str, price: float):
        """Append current price to local history file."""
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        cache_file = DATA_DIR / f"price_history_{symbol}.json"

        history = []
        if cache_file.exists():
            try:
                with cache_file.open("r", encoding="utf-8") as f:
                    history = json.load(f)
            except Exception:
                history = []

        history.append({"timestamp": datetime.utcnow().isoformat(), "price": float(price)})

        # Keep a max of 180 days sampled every 5 minutes.
        history = history[-180 * 288 :]

        with cache_file.open("w", encoding="utf-8") as f:
            json.dump(history, f)

    def get_all_prices(self, symbols: list[str]) -> dict[str, float]:
        """Fetch current prices for all symbols."""
        prices: dict[str, float] = {}

        for symbol in symbols:
            price = self.get_current_price(symbol)
            if price is not None:
                prices[symbol] = price
                self.save_price_to_history(symbol, price)
            else:
                logger.warning("Could not fetch price for %s", symbol)

            time.sleep(0.2)

        return prices

    def print_api_usage(self):
        """Print API usage for free-tier tracking."""
        print(f"\n[PRISM] Total API calls this session: {self.request_count}")
        print(f"[PRISM] Estimated credits used: ${self.request_count * 0.00067:.4f}")
