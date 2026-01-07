// scripts/fetch_onchain.js
// Node >= 18 (fetch available). Ethers v6 JsonRpcProvider.
// Uses:
// - Ethereum: RPC for balances + Etherscan tokentx for USDT transfers
// - Base: RPC for balances + Alchemy alchemy_getAssetTransfers for EQTY transfers

import { ethers } from "ethers";
import fs from "fs/promises";
import path from "path";

const TREASURY = "0x2Bc456799F3Cf071B10CE7216269471e0A40381a";

// Assets (locked scope)
const USDT_ETH = "0xdAC17F958D2ee523a2206206994597C13D831ec7";
const EQTY_BASE = "0xc71f37d9bf4c5d1e7fe4bccb97e6f30b11b37d29";

const ERC20_ABI = [
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function balanceOf(address) view returns (uint256)",
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
    explorerAddressUrl: `${explorerBase}/address/${address}`,
  };
}

async function getErc20(provider, explorerBase, tokenAddress, ownerAddress) {
  const token = new ethers.Contract(tokenAddress, ERC20_ABI, provider);

  let symbol = "TOKEN";
  try {
    symbol = await token.symbol();
  } catch {}

  const decimals = Number(await token.decimals());
  const bal = await token.balanceOf(ownerAddress);

  return {
    symbol,
    contract: tokenAddress,
    decimals,
    balanceRaw: bal.toString(),
    balanceFormatted: ethers.formatUnits(bal, decimals),
    explorerTokenUrl: `${explorerBase}/token/${tokenAddress}`,
  };
}

// Etherscan v2 tokentx (works for Ethereum; Base may require paid plan)
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
    const tail =
      typeof json.result === "string" ? json.result.slice(0, 140) : JSON.stringify(json.result).slice(0, 140);
    throw new Error(`Etherscan error: ${json.message || "unknown"} (${tail || ""})`);
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
      explorerTxUrl: `${explorerBase}/tx/${r.hash}`,
    };
  });
}

// Alchemy Transfers API (via JSON-RPC) for Base EQTY transfers
async function alchemyGetAssetTransfers({
  rpcUrl,
  fromAddress,
  toAddress,
  contractAddresses,
  maxCount = "0x19", // 25
}) {
  const params0 = {
    fromBlock: "0x0",
    toBlock: "latest",
    category: ["erc20"],
    contractAddresses,
    maxCount,
    withMetadata: true,
    excludeZeroValue: true,
  };

  // Only include these keys if specified (Alchemy treats omitted vs null differently)
  if (fromAddress) params0.fromAddress = fromAddress;
  if (toAddress) params0.toAddress = toAddress;

  const body = {
    id: 1,
    jsonrpc: "2.0",
    method: "alchemy_getAssetTransfers",
    params: [params0],
  };

  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) throw new Error(`Alchemy transfers HTTP ${res.status}`);

  const json = await res.json();
  if (json?.error) throw new Error(`Alchemy error: ${json.error.message || "unknown"}`);

  return json?.result?.transfers || [];
}

function normalizeAlchemyTransfers(transfers, treasuryAddress, decimals, explorerBase) {
  const me = lower(treasuryAddress);

  // Dedup: same tx can appear in both "in" and "out" queries (or for self-transfers).
  // Use hash + uniqueId if present; else hash + logIndex-ish fields if present; else hash.
  const seen = new Set();
  const out = [];

  for (const t of transfers) {
    const key =
      t.uniqueId ? `${t.hash}:${t.uniqueId}` : t.hash ? `${t.hash}:${t.asset || ""}:${t.from}:${t.to}:${t.value}` : "";

    if (!key || seen.has(key)) continue;
    seen.add(key);

    const from = t.from;
    const to = t.to;

    let direction = "other";
    if (lower(from) === me && lower(to) === me) direction = "self";
    else if (lower(to) === me) direction = "in";
    else if (lower(from) === me) direction = "out";

    // rawContract.value is typically hex (0x...) for ERC20 transfers
    const rawHex = t.rawContract?.value;
    let amountRaw = "0";
    if (typeof rawHex === "string" && rawHex.startsWith("0x")) {
      amountRaw = BigInt(rawHex).toString();
    } else if (typeof rawHex === "string" && rawHex.length > 0) {
      // sometimes already decimal string
      amountRaw = rawHex;
    }

    const timestamp = t.metadata?.blockTimestamp || new Date().toISOString();

    out.push({
      hash: t.hash,
      timestamp,
      from,
      to,
      direction,
      amountRaw,
      amountFormatted: ethers.formatUnits(amountRaw, decimals),
      explorerTxUrl: `${explorerBase}/tx/${t.hash}`,
    });
  }

  // Sort desc by timestamp string (ISO); then trim
  out.sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)));
  return out;
}

async function main() {
  const { ETH_RPC_URL, BASE_RPC_URL, ETHERSCAN_API_KEY } = process.env;

  if (!ETH_RPC_URL) throw new Error("Missing ETH_RPC_URL");
  if (!BASE_RPC_URL) throw new Error("Missing BASE_RPC_URL");
  if (!ETHERSCAN_API_KEY) throw new Error("Missing ETHERSCAN_API_KEY");

  const ethProvider = new ethers.JsonRpcProvider(ETH_RPC_URL);
  const baseProvider = new ethers.JsonRpcProvider(BASE_RPC_URL);

  const generatedAt = new Date().toISOString();

  // --- Ethereum snapshot ---
  const ethExplorer = "https://etherscan.io";
  const ethNative = await getNative(ethProvider, ethExplorer, TREASURY);

  const usdt = await getErc20(ethProvider, ethExplorer, USDT_ETH, TREASURY);

  const usdtRows = await fetchTokentx({
    chainId: 1,
    address: TREASURY,
    contract: USDT_ETH,
    apiKey: ETHERSCAN_API_KEY,
    offset: 25,
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
    sources: { rpc: "ETH_RPC_URL", explorer: ethExplorer },
  };

  // --- Base snapshot ---
  const baseExplorer = "https://basescan.org";
  const baseNative = await getNative(baseProvider, baseExplorer, TREASURY);

  const eqty = await getErc20(baseProvider, baseExplorer, EQTY_BASE, TREASURY);

  // Base EQTY transfers via Alchemy (in + out), then merged/deduped/sorted
  const [eqtyOut, eqtyIn] = await Promise.all([
    alchemyGetAssetTransfers({
      rpcUrl: BASE_RPC_URL,
      fromAddress: TREASURY,
      contractAddresses: [EQTY_BASE],
      maxCount: "0x19",
    }),
    alchemyGetAssetTransfers({
      rpcUrl: BASE_RPC_URL,
      toAddress: TREASURY,
      contractAddresses: [EQTY_BASE],
      maxCount: "0x19",
    }),
  ]);

  const eqtyTransfers = normalizeAlchemyTransfers([...eqtyOut, ...eqtyIn], TREASURY, eqty.decimals, baseExplorer).slice(
    0,
    25
  );

  const baseSnapshot = {
    chain: "base",
    chainId: 8453,
    treasuryAddress: TREASURY,
    generatedAt,
    native: baseNative,
    tokens: { EQTY: { ...eqty, symbol: "EQTY" } },
    recentTransfers: { EQTY: eqtyTransfers },
    sources: { rpc: "BASE_RPC_URL", explorer: baseExplorer },
  };

  await writeJson("data/eth/treasury.json", ethSnapshot);
  await writeJson("data/base/treasury.json", baseSnapshot);

  await writeJson("data/meta.json", {
    generatedAt,
    address: TREASURY,
    assets: {
      ethereum: ["ETH", "USDT"],
      base: ["ETH", "EQTY"],
    },
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

