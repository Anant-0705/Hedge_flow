import json
import logging
import time
from datetime import datetime
from pathlib import Path

import requests

from config.settings import TWELVE_DATA_API_KEY, BINANCE_BASE_URL

logger = logging.getLogger(__name__)
PROJECT_ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = PROJECT_ROOT / "data"


class PriceClient:
    """
    Routed multi-source client replacing PRISM.
    Routes crypto to Binance, traditional assets to Twelve Data.
    """

    def __init__(self):
        self.session = requests.Session()
        self.session.headers.update({"User-Agent": "HedgeFlow-Agent/1.0"})
        self.cache: dict[str, dict] = {}
        self.cache_ttl = 60
        self.binance_calls = 0
        self.twelve_data_calls = 0

        self.crypto_symbols = {
            "BTC", "ETH", "SOL", "MATIC", "XRP", "ADA", "DOT",
            "LINK", "LTC", "BCH", "UNI", "AVAX", "DOGE", "ATOM",
        }

        # Binance delisted MATIC pairs on 2024-09-10 and replaced with POL.
        self.binance_symbol_aliases = {"MATIC": "POL"}

        self.symbol_aliases = {
            "GOLD": "XAU/USD",
            "EUR": "EUR/USD",
        }

        self.twelve_data_timestamps: list[float] = []

    def _binance_pair(self, symbol: str) -> str:
        base = self.binance_symbol_aliases.get(symbol, symbol)
        return f"{base}USDT"

    def _wait_twelve_data_rate_limit(self):
        now = time.time()
        self.twelve_data_timestamps = [ts for ts in self.twelve_data_timestamps if now - ts < 60]

        if len(self.twelve_data_timestamps) >= 8:
            oldest = self.twelve_data_timestamps[0]
            sleep_time = 60 - (now - oldest)
            if sleep_time > 0:
                logger.warning("Twelve Data rate limit approaching. Sleeping for %.2fs", sleep_time)
                time.sleep(sleep_time)
            now = time.time()
            self.twelve_data_timestamps = [ts for ts in self.twelve_data_timestamps if now - ts < 60]

        self.twelve_data_timestamps.append(now)

    def _get_binance(self, endpoint: str, params: dict, retries: int = 3) -> dict | list:
        url = f"{BINANCE_BASE_URL}{endpoint}"
        for attempt in range(retries):
            try:
                response = self.session.get(url, params=params, timeout=10)
                self.binance_calls += 1
                if response.status_code == 200:
                    return response.json()
                if response.status_code == 429:
                    wait_time = 2 ** attempt
                    logger.warning("Binance rate limited. Retrying in %ss.", wait_time)
                    time.sleep(wait_time)
                    continue
                logger.error("Binance API error %s: %s", response.status_code, response.text)
                return {}
            except requests.exceptions.Timeout:
                time.sleep(1)
            except requests.exceptions.ConnectionError:
                time.sleep(2)
            except Exception as exc:
                logger.error("Unexpected Binance error: %s", exc)
                return {}
        return {}

    def _get_twelve_data(self, endpoint: str, params: dict, retries: int = 3) -> dict:
        url = f"https://api.twelvedata.com{endpoint}"
        params["apikey"] = TWELVE_DATA_API_KEY

        for attempt in range(retries):
            self._wait_twelve_data_rate_limit()
            try:
                response = self.session.get(url, params=params, timeout=10)
                self.twelve_data_calls += 1
                if response.status_code == 200:
                    data = response.json()
                    if data.get("status") == "error":
                        if data.get("code") == 429:
                            wait_time = 2 ** attempt
                            logger.warning("Twelve Data limit. Retrying in %ss.", wait_time)
                            time.sleep(wait_time)
                            continue
                        logger.error("Twelve Data error: %s", data)
                        return {}
                    return data
                if response.status_code == 429:
                    time.sleep(2 ** attempt)
                    continue
                logger.error("Twelve Data HTTP error %s: %s", response.status_code, response.text)
                return {}
            except requests.exceptions.Timeout:
                time.sleep(1)
            except requests.exceptions.ConnectionError:
                time.sleep(2)
            except Exception as exc:
                logger.error("Unexpected Twelve Data error: %s", exc)
                return {}
        return {}

    def resolve_asset(self, symbol: str) -> dict:
        return {"symbol": symbol, "status": "resolved_locally"}

    def get_current_price(self, symbol: str) -> float | None:
        cache_key = f"price_{symbol}"
        if cache_key in self.cache:
            cached = self.cache[cache_key]
            if time.time() - cached["timestamp"] < self.cache_ttl:
                return cached["data"]

        price = None
        if symbol in self.crypto_symbols:
            data = self._get_binance("/api/v3/ticker/price", {"symbol": self._binance_pair(symbol)})
            if data and "price" in data:
                price = float(data["price"])
        else:
            api_symbol = self.symbol_aliases.get(symbol, symbol)
            data = self._get_twelve_data("/price", {"symbol": api_symbol})
            if data and "price" in data:
                price = float(data["price"])

        if price is not None:
            self.cache[cache_key] = {"timestamp": time.time(), "data": price}
            return price
        return None

    def get_risk_metrics(self, symbol: str) -> dict:
        return {"volatility": 0.0, "risk_score": 0.0}

    def get_price_history(self, symbol: str, days: int = 90) -> list[float]:
        prices: list[float] = []

        if symbol in self.crypto_symbols:
            data = self._get_binance(
                "/api/v3/klines",
                {"symbol": self._binance_pair(symbol), "interval": "1d", "limit": days},
            )
            if data and isinstance(data, list):
                prices = [float(candle[4]) for candle in data]
        else:
            api_symbol = self.symbol_aliases.get(symbol, symbol)
            data = self._get_twelve_data(
                "/time_series",
                {"symbol": api_symbol, "interval": "1day", "outputsize": days},
            )
            if data and "values" in data:
                candles = list(data["values"])
                candles.reverse()  # Twelve Data returns newest-first
                prices = [float(c["close"]) for c in candles]

        if prices:
            return prices

        logger.warning("History unavailable for %s. Using local cache.", symbol)
        return self._load_local_history(symbol, days)

    def _load_local_history(self, symbol: str, days: int) -> list[float]:
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
        return [float(p) for p in prices]

    def save_price_to_history(self, symbol: str, price: float):
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
        history = history[-180 * 288:]
        with cache_file.open("w", encoding="utf-8") as f:
            json.dump(history, f)

    def get_all_prices(self, symbols: list[str], save_history: bool = True) -> dict[str, float]:
        prices: dict[str, float] = {}
        for symbol in symbols:
            price = self.get_current_price(symbol)
            if price is not None:
                prices[symbol] = price
                if save_history:
                    self.save_price_to_history(symbol, price)
            else:
                logger.warning("Could not fetch price for %s", symbol)
            time.sleep(0.2)
        return prices

    def print_api_usage(self):
        print("\n[PriceClient] Total API calls this session:")
        print(f"  - Binance: {self.binance_calls}")
        print(f"  - Twelve Data: {self.twelve_data_calls}")
