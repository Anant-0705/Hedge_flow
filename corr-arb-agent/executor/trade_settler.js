const fs = require("fs-extra");
const path = require("node:path");
const axios = require("axios");
const { ethers } = require("ethers");

const { ReputationUpdater } = require("./reputation_updater");
const { ReputationReader } = require("./reputation_reader");
require("dotenv").config({ path: "../.env" });

const PENDING_FILE = path.join(__dirname, "../data/pending_trades.json");
const AGENT_ID = Number(process.env.AGENT_NFT_ID || "0");
const SETTLER_POLL_MS = Number(process.env.SETTLER_POLL_MS || "30000");
const SETTLEMENT_HOLD_MINUTES = Number(process.env.SETTLEMENT_HOLD_MINUTES || "15");
const DEFAULT_FAILED_TRADE_PNL_USD = Number(process.env.DEFAULT_FAILED_TRADE_PNL_USD || "-5");
const ALLOW_SETTLE_DRY_RUN = process.env.ALLOW_SETTLE_DRY_RUN === "1";

const PRISM_BASE_URL = process.env.PRISM_BASE_URL || "https://api.prismapi.ai";
const PRISM_API_KEY = process.env.PRISM_API_KEY || "";

const SYMBOL_ALIASES = {
  MATIC: "POL",
  GOLD: "GLD",
  EUR: "FXE",
};
const STOCK_SYMBOLS = new Set(["GLD", "FXE"]);

function pick(obj, keys, fallback = undefined) {
  for (const key of keys) {
    const value = obj?.[key];
    if (value !== undefined && value !== null) {
      return value;
    }
  }
  return fallback;
}

function toIso(ts) {
  return new Date(ts).toISOString();
}

function pairKey(signal) {
  const assetA = String(pick(signal, ["assetA", "asset_a"], "")).toUpperCase();
  const assetB = String(pick(signal, ["assetB", "asset_b"], "")).toUpperCase();
  if (!assetA || !assetB) {
    return "";
  }
  return [assetA, assetB].sort((a, b) => a.localeCompare(b)).join("/");
}

class TradeSettler {
  constructor() {
    this.provider = new ethers.JsonRpcProvider(
      process.env.RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com"
    );
    this.reputationUpdater = new ReputationUpdater();
    this.reputationReader = new ReputationReader();
  }

  async start() {
    console.log("[TradeSettler] Starting...");
    console.log(`[TradeSettler] Watching file: ${PENDING_FILE}`);

    let idleLoops = 0;

    while (process.env.STOP_SETTLER !== "1") {
      try {
        const loopResult = await this.runOnce();
        if ((loopResult?.inspected || 0) === 0) {
          idleLoops += 1;
          if (idleLoops === 1 || idleLoops % 10 === 0) {
            console.log("[TradeSettler] Idle: no submitted trades to settle");
          }
        } else {
          idleLoops = 0;
        }
      } catch (error) {
        console.error(`[TradeSettler] Loop error: ${error.message}`);
      }
      await new Promise((resolve) => setTimeout(resolve, SETTLER_POLL_MS));
    }
  }

  async runOnce() {
    if (!(await fs.pathExists(PENDING_FILE))) {
      return { inspected: 0, settled: 0 };
    }

    const trades = await fs.readJSON(PENDING_FILE);
    let changed = false;

    const candidates = trades.filter((trade) => trade.status === "SUBMITTED" && !trade.settled);
    if (candidates.length === 0) {
      return { inspected: 0, settled: 0 };
    }

    console.log(`\n[TradeSettler] Found ${candidates.length} submitted trade(s) to inspect`);
    let settledCount = 0;

    for (const trade of candidates) {
      const settlement = await this.trySettleTrade(trade);
      if (!settlement?.settled) {
        if (settlement?.reason === "hold-window") {
          console.log(
            `[TradeSettler] Waiting ${settlement.minutesLeft.toFixed(1)}m for ${trade.id} ` +
              `(hold=${SETTLEMENT_HOLD_MINUTES}m)`
          );
        } else if (settlement?.reason === "awaiting-confirmation") {
          console.log(`[TradeSettler] Awaiting on-chain confirmations for ${trade.id}`);
        } else if (settlement?.reason === "pnl-unavailable") {
          console.log(`[TradeSettler] PnL unavailable for ${trade.id}; will retry (${settlement.error})`);
        } else if (settlement?.reason === "no-execution-results") {
          console.log(`[TradeSettler] ${trade.id} has no execution results yet; watcher likely still processing`);
        }
        continue;
      }

      changed = true;
      settledCount += 1;
      trade.status = "SETTLED";
      trade.settled = true;
      trade.settlement = settlement;
      trade.updatedAt = new Date().toISOString();

      const state = await this.reputationUpdater.recordOutcome({
        tradeId: trade.id,
        pnlUsd: settlement.pnlUsd,
        metadata: {
          source: settlement.source,
          pair: pairKey(trade.signal || {}),
          txHashes: settlement.txHashes,
          zScore: Number(pick(trade.signal, ["zScore", "z_score"], 0)),
        },
      });

      const onChainScore = AGENT_ID ? await this.reputationReader.getReputation(AGENT_ID) : 50;
      const pauseMsg = state.isPaused
        ? ` | circuit-breaker until ${toIso(state.pausedUntil * 1000)}`
        : "";

      console.log(
        `[TradeSettler] Settled ${trade.id} pnl=$${settlement.pnlUsd.toFixed(2)} ` +
          `| local score=${state.score}/100 | on-chain score=${onChainScore}/100${pauseMsg}`
      );
    }

    if (changed) {
      await fs.writeJSON(PENDING_FILE, trades, { spaces: 2 });
    }

    return { inspected: candidates.length, settled: settledCount };
  }

  async trySettleTrade(trade) {
    const executionResults = Array.isArray(trade.executionResults) ? trade.executionResults : [];
    if (executionResults.length === 0) {
      return { settled: false, reason: "no-execution-results" };
    }

    const failedLeg = executionResults.find((leg) => leg?.submit?.success === false);
    if (failedLeg) {
      return {
        settled: true,
        source: "failed-leg",
        pnlUsd: DEFAULT_FAILED_TRADE_PNL_USD,
        txHashes: executionResults
          .map((leg) => leg?.submit?.txHash)
          .filter((hash) => typeof hash === "string" && hash.length > 0),
        settledAt: new Date().toISOString(),
      };
    }

    const txCheck = await this.checkLegReceipts(executionResults);
    if (!txCheck.ready) {
      return { settled: false, reason: "awaiting-confirmation", txHashes: txCheck.txHashes };
    }

    if (txCheck.reverted) {
      return {
        settled: true,
        source: "reverted-tx",
        pnlUsd: DEFAULT_FAILED_TRADE_PNL_USD,
        txHashes: txCheck.txHashes,
        settledAt: new Date().toISOString(),
      };
    }

    const createdAt = Date.parse(trade.timestamp || trade.updatedAt || new Date().toISOString());
    const ageMinutes = (Date.now() - createdAt) / (60 * 1000);

    if (ageMinutes < SETTLEMENT_HOLD_MINUTES) {
      return {
        settled: false,
        reason: "hold-window",
        minutesLeft: SETTLEMENT_HOLD_MINUTES - ageMinutes,
      };
    }

    try {
      const estimate = await this.estimatePnlUsd(trade);
      return {
        settled: true,
        source: estimate.source,
        pnlUsd: estimate.pnlUsd,
        txHashes: txCheck.txHashes,
        detail: estimate.detail,
        settledAt: new Date().toISOString(),
      };
    } catch (error) {
      console.warn(`[TradeSettler] PnL estimation failed for ${trade.id}: ${error.message}`);
      return { settled: false, reason: "pnl-unavailable", error: error.message };
    }
  }

  async checkLegReceipts(executionResults) {
    let sawOnChainTx = false;
    let reverted = false;
    const txHashes = [];

    for (const leg of executionResults) {
      const submit = leg?.submit || {};
      const txHash = submit.txHash;
      const dryRun = Boolean(submit.dryRun);

      if (!txHash || dryRun) {
        continue;
      }

      sawOnChainTx = true;
      txHashes.push(txHash);

      const receipt = await this.provider.getTransactionReceipt(txHash);
      if (!receipt) {
        return { ready: false, reverted: false, txHashes };
      }

      if (receipt.status !== 1) {
        reverted = true;
      }
    }

    if (!sawOnChainTx && !ALLOW_SETTLE_DRY_RUN) {
      return { ready: false, reverted: false, txHashes: [] };
    }

    if (!sawOnChainTx) {
      return { ready: true, reverted: false, txHashes: [] };
    }

    return { ready: true, reverted, txHashes };
  }

  async estimatePnlUsd(trade) {
    const signal = trade.signal || {};
    const decision = trade.decision || {};

    const assetA = String(pick(signal, ["assetA", "asset_a"], "BTC")).toUpperCase();
    const assetB = String(pick(signal, ["assetB", "asset_b"], "ETH")).toUpperCase();
    const entryA = Number(pick(signal, ["priceA", "price_a"], 0));
    const entryB = Number(pick(signal, ["priceB", "price_b"], 0));

    const actionA = String(pick(decision, ["action_a", "actionA"], "LONG")).toUpperCase();
    const actionB = String(pick(decision, ["action_b", "actionB"], "SHORT")).toUpperCase();

    const sizeUsd = Number(pick(decision, ["size_usd", "sizeUsd"], 0));
    const legCount = actionB === "LONG" || actionB === "SHORT" ? 2 : 1;
    const legNotional = legCount > 0 ? sizeUsd : 0;

    if (entryA <= 0 || sizeUsd <= 0) {
      throw new Error("missing entry price or position size");
    }

    const currentA = await this.getCurrentPrice(assetA);
    const currentB = legCount === 2 ? await this.getCurrentPrice(assetB) : 0;

    const legAPnl = this.computeLegPnlUsd(legNotional, entryA, currentA, actionA);
    const legBPnl = legCount === 2 ? this.computeLegPnlUsd(legNotional, entryB, currentB, actionB) : 0;

    const pnlUsd = legAPnl + legBPnl;

    return {
      source: "mark-to-market",
      pnlUsd,
      detail: {
        assetA,
        assetB,
        actionA,
        actionB,
        entryA,
        entryB,
        currentA,
        currentB,
        legAPnl,
        legBPnl,
      },
    };
  }

  computeLegPnlUsd(notionalUsd, entryPrice, currentPrice, action) {
    if (entryPrice <= 0 || currentPrice <= 0 || notionalUsd <= 0) {
      return 0;
    }

    const ret = (currentPrice - entryPrice) / entryPrice;
    if (action === "SHORT") {
      return notionalUsd * -ret;
    }
    return notionalUsd * ret;
  }

  normalizePrismSymbol(symbol) {
    const upper = String(symbol || "").toUpperCase();
    return SYMBOL_ALIASES[upper] || upper;
  }

  async getCurrentPrice(symbol) {
    const normalized = this.normalizePrismSymbol(symbol);

    const headers = {};
    if (PRISM_API_KEY) {
      headers["X-API-Key"] = PRISM_API_KEY;
      headers["x-api-key"] = PRISM_API_KEY;
      headers.Authorization = `Bearer ${PRISM_API_KEY}`;
    }

    const primaryEndpoints = STOCK_SYMBOLS.has(normalized)
      ? [
          `${PRISM_BASE_URL}/stocks/${normalized}/quote`,
          `${PRISM_BASE_URL}/crypto/price/${normalized}`,
        ]
      : [
          `${PRISM_BASE_URL}/crypto/price/${normalized}`,
          `${PRISM_BASE_URL}/stocks/${normalized}/quote`,
        ];

    const endpoints = [
      ...primaryEndpoints,
      `${PRISM_BASE_URL}/resolve/${normalized}?live_price=true`,
      `${PRISM_BASE_URL}/assets/${normalized}/prices?interval=1d&limit=1&asset_type=crypto`,
    ];

    for (const url of endpoints) {
      const price = await this.fetchPriceFromEndpoint(url, headers);
      if (price !== null) {
        return price;
      }
    }

    throw new Error(`price unavailable for symbol ${symbol}`);
  }

  async fetchPriceFromEndpoint(url, headers) {
    try {
      const response = await axios.get(url, { headers, timeout: 10000 });
      return this.extractPrice(response.data || {});
    } catch {
      return null;
    }
  }

  extractPrice(data) {
    const direct = Number(
      data.price_usd ?? data.price ?? data.value ?? data.data?.price_usd ?? data.data?.price
    );
    if (Number.isFinite(direct) && direct > 0) {
      return direct;
    }

    let prices = [];
    if (Array.isArray(data.prices)) {
      prices = data.prices;
    } else if (Array.isArray(data.candles)) {
      prices = data.candles;
    }

    if (prices.length > 0) {
      const latest = prices[prices.length - 1];
      const close = Number(latest.close ?? latest.price ?? latest.value);
      if (Number.isFinite(close) && close > 0) {
        return close;
      }
    }

    return null;
  }
}

async function main() {
  const settler = new TradeSettler();
  await settler.start();
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = { TradeSettler };
