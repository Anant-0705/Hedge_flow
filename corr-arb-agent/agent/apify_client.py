import logging
import time
import requests
from config.settings import APIFY_API_TOKEN, APIFY_DATASET_ID

logger = logging.getLogger(__name__)

class ApifyMacroClient:
    def __init__(self):
        self.api_token = APIFY_API_TOKEN
        self.dataset_id = APIFY_DATASET_ID
        self.cache: dict | None = None
        self.cache_ttl = 1800  # 30 min — matches scraper schedule
        self.cached_at: float = 0

    def fetch(self) -> dict:
        """
        Returns the latest scraped record from the Apify dataset.
        Caches for 30 minutes. Falls back to empty defaults if 
        Apify is unreachable or not configured.
        
        Return format matches what signal_monitor.py needs:
        {
          "fear_greed": "45 (Fear)",
          "btc_funding_rate": "0.012%",
          "market_regime": "neutral",
          "news_sentiment": "bearish",
          "top_headlines": ["headline1", ...],
          "raw": <full apify record for LLM context>
        }
        """
        # If not configured (no API token/dataset ID), return defaults immediately
        if not self.api_token or not self.dataset_id:
            return self._defaults()

        # Cache check
        if self.cache and time.time() - self.cached_at < self.cache_ttl:
            return self.cache

        try:
            url = (
                f"https://api.apify.com/v2/datasets/{self.dataset_id}"
                f"/items?limit=1&desc=1&token={self.api_token}"
            )
            resp = requests.get(url, timeout=8)
            resp.raise_for_status()
            items = resp.json()
            if not items:
                return self._defaults()
            
            record = items[0]
            result = self._format(record)
            self.cache = result
            self.cached_at = time.time()
            return result

        except Exception as exc:
            logger.warning("Apify fetch failed: %s — using defaults", exc)
            return self._defaults()

    def _format(self, record: dict) -> dict:
        fg_value = record.get("fear_greed_value", "unknown")
        fg_label = record.get("fear_greed_label", "unknown")
        btc_rate = record.get("btc_funding_rate_pct", "unknown")
        eth_rate = record.get("eth_funding_rate_pct", "unknown")
        
        # Combine all headlines into one list for LLM
        headlines = (
            record.get("coindesk_headlines", []) +
            record.get("cointelegraph_headlines", []) +
            record.get("reddit_top_posts", [])
        )[:10]
        
        return {
            "fear_greed": f"{fg_value} ({fg_label})" if fg_value != "unknown" else "unknown",
            "btc_funding_rate": f"{btc_rate}%" if btc_rate != "unknown" else "unknown",
            "eth_funding_rate": f"{eth_rate}%" if eth_rate != "unknown" else "unknown",
            "market_regime": record.get("market_regime", "unknown"),
            "news_sentiment": record.get("combined_sentiment", "unknown"),
            "top_headlines": headlines,
            "scraped_at": record.get("scraped_at", "unknown"),
            "raw": record,
        }

    def _defaults(self) -> dict:
        return {
            "fear_greed": "unknown",
            "btc_funding_rate": "unknown",
            "eth_funding_rate": "unknown",
            "market_regime": "unknown",
            "news_sentiment": "unknown",
            "top_headlines": [],
            "scraped_at": "unknown",
            "raw": {},
        }
