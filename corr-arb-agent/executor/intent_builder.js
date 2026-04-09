const { ethers } = require("ethers");
require("dotenv").config({ path: "../.env" });

const TRADE_INTENT_TYPES = {
  TradeIntent: [
    { name: "agentId", type: "uint256" },
    { name: "agentWallet", type: "address" },
    { name: "pair", type: "string" },
    { name: "action", type: "string" },
    { name: "amountUsdScaled", type: "uint256" },
    { name: "maxSlippageBps", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
};

const RISK_ROUTER_DOMAIN = {
  name: "RiskRouter",
  version: "1",
  chainId: Number(process.env.CHAIN_ID || "11155111"),
  verifyingContract:
    process.env.RISK_ROUTER_ADDRESS || "0x0000000000000000000000000000000000000000",
};

function pick(obj, keys, fallback = undefined) {
  for (const key of keys) {
    if (obj && obj[key] !== undefined && obj[key] !== null) {
      return obj[key];
    }
  }
  return fallback;
}

function normalizeSignal(signal) {
  return {
    assetA: String(pick(signal, ["assetA", "asset_a"], "BTC")).toUpperCase(),
    assetB: String(pick(signal, ["assetB", "asset_b"], "ETH")).toUpperCase(),
    zScore: Number(pick(signal, ["zScore", "z_score"], 0)),
  };
}

function normalizeDecision(decision) {
  const fallbackHash = "0x" + "00".repeat(32);
  return {
    actionA: String(pick(decision, ["action_a", "actionA"], "LONG")).toUpperCase(),
    actionB: String(pick(decision, ["action_b", "actionB"], "SHORT")).toUpperCase(),
    sizeUsd: Number(pick(decision, ["size_usd", "sizeUsd"], 0)),
    reasoningHash: String(
      pick(decision, ["reasoning_hash", "reasoningHash"], fallbackHash)
    ),
  };
}

function toRouterAction(action) {
  return action === "LONG" ? "BUY" : "SELL";
}

function toRouterPair(symbol) {
  const mapped = {
    BTC: "XBTUSD",
    ETH: "ETHUSD",
    SOL: "SOLUSD",
    MATIC: "POLUSD",
    POL: "POLUSD",
    GOLD: "XAUUSD",
    GLD: "XAUUSD",
    EUR: "EURUSD",
    FXE: "EURUSD",
  };
  const upper = String(symbol || "").toUpperCase();
  return mapped[upper] || `${upper}USD`;
}

function buildTradeIntent(signal, decision, agentId, agentWalletAddress, nonce, leg = "A") {
  const s = normalizeSignal(signal);
  const d = normalizeDecision(decision);

  const useLegA = leg === "A";
  const symbol = useLegA ? s.assetA : s.assetB;
  const action = useLegA ? d.actionA : d.actionB;

  const intent = {
    agentId: BigInt(agentId),
    agentWallet: agentWalletAddress,
    pair: toRouterPair(symbol),
    action: toRouterAction(action),
    amountUsdScaled: BigInt(Math.round(d.sizeUsd * 100)),
    maxSlippageBps: BigInt(Number(process.env.MAX_SLIPPAGE_BPS || "100")),
    nonce: BigInt(nonce),
    deadline: BigInt(Math.floor(Date.now() / 1000) + 300),
  };

  const typedData = {
    domain: RISK_ROUTER_DOMAIN,
    types: TRADE_INTENT_TYPES,
    value: intent,
  };

  console.log("\n[IntentBuilder] Built TradeIntent");
  console.log(`  Leg: ${leg}`);
  console.log(`  Pair: ${intent.pair}`);
  console.log(`  Action: ${intent.action}`);
  console.log(`  Amount: $${(Number(intent.amountUsdScaled) / 100).toFixed(2)}`);

  return { intent, typedData };
}

function generateIntentHash(typedData) {
  return ethers.TypedDataEncoder.hash(
    typedData.domain,
    typedData.types,
    typedData.value
  );
}

module.exports = {
  TRADE_INTENT_TYPES,
  RISK_ROUTER_DOMAIN,
  buildTradeIntent,
  generateIntentHash,
  toRouterPair,
  toRouterAction,
};
