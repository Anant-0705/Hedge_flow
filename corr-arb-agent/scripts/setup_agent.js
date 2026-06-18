const path = require("node:path");
const { createRequire } = require("node:module");

// Resolve JS deps from executor/, where npm packages are installed.
const requireFromExecutor = createRequire(
  path.join(__dirname, "../executor/package.json")
);
const { ethers } = requireFromExecutor("ethers");
requireFromExecutor("dotenv").config({
  path: path.join(__dirname, "../.env"),
});

const AGENT_REGISTRY_ABI = [
  "function register(address agentWallet, string name, string description, string[] capabilities, string agentURI) external returns (uint256 agentId)",
  "event AgentRegistered(uint256 indexed agentId, address operatorWallet, address agentWallet)",
];

const VAULT_ABI = [
  "function claimAllocation(uint256 agentId) external",
  "function getBalance(uint256 agentId) external view returns (uint256)",
  "function hasClaimed(uint256 agentId) external view returns (bool)",
];

async function setup() {
  const provider = new ethers.JsonRpcProvider(
    process.env.RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com"
  );

  const operatorKey = process.env.OPERATOR_PRIVATE_KEY || "";
  if (!operatorKey || operatorKey.includes("YOUR_OPERATOR_KEY")) {
    throw new Error("Set OPERATOR_PRIVATE_KEY in .env before running setup_agent.js");
  }

  const agentWalletAddress = process.env.AGENT_WALLET_ADDRESS || "";
  if (!ethers.isAddress(agentWalletAddress)) {
    throw new Error("Set AGENT_WALLET_ADDRESS in .env before running setup_agent.js");
  }

  const operatorWallet = new ethers.Wallet(operatorKey, provider);

  const registryAddress =
    process.env.AGENT_REGISTRY_ADDRESS ||
    "0x97b07dDc405B0c28B17559aFFE63BdB3632d0ca3";
  const vaultAddress =
    process.env.HACKATHON_VAULT_ADDRESS ||
    "0x0E7CD8ef9743FEcf94f9103033a044caBD45fC90";

  const registry = new ethers.Contract(registryAddress, AGENT_REGISTRY_ABI, operatorWallet);
  const vault = new ethers.Contract(vaultAddress, VAULT_ABI, operatorWallet);

  const balance = await provider.getBalance(operatorWallet.address);
  console.log("Operator wallet:", operatorWallet.address);
  console.log("Agent wallet:   ", agentWalletAddress);
  console.log("Balance:        ", ethers.formatEther(balance), "ETH\n");

  if (balance === 0n) {
    throw new Error(
      "Operator wallet has 0 Sepolia ETH. Fund OPERATOR_WALLET_ADDRESS via a Sepolia faucet and retry."
    );
  }

  const metadata = {
    name: "CorrArbAgent-v1",
    description:
      "Trustless correlation arbitrage agent. Trades statistical divergences using Binance and Twelve Data.",
    version: "1.0.0",
    strategy: "correlation-arbitrage",
    assets: ["BTC", "ETH", "SOL", "MATIC", "GOLD", "EUR"],
    zscoreThreshold: Number(process.env.ZSCORE_THRESHOLD || "2.0"),
    lookbackDays: Number(process.env.LOOKBACK_DAYS || "90"),
  };

  const agentURI =
    "data:application/json;base64," +
    Buffer.from(JSON.stringify(metadata)).toString("base64");

  console.log("Step 1: Registering agent on shared AgentRegistry...");
  const capabilities = [
    "correlation-arbitrage",
    "multi-asset",
    "eip712-signing",
    "validation-artifacts",
  ];

  // Preflight to surface explicit contract reverts before spending gas.
  await registry.register.staticCall(
    agentWalletAddress,
    metadata.name,
    metadata.description,
    capabilities,
    agentURI
  );

  const gasEstimate = await registry.register.estimateGas(
    agentWalletAddress,
    metadata.name,
    metadata.description,
    capabilities,
    agentURI
  );

  const registerTx = await registry.register(
    agentWalletAddress,
    metadata.name,
    metadata.description,
    capabilities,
    agentURI,
    { gasLimit: (gasEstimate * 130n) / 100n }
  );

  console.log("Register tx:", registerTx.hash);
  const registerReceipt = await registerTx.wait(2);

  const event = registerReceipt.logs
    .map((log) => {
      try {
        return registry.interface.parseLog(log);
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .find((e) => e.name === "AgentRegistered");

  let agentId = event?.args?.agentId?.toString();

  // Fallback for ABI/event shape differences: use ERC-721 Transfer mint event.
  if (!agentId) {
    const TRANSFER_TOPIC = ethers.id("Transfer(address,address,uint256)");
    const zeroTopic = "0x" + "00".repeat(32);
    const transferLog = registerReceipt.logs.find(
      (log) =>
        log.address.toLowerCase() === registryAddress.toLowerCase() &&
        log.topics?.[0] === TRANSFER_TOPIC &&
        log.topics?.[1] === zeroTopic &&
        log.topics?.length >= 4
    );

    if (transferLog) {
      agentId = BigInt(transferLog.topics[3]).toString();
    }
  }

  if (!agentId) {
    throw new Error("Could not parse AgentRegistered event for agentId");
  }

  console.log("Agent registered. agentId:", agentId);
  console.log("Etherscan:", `https://sepolia.etherscan.io/tx/${registerTx.hash}`);

  const claimVault = false;
  if (claimVault) {
    console.log("\nStep 2: Claiming optional 0.05 ETH allocation...");
    const alreadyClaimed = await vault.hasClaimed(agentId);
    if (alreadyClaimed) {
      console.log("Already claimed for this agentId.");
    } else {
      const claimTx = await vault.claimAllocation(agentId, { gasLimit: 120000 });
      await claimTx.wait(2);
      const vaultBalance = await vault.getBalance(agentId);
      console.log("Claimed.", ethers.formatEther(vaultBalance), "ETH in vault");
      console.log("Etherscan:", `https://sepolia.etherscan.io/tx/${claimTx.hash}`);
    }
  } else {
    console.log("\nStep 2: Skipping vault claim (optional for judging).\n");
  }

  console.log("========================================");
  console.log("Add this line to .env:");
  console.log(`AGENT_NFT_ID=${agentId}`);
  console.log("========================================");
}

(async () => {
  try {
    await setup();
  } catch (err) {
    console.error("setup_agent failed:", err.message);
    process.exit(1);
  }
})();
