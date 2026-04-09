const { ethers } = require("ethers");
require("dotenv").config({ path: "../.env" });

const RISK_ROUTER_ABI = [
  "function submitTradeIntent(tuple(uint256 agentId, address agentWallet, string pair, string action, uint256 amountUsdScaled, uint256 maxSlippageBps, uint256 nonce, uint256 deadline) intent, bytes signature) external",
  "function simulateIntent(tuple(uint256 agentId, address agentWallet, string pair, string action, uint256 amountUsdScaled, uint256 maxSlippageBps, uint256 nonce, uint256 deadline) intent) external view returns (bool valid, string reason)",
  "function getIntentNonce(uint256 agentId) external view returns (uint256)",
  "event TradeApproved(uint256 indexed agentId, bytes32 intentHash, uint256 amountUsdScaled)",
  "event TradeRejected(uint256 indexed agentId, bytes32 intentHash, string reason)",
];

class RouterSubmitter {
  constructor(signerWallet) {
    const addr = process.env.RISK_ROUTER_ADDRESS || "";
    if (!addr || addr.includes("PLACEHOLDER") || addr.includes("0x_PLACEHOLDER")) {
      console.warn("[RouterSubmitter] RISK_ROUTER_ADDRESS not set. DRY RUN mode enabled.");
      this.dryRun = true;
      return;
    }

    if (!signerWallet || typeof signerWallet.sendTransaction !== "function") {
      console.warn("[RouterSubmitter] Writable signer not available. DRY RUN mode enabled.");
      this.dryRun = true;
      return;
    }

    this.dryRun = false;
    this.contract = new ethers.Contract(addr, RISK_ROUTER_ABI, signerWallet);
    console.log(`[RouterSubmitter] Connected to Risk Router: ${addr}`);
  }

  async submitIntent(intent, signature) {
    if (this.dryRun) {
      console.log("\n[RouterSubmitter] DRY RUN submit:");
      console.log(`  Pair: ${intent.pair}`);
      console.log(`  Action: ${intent.action}`);
      console.log(`  Size: $${Number(intent.amountUsdScaled) / 100}`);
      return {
        success: true,
        dryRun: true,
        tradeId: ethers.keccak256(ethers.toUtf8Bytes(`dry_run_${Date.now()}`)),
      };
    }

    try {
      console.log("\n[RouterSubmitter] Simulating intent...");
      const [valid, reason] = await this.contract.simulateIntent(intent);
      if (!valid) {
        console.error(`[RouterSubmitter] Simulation failed: ${reason}`);
        return { success: false, error: reason };
      }

      console.log("[RouterSubmitter] Simulation passed. Submitting to RiskRouter...");

      const gasEstimate = await this.contract.submitTradeIntent.estimateGas(
        intent,
        signature
      );

      const tx = await this.contract.submitTradeIntent(intent, signature, {
        gasLimit: (gasEstimate * 120n) / 100n,
      });

      console.log(`[RouterSubmitter] Broadcast tx: ${tx.hash}`);

      const receipt = await tx.wait(2);
      if (receipt.status !== 1) {
        throw new Error(`Transaction reverted: ${tx.hash}`);
      }

      console.log(`[RouterSubmitter] Confirmed in block ${receipt.blockNumber}`);

      const approved = receipt.logs
        .map((log) => {
          try {
            return this.contract.interface.parseLog(log);
          } catch {
            return null;
          }
        })
        .filter(Boolean)
        .find((e) => e.name === "TradeApproved");

      const tradeId = approved?.args?.intentHash || tx.hash;
      console.log(`[RouterSubmitter] Intent accepted: ${tradeId}`);
      return {
        success: true,
        txHash: tx.hash,
        tradeId,
        blockNumber: receipt.blockNumber,
      };
    } catch (error) {
      console.error(`[RouterSubmitter] Submission error: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  async getCurrentNonce(agentId) {
    if (this.dryRun) {
      return 0;
    }

    try {
      return Number(await this.contract.getIntentNonce(BigInt(agentId)));
    } catch {
      return 0;
    }
  }
}

module.exports = { RouterSubmitter };
