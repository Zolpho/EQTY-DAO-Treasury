// scripts/fetch_moneybird.js
// Publishes aggregated monthly JSON (no sensitive personal data).
// - Financial accounts: GET /financial_accounts.json
// - Cash flow report:   GET /reports/cash_flow.json (opening/closing balance + received/paid)
// - Mutation counts:    GET /financial_mutations/synchronization.json?filter=...

import fs from "fs/promises";
import path from "path";

async function ensureDir(p) {
  await fs.mkdir(p, { recursive: true });
}

async function writeJson(filePath, obj) {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, JSON.stringify(obj, null, 2) + "\n", "utf8");
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

function monthKey(year, month) {
  return `${year}-${pad2(month)}`; // YYYY-MM
}

function daysInMonth(year, month) {
  // month: 1..12
  return new Date(year, month, 0).getDate();
}

function monthPeriodYYYYMMDD(year, month) {
  const y = String(year);
  const m = pad2(month);
  const dLast = pad2(daysInMonth(year, month));
  return `${y}${m}01..${y}${m}${dLast}`;
}

function sumLedgerMap(obj) {
  // cash_flow returns objects like { "<ledger_account_id>": "100.0", ... }
  if (!obj || typeof obj !== "object") return 0;
  return Object.values(obj).reduce((acc, v) => acc + Number(v || 0), 0);
}

async function moneybirdRequest({ token, method, url, body }) {
  const res = await fetch(url, {
    method,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Moneybird ${method} ${url} -> ${res.status} ${text.slice(0, 400)}`);
  }
  return res.json();
}

async function getFinancialAccounts({ token, administrationId }) {
  const url = `https://moneybird.com/api/v2/${administrationId}/financial_accounts.json`;
  return moneybirdRequest({ token, method: "GET", url });
}

async function getCashFlowMonth({ token, administrationId, financialAccountId, period }) {
  const url =
    `https://moneybird.com/api/v2/${administrationId}/reports/cash_flow.json` +
    `?period=${encodeURIComponent(period)}` +
    `&financial_account_id=${encodeURIComponent(financialAccountId)}`;

  return moneybirdRequest({ token, method: "GET", url });
}

async function getMutationCountMonth({ token, administrationId, financialAccountId, period }) {
  const filter = `period:${period},state:all,financial_account_id:${financialAccountId}`;
  const url =
    `https://moneybird.com/api/v2/${administrationId}/financial_mutations/synchronization.json` +
    `?filter=${encodeURIComponent(filter)}`;

  const idVersions = await moneybirdRequest({ token, method: "GET", url });
  return Array.isArray(idVersions) ? idVersions.length : 0;
}

function publicAccountMeta(a) {
  // Don't publish identifiers/IBANs; keep only safe metadata.
  return {
    id: String(a.id),
    type: a.type,
    name: a.name || null,
    currency: a.currency,
    provider: a.provider ?? null,
    active: Boolean(a.active),
    updated_at: a.updated_at,
  };
}

async function exportAccountMonthly({ token, administrationId, accounts, accountId, outDir, year }) {
  const account = accounts.find((a) => String(a.id) === String(accountId));
  if (!account) throw new Error(`Financial account not found: ${accountId}`);

  const now = new Date();
  const currentYear = now.getFullYear();
  const maxMonth = year === currentYear ? now.getMonth() + 1 : 12;

  const months = [];
  for (let m = 1; m <= maxMonth; m++) {
    const period = monthPeriodYYYYMMDD(year, m);

    const [cashFlow, mutationCount] = await Promise.all([
      getCashFlowMonth({ token, administrationId, financialAccountId: accountId, period }),
      getMutationCountMonth({ token, administrationId, financialAccountId: accountId, period }),
    ]);

    const openingBalanceNum = Number(cashFlow.opening_balance ?? "0");
    const closingBalanceNum = Number(cashFlow.closing_balance ?? "0");

    const receivedTotal = sumLedgerMap(cashFlow.cash_received_by_ledger_account);
    const paidTotal = sumLedgerMap(cashFlow.cash_paid_by_ledger_account);

    // Robust net: derive from balances (doesn't care about sign conventions in the report maps).
    const netCashFlow = closingBalanceNum - openingBalanceNum;

    months.push({
      month: monthKey(year, m),
      period,
      mutationCount,

      openingBalance: String(openingBalanceNum),
      closingBalance: String(closingBalanceNum),

      cashReceivedTotal: String(receivedTotal),
      cashPaidTotal: String(paidTotal),

      netCashFlow: String(netCashFlow),

      // Optional breakdowns by ledger_account_id (still aggregated, no contacts).
      cashReceivedByLedgerAccount: cashFlow.cash_received_by_ledger_account || {},
      cashPaidByLedgerAccount: cashFlow.cash_paid_by_ledger_account || {},
    });
  }

  const latest = months[months.length - 1] || null;

  const totalsYtd = months.reduce(
    (acc, x) => {
      acc.mutationCount += Number(x.mutationCount || 0);
      acc.cashReceivedTotal += Number(x.cashReceivedTotal || 0);
      acc.cashPaidTotal += Number(x.cashPaidTotal || 0);
      acc.netCashFlow += Number(x.netCashFlow || 0);
      return acc;
    },
    { mutationCount: 0, cashReceivedTotal: 0, cashPaidTotal: 0, netCashFlow: 0 }
  );

  await writeJson(`${outDir}/account.json`, {
    generatedAt: new Date().toISOString(),
    administrationId: String(administrationId),
    year: String(year),
    financialAccount: publicAccountMeta(account),
    current: latest
      ? {
          month: latest.month,
          openingBalance: latest.openingBalance,
          closingBalance: latest.closingBalance,
        }
      : null,
    totalsYtd: {
      mutationCount: totalsYtd.mutationCount,
      cashReceivedTotal: String(totalsYtd.cashReceivedTotal),
      cashPaidTotal: String(totalsYtd.cashPaidTotal),
      netCashFlow: String(totalsYtd.netCashFlow),
    },
  });

  await writeJson(`${outDir}/monthly-${year}.json`, {
    generatedAt: new Date().toISOString(),
    year: String(year),
    financialAccountId: String(accountId),
    months,
  });
}

async function main() {
  const {
    MONEYBIRD_API_TOKEN,
    MONEYBIRD_ADMINISTRATION_ID,
    MONEYBIRD_FINANCIAL_ACCOUNT_ID,
  } = process.env;

  if (!MONEYBIRD_API_TOKEN) throw new Error("Missing MONEYBIRD_API_TOKEN");
  if (!MONEYBIRD_ADMINISTRATION_ID) throw new Error("Missing MONEYBIRD_ADMINISTRATION_ID");
  if (!MONEYBIRD_FINANCIAL_ACCOUNT_ID) throw new Error("Missing MONEYBIRD_FINANCIAL_ACCOUNT_ID");

  const year = new Date().getFullYear();

  const accounts = await getFinancialAccounts({
    token: MONEYBIRD_API_TOKEN,
    administrationId: MONEYBIRD_ADMINISTRATION_ID,
  });

  await exportAccountMonthly({
    token: MONEYBIRD_API_TOKEN,
    administrationId: MONEYBIRD_ADMINISTRATION_ID,
    accounts,
    accountId: MONEYBIRD_FINANCIAL_ACCOUNT_ID,
    outDir: "data/moneybird/bank",
    year,
  });

  await writeJson("data/moneybird/meta.json", {
    generatedAt: new Date().toISOString(),
    administrationId: String(MONEYBIRD_ADMINISTRATION_ID),
    year: String(year),
    accounts: {
      bank: String(MONEYBIRD_FINANCIAL_ACCOUNT_ID),
    },
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

