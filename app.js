// app.js (repo root)

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") node.className = v;
    else if (k === "html") node.innerHTML = v;
    else node.setAttribute(k, v);
  }
  for (const c of children) node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
  return node;
}

function fmtNumberString(s) {
  const n = Number(s);
  if (!Number.isFinite(n)) return s;
  return n.toLocaleString(undefined, { maximumFractionDigits: 8 });
}

function link(href, text) {
  return el("a", { href, target: "_blank", rel: "noopener noreferrer" }, [text]);
}

async function getJson(relPath) {
  const res = await fetch(relPath);
  if (!res.ok) throw new Error(`Fetch failed ${res.status} for ${relPath}`);
  return res.json();
}

function renderBalances({ eth, base }) {
  const table = el("table");
  table.appendChild(el("thead", {}, [
    el("tr", {}, [
      el("th", {}, ["Chain"]),
      el("th", {}, ["Asset"]),
      el("th", {}, ["Balance"]),
      el("th", {}, ["Source"])
    ])
  ]));

  const tbody = el("tbody");

  tbody.appendChild(el("tr", {}, [
    el("td", {}, [el("span", { class: "pill" }, ["Ethereum"])]),
    el("td", {}, ["ETH"]),
    el("td", {}, [fmtNumberString(eth.native.balanceFormatted)]),
    el("td", {}, [link(eth.native.explorerAddressUrl, "Etherscan")])
  ]));

  tbody.appendChild(el("tr", {}, [
    el("td", {}, [el("span", { class: "pill" }, ["Ethereum"])]),
    el("td", {}, ["USDT"]),
    el("td", {}, [fmtNumberString(eth.tokens.USDT.balanceFormatted)]),
    el("td", {}, [link(eth.tokens.USDT.explorerTokenUrl, "USDT contract")])
  ]));

  tbody.appendChild(el("tr", {}, [
    el("td", {}, [el("span", { class: "pill" }, ["Base"])]),
    el("td", {}, ["ETH"]),
    el("td", {}, [fmtNumberString(base.native.balanceFormatted)]),
    el("td", {}, [link(base.native.explorerAddressUrl, "BaseScan")])
  ]));

  tbody.appendChild(el("tr", {}, [
    el("td", {}, [el("span", { class: "pill" }, ["Base"])]),
    el("td", {}, ["EQTY"]),
    el("td", {}, [fmtNumberString(base.tokens.EQTY.balanceFormatted)]),
    el("td", {}, [link(base.tokens.EQTY.explorerTokenUrl, "EQTY contract")])
  ]));

  table.appendChild(tbody);
  return table;
}

function renderTransfers(transfers, emptyLabel) {
  if (!transfers || transfers.length === 0) return el("div", { class: "muted" }, [emptyLabel]);

  const ul = el("ul");
  for (const t of transfers.slice(0, 15)) {
    const dir = t.direction === "in" ? "IN" : t.direction === "out" ? "OUT" : t.direction.toUpperCase();
    const line = `${dir} ${fmtNumberString(t.amountFormatted)} — ${new Date(t.timestamp).toLocaleString()}`;

    const li = el("li");
    li.appendChild(link(t.explorerTxUrl, t.hash.slice(0, 10) + "…" + t.hash.slice(-8)));
    li.appendChild(document.createTextNode(" — " + line));
    ul.appendChild(li);
  }
  return ul;
}

async function main() {
  const status = document.getElementById("status");
  status.textContent = "Loading…";

  try {
    // Root publishing => JSON paths are ./data/...
    const [meta, eth, base] = await Promise.all([
      getJson("./data/meta.json"),
      getJson("./data/eth/treasury.json"),
      getJson("./data/base/treasury.json")
    ]);

    document.getElementById("treasuryAddr").textContent =
      meta.address || eth.treasuryAddress || base.treasuryAddress;

    const lastUpdated = meta.generatedAt || eth.generatedAt || base.generatedAt;
    document.getElementById("lastUpdated").textContent =
      lastUpdated ? `Last updated: ${new Date(lastUpdated).toLocaleString()}` : "";

    const balancesTarget = document.getElementById("balances");
    balancesTarget.innerHTML = "";
    balancesTarget.appendChild(renderBalances({ eth, base }));

    const usdtTarget = document.getElementById("usdtTransfers");
    usdtTarget.innerHTML = "";
    usdtTarget.appendChild(renderTransfers(eth?.recentTransfers?.USDT || [], "No USDT transfers found."));

    const eqtyTarget = document.getElementById("eqtyTransfers");
    eqtyTarget.innerHTML = "";
    eqtyTarget.appendChild(renderTransfers(base?.recentTransfers?.EQTY || [], "No EQTY transfers found."));

    status.textContent = "";
  } catch (e) {
    status.className = "muted error";
    status.textContent = `Error: ${e.message}`;
  }
}

main();
