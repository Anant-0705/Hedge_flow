const { ethers } = require("ethers");
require("dotenv").config({ path: "../.env" });

class AgentSigner {
  constructor() {
    this.provider = new ethers.JsonRpcProvider(
      process.env.RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com"
    );

    const pk = process.env.AGENT_PRIVATE_KEY || "";
    if (!pk || pk.includes("YOUR_PRIVATE_KEY_HERE")) {
      this.wallet = null;
      console.warn("[Signer] AGENT_PRIVATE_KEY not set. Using dry-run signature mode.");
      return;
    }

    this.wallet = new ethers.Wallet(pk, this.provider);
    console.log(`[Signer] Agent wallet: ${this.wallet.address}`);
  }

  async signTradeIntent(typedData) {
    if (!this.wallet) {
      // 65-byte placeholder signature for dry-run flow.
      return "0x" + "11".repeat(65);
    }

    console.log("\n[Signer] Signing TradeIntent with EIP-712...");

    const signature = await this.wallet.signTypedData(
      typedData.domain,
      typedData.types,
      typedData.value
    );

    const recovered = ethers.verifyTypedData(
      typedData.domain,
      typedData.types,
      typedData.value,
      signature
    );

    if (recovered.toLowerCase() !== this.wallet.address.toLowerCase()) {
      throw new Error(`Signature verification failed. Recovered: ${recovered}`);
    }

    console.log("[Signer] Signature verified locally");
    return signature;
  }

  async getCurrentNonce() {
    if (!this.wallet) {
      return 0;
    }
    return this.provider.getTransactionCount(this.wallet.address);
  }

  async getBalance() {
    if (!this.wallet) {
      return "0";
    }
    const balance = await this.provider.getBalance(this.wallet.address);
    return ethers.formatEther(balance);
  }
}

module.exports = { AgentSigner };
