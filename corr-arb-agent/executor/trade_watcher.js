const fs = require("fs-extra");
const path = require("node:path");
const { ethers } = require("ethers");

const { buildTradeIntent, generateIntentHash } = require("./intent_builder");
const { AgentSigner } = require("./signer");
const { RouterSubmitter } = require("./router_submitter");
const { ReputationReader } = require("./reputation_reader");
require("dotenv").config({ path: "../.env" });

const PENDING_FILE = path.join(__dirname, "../data/pending_trades.json");
const AGENT_ID = Number(process.env.AGENT_NFT_ID || 0);
const AGENT_WALLET = ethers.isAddress(process.env.AGENT_WALLET_ADDRESS || "")
  ? process.env.AGENT_WALLET_ADDRESS
  : "0x0000000000000000000000000000000000000000";
const MAX_SIGNAL_AGE_SECONDS = Number(process.env.MAX_SIGNAL_AGE_SECONDS || 900);
const MIN_EXECUTION_SIZE_USD = Number(process.env.MIN_EXECUTION_SIZE_USD || 25);

function hasSecondLeg(decision) {
  const actionB = String((decision && (decision.action_b || decision.actionB)) || "").toUpperCase();
  return actionB === "LONG" || actionB === "SHORT";
}

function normalizeAction(action, fallback = "LONG") {
  const upper = String(action || fallback).toUpperCase();
  return upper === "SHORT" ? "SHORT" : "LONG";
}

function sanitizeDecision(decision) {
  const actionA = normalizeAction(decision?.action_a || decision?.actionA, "LONG");
  let actionB = normalizeAction(decision?.action_b || decision?.actionB, "SHORT");

  if (actionA === actionB) {
    actionB = actionA === "LONG" ? "SHORT" : "LONG";
  }

  const rawSize = Number(decision?.size_usd ?? decision?.sizeUsd ?? 0);
  const sizeUsd = Number.isFinite(rawSize) ? rawSize : 0;

  return {
    ...decision,
    action_a: actionA,
    action_b: actionB,
    size_usd: sizeUsd,
  };
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

function isSignalStale(signal) {
  const ts = signal?.timestamp;
  if (!ts) {
    return false;
  }

  const parsed = parseSignalTimestampMs(ts);
  if (!Number.isFinite(parsed)) {
    return false;
  }

  const ageSeconds = (Date.now() - parsed) / 1000;
  return ageSeconds > MAX_SIGNAL_AGE_SECONDS;
}

function shouldRetrySubmission(errorText) {
  const msg = String(errorText || "").toLowerCase();
  return (
    msg.includes("nonce") ||
    msg.includes("slippage") ||
    msg.includes("position") ||
    msg.includes("drawdown") ||
    msg.includes("trade")
  );
}

function markTradeFailed(trade, errorMessage) {
  trade.status = "FAILED";
  trade.executionResults = [
    {
      leg: "A",
      submit: {
        success: false,
        error: errorMessage,
      },
    },
  ];
  trade.updatedAt = new Date().toISOString();
}

function prevalidateTrade(trade) {
  const signal = trade.signal || {};
  const decision = sanitizeDecision(trade.decision || {});

  if (decision.execute === false) {
    return { ok: false, error: "Decision was SKIP at execution time", signal, decision };
  }

  if (decision.size_usd < MIN_EXECUTION_SIZE_USD) {
    return {
      ok: false,
      error: `size_usd ${decision.size_usd} below minimum ${MIN_EXECUTION_SIZE_USD}`,
      signal,
      decision,
    };
  }

  if (isSignalStale(signal)) {
    return {
      ok: false,
      error: `stale signal: older than ${MAX_SIGNAL_AGE_SECONDS}s`,
      signal,
      decision,
    };
  }

  return { ok: true, signal, decision };
}

async function refreshNonce(submitter, currentNonce) {
  const chainNonce = await submitter.getCurrentNonce(AGENT_ID || 0);
  if (Number.isFinite(chainNonce) && chainNonce > currentNonce) {
    return chainNonce;
  }
  return currentNonce;
}

async function submitLeg({ leg, signal, decision, currentNonce, signer, submitter }) {
  const syncedNonce = await refreshNonce(submitter, currentNonce);
  const { intent, typedData } = buildTradeIntent(
    signal,
    decision,
    AGENT_ID || 0,
    AGENT_WALLET,
    syncedNonce,
    leg
  );
  const intentHash = generateIntentHash(typedData);

  const signature = await signer.signTradeIntent(typedData);
  let submit = await submitter.submitIntent(intent, signature);

  if (!submit.success && shouldRetrySubmission(submit.error)) {
    console.log(`[TradeWatcher] Leg ${leg} retrying after failure: ${submit.error}`);
    
    // Give public RPC nodes time to sync the previous leg's state before retrying
    await new Promise((resolve) => setTimeout(resolve, 5000));

    const refreshedNonce = await refreshNonce(submitter, syncedNonce);
    const retryDecision = {
      ...decision,
      size_usd: Math.max(MIN_EXECUTION_SIZE_USD, Math.round(decision.size_usd * 0.8)),
    };
    const retryBuilt = buildTradeIntent(
      signal,
      retryDecision,
      AGENT_ID || 0,
      AGENT_WALLET,
      refreshedNonce,
      leg
    );
    const retrySig = await signer.signTradeIntent(retryBuilt.typedData);
    const retrySubmit = await submitter.submitIntent(retryBuilt.intent, retrySig);
    submit = {
      ...retrySubmit,
      retried: true,
      firstError: submit.error,
      retrySizeUsd: retryDecision.size_usd,
    };

    if (submit.success) {
      const successTxPart = submit.txHash ? ` tx=${submit.txHash}` : "";
      console.log(`[TradeWatcher] Leg ${leg} retry submitted ok${successTxPart}`);
      return {
        result: { leg, intentHash, submit },
        nextNonce: refreshedNonce + 1,
      };
    }

    return {
      result: { leg, intentHash, submit },
      nextNonce: refreshedNonce,
    };
  }

  if (submit.success) {
    const successTxPart = submit.txHash ? ` tx=${submit.txHash}` : "";
    console.log(`[TradeWatcher] Leg ${leg} submitted ok${successTxPart}`);
    return {
      result: { leg, intentHash, submit },
      nextNonce: syncedNonce + 1,
    };
  }

  console.log(`[TradeWatcher] Leg ${leg} failed: ${submit.error || "unknown error"}`);
  return {
    result: { leg, intentHash, submit },
    nextNonce: syncedNonce,
  };
}

async function processTrade(trade, context, currentNonce) {
  console.log(`\n[TradeWatcher] Processing ${trade.id}`);

  const precheck = prevalidateTrade(trade);
  if (!precheck.ok) {
    markTradeFailed(trade, precheck.error);
    console.log(`[TradeWatcher] Skipping ${trade.id}: ${precheck.error}`);
    return currentNonce;
  }

  const { signal, decision } = precheck;
  const legs = hasSecondLeg(decision) ? ["A", "B"] : ["A"];
  const results = [];
  let nonce = currentNonce;

  for (let i = 0; i < legs.length; i++) {
    const leg = legs[i];
    if (i > 0) {
      console.log(`[TradeWatcher] Waiting 5s before Leg ${leg} to allow RPC nodes to sync...`);
      await new Promise(r => setTimeout(r, 5000));
    }
    try {
      const legResult = await submitLeg({
        leg,
        signal,
        decision,
        currentNonce: nonce,
        signer: context.signer,
        submitter: context.submitter,
      });
      results.push(legResult.result);
      nonce = legResult.nextNonce;
    } catch (error) {
      console.error(`[TradeWatcher] Leg ${leg} error: ${error.message}`);
      results.push({
        leg,
        error: error.message,
        submit: { success: false, error: error.message },
      });
    }
  }

  const anySuccess = results.some((r) => r.submit?.success);
  trade.status = anySuccess ? "SUBMITTED" : "FAILED";
  trade.executionResults = results;
  trade.updatedAt = new Date().toISOString();
  return nonce;
}

async function processPendingTrades() {
  if (!(await fs.pathExists(PENDING_FILE))) {
    return { processed: 0, queueExists: false };
  }

  const trades = await fs.readJSON(PENDING_FILE);
  const pending = trades.filter((t) => t.status === "PENDING");

  if (pending.length === 0) {
    return { processed: 0, queueExists: true };
  }

  console.log(`\n[TradeWatcher] Found ${pending.length} pending trade(s)`);

  const signer = new AgentSigner();
  const submitter = new RouterSubmitter(signer.wallet || signer.provider);
  const repReader = new ReputationReader();

  const reputation = await repReader.getReputation(AGENT_ID);
  console.log(`[TradeWatcher] Agent reputation: ${reputation}`);

  if (!AGENT_ID || Number.isNaN(AGENT_ID)) {
    console.warn("[TradeWatcher] AGENT_NFT_ID is not set. Set it in .env before live submission.");
  }

  let currentNonce = await submitter.getCurrentNonce(AGENT_ID || 0);
  const context = { signer, submitter };

  for (const trade of pending) {
    currentNonce = await processTrade(trade, context, currentNonce);
  }

  await fs.writeJSON(PENDING_FILE, trades, { spaces: 2 });
  return { processed: pending.length, queueExists: true };
}

async function main() {
  console.log("[TradeWatcher] Starting...");
  console.log(`[TradeWatcher] Agent ID: ${AGENT_ID}`);
  console.log(`[TradeWatcher] Watching: ${PENDING_FILE}`);

  let idleLoops = 0;

  while (process.env.STOP_WATCHER !== "1") {
    try {
      const loopResult = await processPendingTrades();
      if ((loopResult?.processed || 0) === 0) {
        idleLoops += 1;
        if (idleLoops === 1 || idleLoops % 10 === 0) {
          const reason = loopResult?.queueExists ? "queue empty" : "queue file missing";
          console.log(`[TradeWatcher] Idle: ${reason}`);
        }
      } else {
        idleLoops = 0;
      }
    } catch (err) {
      console.error("[TradeWatcher] Loop error:", err.message);
    }

    await new Promise((resolve) => setTimeout(resolve, 30000));
  }
}

main();
