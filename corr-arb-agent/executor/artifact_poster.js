const { ethers } = require("ethers");
require("dotenv").config({ path: "../.env" });

const VALIDATION_REGISTRY_ABI = [
  "function postEIP712Attestation(uint256 agentId, bytes32 checkpointHash, uint8 score, string notes) external",
  "function getAverageValidationScore(uint256 agentId) external view returns (uint256)",
];

const AGENT_REGISTRY_DOMAIN = {
  name: "AITradingAgent",
  version: "1",
  chainId: Number(process.env.CHAIN_ID || "11155111"),
  verifyingContract:
    process.env.AGENT_REGISTRY_ADDRESS ||
    "0x97b07dDc405B0c28B17559aFFE63BdB3632d0ca3",
};

const CHECKPOINT_TYPES = {
  Checkpoint: [
    { name: "agentId", type: "uint256" },
    { name: "timestamp", type: "uint256" },
    { name: "action", type: "string" },
    { name: "pair", type: "string" },
    { name: "amountUsdScaled", type: "uint256" },
    { name: "priceUsdScaled", type: "uint256" },
    { name: "reasoningHash", type: "bytes32" },
    { name: "zScoreBps", type: "int256" },
    { name: "corrBps", type: "int256" },
    { name: "histMeanBps", type: "int256" },
    { name: "histStdBps", type: "int256" },
    { name: "signalConfBps", type: "uint256" },
    { name: "llmConfBps", type: "uint256" },
  ],
};

function pick(obj, keys, fallback = undefined) {
  for (const key of keys) {
    const value = obj?.[key];
    if (value !== undefined && value !== null) {
      return value;
    }
  }
  return fallback;
}

function toRouterAction(action) {
  return String(action || "LONG").toUpperCase() === "LONG" ? "BUY" : "SELL";
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

function truncate(text, maxLen) {
  if (!text || text.length <= maxLen) {
    return text;
  }
  return `${text.slice(0, maxLen - 3)}...`;
}

function toBps(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    return 0;
  }
  return Math.round(n * 10000);
}

function shortHex(value, start = 10, end = 6) {
  const text = String(value || "");
  if (!text.startsWith("0x") || text.length <= start + end + 3) {
    return text || "n/a";
  }
  return `${text.slice(0, start)}...${text.slice(-end)}`;
}

function parseSignalTimestampMs(rawTs) {
  if (!rawTs) {
    return Number.NaN;
  }

  let ts = String(rawTs).trim();
  if (!ts) {
    return Number.NaN;
  }

  if (ts.includes(" ") && !ts.includes("T")) {
    ts = ts.replace(" ", "T");
  }

  ts = ts.replace(/\.(\d{3})\d+/, ".$1");

  const hasTimezone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(ts);
  const normalized = hasTimezone ? ts : `${ts}Z`;
  return Date.parse(normalized);
}

class ArtifactPoster {
  constructor(signerWallet) {
    const addr =
      process.env.VALIDATION_REGISTRY_ADDRESS ||
      "0x92bF63E5C7Ac6980f237a7164Ab413BE226187F1";

    if (!addr || addr.includes("PLACEHOLDER")) {
      console.warn("[ArtifactPoster] VALIDATION_REGISTRY_ADDRESS missing. LOG-ONLY mode enabled.");
      this.logOnly = true;
      return;
    }

    if (!signerWallet || typeof signerWallet.sendTransaction !== "function") {
      console.warn("[ArtifactPoster] Writable signer not available. LOG-ONLY mode enabled.");
      this.logOnly = true;
      return;
    }

    this.logOnly = false;
    this.contract = new ethers.Contract(addr, VALIDATION_REGISTRY_ABI, signerWallet);
  }

  async postArtifact(agentId, signal, decision, leg = "A", context = {}) {
    const assetA = String(pick(signal, ["assetA", "asset_a"], "BTC")).toUpperCase();
    const assetB = String(pick(signal, ["assetB", "asset_b"], "ETH")).toUpperCase();
    const actionA = String(pick(decision, ["action_a", "actionA"], "LONG"));
    const actionB = String(pick(decision, ["action_b", "actionB"], "SHORT"));
    const sizeUsd = Number(pick(decision, ["size_usd", "sizeUsd"], 0));
    const reasonHash = String(
      pick(decision, ["reasoning_hash", "reasoningHash"], "0x" + "00".repeat(32))
    );
    const zScore = Number(pick(signal, ["zScore", "z_score"], 0));
    const corr = Number(pick(signal, ["currentCorrelation", "current_correlation"], 0));
    const hist = Number(pick(signal, ["historicalMean", "historical_mean"], 0));
    const histStd = Number(pick(signal, ["historicalStd", "historical_std"], 0));
    const direction = String(pick(signal, ["direction"], "UNKNOWN"));
    const signalConf = Number(pick(signal, ["confidence"], 0));
    const llmConf = Number(pick(decision, ["confidence"], 0));
    const priceA = Number(pick(signal, ["priceA", "price_a"], 0));
    const priceB = Number(pick(signal, ["priceB", "price_b"], 0));
    const intentHash = String(context.intentHash || "");
    const txHash = String(context.txHash || "");

    const useA = leg === "A";
    const pair = toRouterPair(useA ? assetA : assetB);
    const action = toRouterAction(useA ? actionA : actionB);
    const price = useA ? priceA : priceB;

    const checkpoint = {
      agentId: BigInt(agentId),
      timestamp: BigInt(Math.floor(Date.now() / 1000)),
      action,
      pair,
      amountUsdScaled: BigInt(Math.round(sizeUsd * 100)),
      priceUsdScaled: BigInt(Math.round(price * 100)),
      reasoningHash: reasonHash,
      zScoreBps: BigInt(toBps(zScore)),
      corrBps: BigInt(toBps(corr)),
      histMeanBps: BigInt(toBps(hist)),
      histStdBps: BigInt(toBps(histStd)),
      signalConfBps: BigInt(Math.max(0, toBps(signalConf))),
      llmConfBps: BigInt(Math.max(0, toBps(llmConf))),
    };

    const checkpointHash = ethers.TypedDataEncoder.hash(
      AGENT_REGISTRY_DOMAIN,
      CHECKPOINT_TYPES,
      checkpoint
    );

    const absZ = Math.abs(zScore);
    const score = absZ >= 2.8 ? 100 : absZ >= 2.0 ? 90 : 80;

    const reasonHashShort = reasonHash.startsWith("0x")
      ? `${reasonHash.slice(0, 10)}...${reasonHash.slice(-6)}`
      : reasonHash;

    const notesRaw = [
      `v2 CorrArb`,
      `pair=${assetA}/${assetB}`,
      `leg=${leg}`,
      `route=${pair} ${action}`,
      `z=${zScore.toFixed(2)}`,
      `corr=${corr.toFixed(3)}`,
      `hist=${hist.toFixed(3)}±${histStd.toFixed(3)}`,
      `dir=${direction}`,
      `sigConf=${signalConf.toFixed(2)}`,
      `llmConf=${llmConf.toFixed(2)}`,
      `size=$${sizeUsd.toFixed(0)}`,
      `reason=${reasonHashShort}`,
      `intent=${shortHex(intentHash)}`,
      `tx=${shortHex(txHash)}`,
      `risk=maxSlip=${Number(process.env.MAX_SLIPPAGE_BPS || "100") / 100}%`,
    ].join(" | ");
    const notes = truncate(notesRaw, 480);

    if (this.logOnly) {
      console.log("\n[ArtifactPoster] LOG-ONLY attestation");
      console.log(`  checkpointHash: ${checkpointHash}`);
      console.log(`  score: ${score}`);
      return { success: true, logOnly: true, checkpointHash, score };
    }

    try {
      const tx = await this.contract.postEIP712Attestation(
        BigInt(agentId),
        checkpointHash,
        score,
        notes
      );

      await tx.wait(1);
      console.log(`[ArtifactPoster] Checkpoint posted score=${score}/100 tx=${tx.hash}`);
      return { success: true, txHash: tx.hash, checkpointHash, score };
    } catch (error) {
      console.error(`[ArtifactPoster] Error: ${error.message}`);
      return { success: false, error: error.message, checkpointHash, score };
    }
  }
}

module.exports = { ArtifactPoster, AGENT_REGISTRY_DOMAIN, CHECKPOINT_TYPES };
