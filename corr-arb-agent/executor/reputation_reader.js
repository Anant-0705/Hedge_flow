const { ethers } = require("ethers");
require("dotenv").config({ path: "../.env" });

const REPUTATION_REGISTRY_ABI = [
  "function getAverageScore(uint256 agentId) external view returns (uint256)",
];

class ReputationReader {
  constructor() {
    this.provider = new ethers.JsonRpcProvider(
      process.env.RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com"
    );

    const addr =
      process.env.REPUTATION_REGISTRY_ADDRESS ||
      "0x423a9904e39537a9997fbaF0f220d79D7d545763";
    if (!addr || addr.includes("PLACEHOLDER")) {
      this.enabled = false;
      console.warn("[ReputationReader] Registry address missing. Using default reputation=50.");
      return;
    }

    this.enabled = true;
    this.contract = new ethers.Contract(addr, REPUTATION_REGISTRY_ABI, this.provider);
  }

  async getReputation(agentId) {
    if (!this.enabled) {
      return 50;
    }

    try {
      const score = await this.contract.getAverageScore(BigInt(agentId));
      return Number(score);
    } catch {
      return 50;
    }
  }
}

module.exports = { ReputationReader };
