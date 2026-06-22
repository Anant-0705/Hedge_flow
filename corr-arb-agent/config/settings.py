import os
from dotenv import load_dotenv

load_dotenv()


def _env_flag(name: str, default: str = "0") -> bool:
	return os.getenv(name, default).strip().lower() in {"1", "true", "yes", "on"}

# API keys
TWELVE_DATA_API_KEY = os.getenv("TWELVE_DATA_API_KEY")
GROQ_API_KEY = os.getenv("GROQ_API_KEY")
LLM_MODEL = os.getenv("LLM_MODEL", "llama-3.3-70b-versatile")

# Apify web scraper integration
APIFY_API_TOKEN = os.getenv("APIFY_API_TOKEN", "")
APIFY_DATASET_ID = os.getenv("APIFY_DATASET_ID", "")

# Binance base URL
BINANCE_BASE_URL = "https://data-api.binance.vision"

# Assets to watch
ASSETS = [asset.strip() for asset in os.getenv("ASSETS", "BTC,ETH,SOL,MATIC,GOLD,EUR").split(",") if asset.strip()]
LIVE_ASSETS = [asset.strip() for asset in os.getenv("LIVE_ASSETS", "BTC,ETH,SOL").split(",") if asset.strip()]

# Cointegration gate (Engle-Granger ADF test)
# Pairs with ADF p-value >= this threshold are rejected — correlation but no mean reversion.
COINTEGRATION_PVALUE_THRESHOLD = float(os.getenv("COINTEGRATION_PVALUE_THRESHOLD", 0.05))

# Correlation engine parameters
LOOKBACK_DAYS = int(os.getenv("LOOKBACK_DAYS", 90))
ZSCORE_THRESHOLD = float(os.getenv("ZSCORE_THRESHOLD", 2.0))
CHECK_INTERVAL_MIN = int(os.getenv("CHECK_INTERVAL_MINUTES", 5))
MIN_ABS_ZSCORE_LIVE = float(os.getenv("MIN_ABS_ZSCORE_LIVE", 2.8))
MIN_SIGNAL_CONFIDENCE = float(os.getenv("MIN_SIGNAL_CONFIDENCE", 0.35))
MIN_LLM_CONFIDENCE = float(os.getenv("MIN_LLM_CONFIDENCE", 0.40))
DISABLE_HARDENING_GATES = _env_flag("DISABLE_HARDENING_GATES")

# Pair auto-disable after enough evidence of negative expectancy.
PAIR_DISABLE_MIN_TRADES = int(os.getenv("PAIR_DISABLE_MIN_TRADES", 6))
PAIR_DISABLE_EXPECTANCY_USD = float(os.getenv("PAIR_DISABLE_EXPECTANCY_USD", -0.05))

# Position sizing
MAX_POSITION_USD = float(os.getenv("MAX_POSITION_USD", 200))
MIN_POSITION_USD = 50.0

# Logging
LOG_FILE = "logs/signals.log"

# Validation metadata
ARTIFACT_VERSION = "1.0.0"
STRATEGY_NAME = "correlation-arbitrage-v1"
