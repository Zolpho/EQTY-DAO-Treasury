// app.js (repo root)

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);

  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === "class") node.className = v;
    else if (k === "html") node.innerHTML = v;
    else node.setAttribute(k, v);
  }

  for (const c of children || []) {
    node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
  }

  return node;
}

function fmtNumberString(s) {
  const n = Number(s);
  if (!Number.isFinite(n)) return String(s);
  return n.toLocaleString(undefined, { maximumFractionDigits: 8 });
}

function link(href, text) {
  return el("a", { href, target: "_blank", rel: "noopener noreferrer" }, [text]);
}

async function getJson(relPath) {
  // Relative paths keep this working on GitHub Pages project sites too.
  const res = await fetch(relPath);
  if (!res.ok) throw new Error(`Fetch failed ${res.status} for ${relPath}`);
  return res.json();
}

function renderBalances({ eth, base }) {
  const table = el("table");

  table.appendChild(
    el("thead", {}, [
      el("tr", {}, [
        el("th", {}, ["Chain"]),
        el("th", {}, ["Asset"]),
        el("th", {}, ["Balance"]),
        el("th", {}, ["Source"]),
      ]),
    ])
  );

  const tbody = el("tbody");

  tbody.appendChild(
    el("tr", {}, [
      el("td", {}, [el("span", { class: "pill" }, ["Ethereum"])]),
      el("td", {}, ["ETH"]),
      el("td", {}, [fmtNumberString(eth.native.balanceFormatted)]),
      el("td", {}, [link(eth.native.explorerAddressUrl, "Etherscan")]),
    ])
  );

  tbody.appendChild(
    el("tr", {}, [
      el("td", {}, [el("span", { class: "pill" }, ["Ethereum"])]),
      el("td", {}, ["USDT"]),
      el("td", {}, [fmtNumberString(eth.tokens.USDT.balanceFormatted)]),
      el("td", {}, [link(eth.tokens.USDT.explorerTokenUrl, "USDT contract")]),
    ])
  );

  tbody.appendChild(
    el("tr", {}, [
      el("td", {}, [el("span", { class: "pill" }, ["Base"])]),
      el("td", {}, ["ETH"]),
      el("td", {}, [fmtNumberString(base.native.balanceFormatted)]),
      el("td", {}, [link(base.native.explorerAddressUrl, "BaseScan")]),
    ])
  );

  tbody.appendChild(
    el("tr", {}, [
      el("td", {}, [el("span", { class: "pill" }, ["Base"])]),
      el("td", {}, ["EQTY"]),
      el("td", {}, [fmtNumberString(base.tokens.EQTY.balanceFormatted)]),
      el("td", {}, [link(base.tokens.EQTY.explorerTokenUrl, "EQTY contract")]),
    ])
  );

  table.appendChild(tbody);
  return table;
}

function renderTransfers(transfers, emptyLabel) {
  if (!transfers || transfers.length === 0) return el("div", { class: "muted" }, [emptyLabel]);

  const ul = el("ul", { class: "tx-list" });

  for (const t of transfers.slice(0, 15)) {
    const dir =
      t.direction === "in" ? "IN" :
      t.direction === "out" ? "OUT" :
      String(t.direction || "").toUpperCase();

    ul.appendChild(
      el("li", { class: "tx-item" }, [
        el("div", { class: "tx-row" }, [
          link(t.explorerTxUrl, t.hash.slice(0, 6) + "…" + t.hash.slice(-4)),
          el("span", { class: "tx-dir" }, [dir]),
          el("span", { class: "tx-sep" }, ["|"]),
          el("span", { class: "tx-amt" }, [fmtNumberString(t.amountFormatted)]),
          el("span", { class: "tx-time" }, [new Date(t.timestamp).toLocaleString()]),
        ]),
      ])
    );
  }

  return ul;
}

function renderMoneybirdMonthlyTable(months) {
  if (!months || months.length === 0) return el("div", { class: "muted" }, ["No monthly data."]);

  const container = el("div", { class: "monthly-container" });

  for (const m of months) {
    container.appendChild(
      el("div", { class: "monthly-card" }, [
        el("div", { class: "monthly-header" }, [m.month]),
        el("div", { class: "monthly-row" }, [
          el("span", { class: "monthly-label" }, ["Opening:"]),
          el("span", { class: "monthly-value" }, [fmtNumberString(m.openingBalance)]),
        ]),
        el("div", { class: "monthly-row" }, [
          el("span", { class: "monthly-label" }, ["Closing:"]),
          el("span", { class: "monthly-value" }, [fmtNumberString(m.closingBalance)]),
        ]),
        el("div", { class: "monthly-row" }, [
          el("span", { class: "monthly-label" }, ["Received:"]),
          el("span", { class: "monthly-value" }, [fmtNumberString(m.cashReceivedTotal)]),
        ]),
        el("div", { class: "monthly-row" }, [
          el("span", { class: "monthly-label" }, ["Paid:"]),
          el("span", { class: "monthly-value" }, [fmtNumberString(m.cashPaidTotal)]),
        ]),
        el("div", { class: "monthly-row" }, [
          el("span", { class: "monthly-label" }, ["Net:"]),
          el("span", { class: "monthly-value" }, [fmtNumberString(m.netCashFlow)]),
        ]),
        el("div", { class: "monthly-row" }, [
          el("span", { class: "monthly-label" }, ["Transactions:"]),
          el("span", { class: "monthly-value" }, [String(m.mutationCount ?? "")]),
        ]),
      ])
    );
  }

  return container;
}

function renderMoneybirdAccountCard({ account, monthly }) {
  const wrap = el("div");

  const name = account?.financialAccount?.name || "(unnamed)";
  const type = account?.financialAccount?.type || "Account";
  const currency = account?.financialAccount?.currency || "";
  const current = account?.current;

  const currentLine = current
    ? `Current (from ${current.month}): ${fmtNumberString(current.closingBalance)} ${currency}`
    : "Current balance unavailable.";

  wrap.appendChild(el("div", { class: "muted" }, [`${type}: ${name} (${currency})`]));
  wrap.appendChild(el("div", {}, [currentLine]));

  const months = monthly?.months || [];
  const monthlyTable = renderMoneybirdMonthlyTable(months);
  monthlyTable.style.marginTop = "14px";
  wrap.appendChild(monthlyTable);

  return wrap;
}

/* ---------- Moneybird: spent by category ---------- */

function buildLedgerMap(ledgerAccounts) {
  const byId = new Map();
  for (const a of ledgerAccounts || []) {
    byId.set(String(a.id), {
      id: String(a.id),
      name: a.name || null,
      parentId: a.parentId || null,
    });
  }
  return byId;
}

function topGroupId(byId, id) {
  let cur = String(id);
  const seen = new Set();

  while (true) {
    const a = byId.get(cur);
    if (!a || !a.parentId) return cur;

    if (seen.has(cur)) return cur; // safety against cycles
    seen.add(cur);

    cur = String(a.parentId);
  }
}

function aggregateSpentByGroup(paidMap, byId) {
  const totals = new Map(); // groupId -> number

  for (const [ledgerId, amountStr] of Object.entries(paidMap || {})) {
    const groupId = topGroupId(byId, ledgerId);
    const n = Number(amountStr || 0);
    const spent = Math.abs(n); // display as positive “spent”
    totals.set(groupId, (totals.get(groupId) || 0) + spent);
  }

  return totals;
}

function renderSpendCard({ title, totals, byId, currency }) {
  const rows = [...totals.entries()]
    .map(([groupId, total]) => ({
      groupId,
      name: byId.get(groupId)?.name || `Ledger ${groupId}`,
      total,
    }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 12);

  const grandTotal = [...totals.values()].reduce((acc, x) => acc + x, 0);

  const card = el("div", { class: "monthly-card" }, [
    el("div", { class: "monthly-header" }, [title]),
  ]);

  if (rows.length === 0) {
    card.appendChild(el("div", { class: "muted" }, ["No category data."]));
    return card;
  }

  for (const r of rows) {
    card.appendChild(
      el("div", { class: "monthly-row" }, [
        el("span", { class: "monthly-label" }, [r.name]),
        el("span", { class: "monthly-value" }, [`${fmtNumberString(String(r.total))} ${currency || ""}`]),
      ])
    );
  }

  card.appendChild(
    el("div", { class: "monthly-row" }, [
      el("span", { class: "monthly-label" }, ["Total:"]),
      el("span", { class: "monthly-value" }, [`${fmtNumberString(String(grandTotal))} ${currency || ""}`]),
    ])
  );

  return card;
}

function renderSpendByCategory({ bankMonthly, ledgerAccounts, currency }) {
  const months = bankMonthly?.months || [];
  if (months.length === 0) return el("div", { class: "muted" }, ["No monthly data."]);

  const byId = buildLedgerMap(ledgerAccounts || []);

  const latest = months[months.length - 1];
  const latestTotals = aggregateSpentByGroup(latest?.cashPaidByLedgerAccount || {}, byId);

  const ytdTotals = new Map();
  for (const m of months) {
    const t = aggregateSpentByGroup(m?.cashPaidByLedgerAccount || {}, byId);
    for (const [groupId, val] of t.entries()) {
      ytdTotals.set(groupId, (ytdTotals.get(groupId) || 0) + val);
    }
  }

  // Header lines (like renderMoneybirdAccountCard)
  const wrap = el("div");
  wrap.appendChild(el("div", { class: "muted" }, [`Categories (${currency || ""})`]));
  wrap.appendChild(el("div", {}, [`Latest month: ${latest.month}`]));

  // Cards (like monthly table/cards layout)
  const container = el("div", { class: "monthly-container" });
  container.style.marginTop = "14px"; // match bank card spacing

  container.appendChild(
    renderSpendCard({
      title: `Latest month (${latest.month})`,
      totals: latestTotals,
      byId,
      currency,
    })
  );

  container.appendChild(
    renderSpendCard({
      title: "Year-to-date",
      totals: ytdTotals,
      byId,
      currency,
    })
  );

  wrap.appendChild(container);
  return wrap;
}

/* ---------- main ---------- */

async function main() {
  const status = document.getElementById("status");
  if (status) status.textContent = "Loading…";

  try {
    const [meta, eth, base] = await Promise.all([
      getJson("./data/meta.json"),
      getJson("./data/eth/treasury.json"),
      getJson("./data/base/treasury.json"),
    ]);

    const addrEl = document.getElementById("treasuryAddr");
    if (addrEl) addrEl.textContent = meta.address || eth.treasuryAddress || base.treasuryAddress || "—";

    const lastUpdated = meta.generatedAt || eth.generatedAt || base.generatedAt;
    const updatedEl = document.getElementById("lastUpdated");
    if (updatedEl) {
      updatedEl.textContent = lastUpdated ? `Last updated: ${new Date(lastUpdated).toLocaleString()}` : "";
    }

    const balancesTarget = document.getElementById("balances");
    if (balancesTarget) {
      balancesTarget.innerHTML = "";
      balancesTarget.appendChild(renderBalances({ eth, base }));
    }

    const usdtTarget = document.getElementById("usdtTransfers");
    if (usdtTarget) {
      usdtTarget.innerHTML = "";
      usdtTarget.appendChild(renderTransfers(eth?.recentTransfers?.USDT || [], "No USDT transfers found."));
    }

    const eqtyTarget = document.getElementById("eqtyTransfers");
    if (eqtyTarget) {
      eqtyTarget.innerHTML = "";
      eqtyTarget.appendChild(renderTransfers(base?.recentTransfers?.EQTY || [], "No EQTY transfers found."));
    }

    // Moneybird (optional)
    const mbMetaTarget = document.getElementById("moneybirdMeta");
    const mbBankTarget = document.getElementById("mbBank");
    const mbSpendTarget = document.getElementById("mbSpendByCategory");

    if (mbBankTarget) mbBankTarget.innerHTML = "";
    if (mbSpendTarget) mbSpendTarget.innerHTML = "";

    if (mbMetaTarget && mbBankTarget) {
      try {
        const mbMeta = await getJson("./data/moneybird/meta.json");
        const year = mbMeta.year || String(new Date().getFullYear());

        mbMetaTarget.textContent = mbMeta.generatedAt
          ? `Moneybird updated: ${new Date(mbMeta.generatedAt).toLocaleString()} (year ${year})`
          : `Moneybird year ${year}`;

        const [bankAccount, bankMonthly] = await Promise.all([
          getJson("./data/moneybird/bank/account.json"),
          getJson(`./data/moneybird/bank/monthly-${year}.json`),
        ]);

        mbBankTarget.appendChild(renderMoneybirdAccountCard({ account: bankAccount, monthly: bankMonthly }));

        if (mbSpendTarget) {
          try {
            const ledgerMeta = await getJson("./data/moneybird/ledger_accounts.json");
            const currency = bankAccount?.financialAccount?.currency || "";

            mbSpendTarget.appendChild(
              renderSpendByCategory({
                bankMonthly,
                ledgerAccounts: ledgerMeta?.ledgerAccounts || [],
                currency,
              })
            );
          } catch (e) {
            mbSpendTarget.appendChild(el("div", { class: "muted" }, [`Spend-by-category error: ${e.message}`]));
          }
        }
      } catch (e) {
        mbMetaTarget.textContent = "Moneybird data not available yet.";
        mbMetaTarget.className = "muted";
        mbBankTarget.appendChild(el("div", { class: "muted" }, [`Moneybird load error: ${e.message}`]));
        if (mbSpendTarget) mbSpendTarget.appendChild(el("div", { class: "muted" }, ["—"]));
      }
    }

    if (status) {
      status.textContent = "";
      status.className = "muted";
    }
  } catch (e) {
    if (status) {
      status.className = "muted error";
      status.textContent = `Error: ${e.message}`;
    }
  }
}

main();

