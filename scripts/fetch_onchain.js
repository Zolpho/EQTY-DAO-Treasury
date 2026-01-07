// scripts/fetch_onchain.js
// Node >= 18 (fetch available). Tested pattern: ethers v6 JsonRpcProvider.

import "dotenv/config";
import { ethers } from "ethers";
import fs from "fs/promises";
import path from "path";

const TREASURY = "0x2Bc456799F3Cf071B10CE7216269471e0A40381a";

const USDT_ETH = "0xdAC17F958D2ee523a2206206994597C13D831ec7";
const EQTY_BASE = "0xc71f37d9bf4c5d1e7fe4bccb97e6f30b11b37d29";

const ERC20_ABI = [
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function balanceOf(address) view returns (uint256)"
];

function isoFromUnixSeconds(sec) {
  return new Date(Number(sec) * 1000).toISOString();
}

function lower(addr) {
  return String(addr || "").toLowerCase();
}

async function ensureDir(p) {
  await fs.mkdir(p, { recursive: true });
}

async function writeJson(filePath, obj) {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, JSON.stringify(obj, null, 2) + "\n", "utf8");
}

async function getNative(provider, explorerBase, address) {
  const wei = await provider.getBalance(address);
  return {
    symbol: "ETH",
    decimals: 18,
    balanceWei: wei.toString(),
    balanceFormatted: ethers.formatEther(wei),
    explorerAddressUrl: `${explorerBase}/address/${address}`
  };
}

async function getErc20(provider, explorerBase, tokenAddress, ownerAddress) {
  const token = new ethers.Contract(tokenAddress, ERC20_ABI, provider);

  // Some tokens can throw on symbol(); keep fallback.
  let symbol = "TOKEN";
  try { symbol = await token.symbol(); } catch {}

  const decimals = Number(await token.decimals());
  const bal = await token.balanceOf(ownerAddress);

  return {
    symbol,
    contract: tokenAddress,
    decimals,
    balanceRaw: bal.toString(),
    balanceFormatted: ethers.formatUnits(bal, decimals),
    explorerTokenUrl: `${explorerBase}/token/${tokenAddress}`
  };
}

async function fetchTokentx({ chainId, address, contract, apiKey, offset = 25, page = 1 }) {
  const url =
    "https://api.etherscan.io/v2/api" +
    `?chainid=${encodeURIComponent(chainId)}` +
    `&module=account` +
    `&action=tokentx` +
    `&address=${encodeURIComponent(address)}` +
    `&contractaddress=${encodeURIComponent(contract)}` +
    `&page=${encodeURIComponent(page)}` +
    `&offset=${encodeURIComponent(offset)}` +
    `&sort=desc` +
    `&apikey=${encodeURIComponent(apiKey)}`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Etherscan tokentx HTTP ${res.status}`);
  const json = await res.json();
  if (json.status !== "1" && json.message !== "No transactions found") {
    throw new Error(`Etherscan error: ${json.message || "unknown"} (${json.result?.slice?.(0, 120) || ""})`);
  }
  return Array.isArray(json.result) ? json.result : [];
}

function normalizeTokentxRows(rows, treasuryAddress, decimals, explorerBase) {
  const me = lower(treasuryAddress);

  return rows.map((r) => {
    const from = r.from;
    const to = r.to;

    let direction = "other";
    if (lower(from) === me && lower(to) === me) direction = "self";
    else if (lower(to) === me) direction = "in";
    else if (lower(from) === me) direction = "out";

    const amountRaw = String(r.value || "0");
    const amountFormatted = ethers.formatUnits(amountRaw, decimals);

    return {
      hash: r.hash,
      timestamp: isoFromUnixSeconds(r.timeStamp),
      from,
      to,
      direction,
      amountRaw,
      amountFormatted,
      explorerTxUrl: `${explorerBase}/tx/${r.hash}`
    };
  });
}

async function main() {
  const {
    ETH_RPC_URL,
    BASE_RPC_URL,
    ETHERSCAN_API_KEY
  } = process.env;

  if (!ETH_RPC_URL) throw new Error("Missing ETH_RPC_URL");
  if (!BASE_RPC_URL) throw new Error("Missing BASE_RPC_URL");
  if (!ETHERSCAN_API_KEY) throw new Error("Missing ETHERSCAN_API_KEY");

  const ethProvider = new ethers.JsonRpcProvider(ETH_RPC_URL);
  const baseProvider = new ethers.JsonRpcProvider(BASE_RPC_URL);

  const generatedAt = new Date().toISOString();

  // --- Ethereum snapshot ---
  const ethExplorer = "https://etherscan.io";
  const ethNative = await getNative(ethProvider, ethExplorer, TREASURY);

  // Force symbol to "USDT" in UI by key name; on-chain symbol may be "USDT"
  const usdt = await getErc20(ethProvider, ethExplorer, USDT_ETH, TREASURY);

  // Recent USDT transfers via Etherscan tokentx
  const usdtRows = await fetchTokentx({
    chainId: 1,
    address: TREASURY,
    contract: USDT_ETH,
    apiKey: ETHERSCAN_API_KEY,
    offset: 25
  });
  const usdtTransfers = normalizeTokentxRows(usdtRows, TREASURY, usdt.decimals, ethExplorer);

  const ethSnapshot = {
    chain: "ethereum",
    chainId: 1,
    treasuryAddress: TREASURY,
    generatedAt,
    native: ethNative,
    tokens: { USDT: { ...usdt, symbol: "USDT" } },
    recentTransfers: { USDT: usdtTransfers },
    sources: { rpc: "ETH_RPC_URL", explorer: ethExplorer }
  };

  // --- Base snapshot ---
  const baseExplorer = "https://basescan.org";
  const baseNative = await getNative(baseProvider, baseExplorer, TREASURY);

  const eqty = await getErc20(baseProvider, baseExplorer, EQTY_BASE, TREASURY);

  const eqtyRows = await fetchTokentx({
    chainId: 8453,
    address: TREASURY,
    contract: EQTY_BASE,
    apiKey: ETHERSCAN_API_KEY,
    offset: 25
  });
  const eqtyTransfers = normalizeTokentxRows(eqtyRows, TREASURY, eqty.decimals, baseExplorer);

  const baseSnapshot = {
    chain: "base",
    chainId: 8453,
    treasuryAddress: TREASURY,
    generatedAt,
    native: baseNative,
    tokens: { EQTY: { ...eqty, symbol: "EQTY" } },
    recentTransfers: { EQTY: eqtyTransfers },
    sources: { rpc: "BASE_RPC_URL", explorer: baseExplorer }
  };

  await writeJson("data/eth/treasury.json", ethSnapshot);
  await writeJson("data/base/treasury.json", baseSnapshot);

  // Optional: a single meta file your frontend can read for timestamps
  await writeJson("data/meta.json", {
    generatedAt,
    address: TREASURY,
    assets: {
      ethereum: ["ETH", "USDT"],
      base: ["ETH", "EQTY"]
    }
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
