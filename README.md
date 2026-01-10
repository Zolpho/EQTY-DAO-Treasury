# EQTY DAO Treasury (static page)

A static, zero-backend treasury dashboard for EQTY DAO that renders **pre-generated JSON snapshots** (on-chain + optional Moneybird) and can be published via GitHub Pages. 

The page reads JSON via relative paths (`./data/...`) so it works both on GitHub Pages project sites and when served locally.

## What it shows

### On-chain (always)
- Ethereum (chainId 1): ETH balance + USDT (ERC-20) balance and recent USDT transfers. 
- Base (chainId 8453): ETH balance + EQTY (ERC-20) balance and recent EQTY transfers. 

The treasury address is currently hardcoded to `0x2Bc456799F3Cf071B10CE7216269471e0A40381a`. 

### Moneybird (optional)
If Moneybird JSON is present under `data/moneybird/...`, the page shows two financial accounts (e.g., bank + PSP) with:
- Monthly opening/closing balances.
- Cash received / cash paid totals.
- Net cash flow.
- Mutation counts (transaction count proxy). [file:5][file:1]

If Moneybird JSON isn’t present, the UI degrades gracefully and shows “Moneybird data not available yet.” [file:5]

## How it works

### Data generation (Node scripts)

#### On-chain snapshot (`scripts/fetch_onchain.js`)
- Uses Node >= 18 (native `fetch`) and `ethers` v6 `JsonRpcProvider`. 
- Ethereum:
  - Uses `ETH_RPC_URL` to read balances. 
  - Uses Etherscan v2 `account` → `tokentx` to fetch recent USDT transfers (requires `ETHERSCAN_API_KEY`).
- Base:
  - Uses `BASE_RPC_URL` to read balances. 
  - Uses Alchemy `alchemy_getAssetTransfers` (via JSON-RPC) to fetch recent EQTY transfers. 

Outputs:
- `data/eth/treasury.json` 
- `data/base/treasury.json` 
- `data/meta.json` (includes `generatedAt`, treasury address, and asset list) 

#### Moneybird export (`scripts/fetch_moneybird.js`)
- Publishes aggregated monthly JSON intended to avoid sensitive personal data (no contact-level export and no IBAN publishing). 
- Uses Moneybird API endpoints:
  - `/financial_accounts.json` 
  - `/reports/cash_flow.json` (opening/closing balances + received/paid aggregates) 
  - `/financial_mutations/synchronization.json?...` (monthly mutation counts) 

Outputs:
- `data/moneybird/bank/account.json` and `data/moneybird/bank/monthly-YYYY.json` 
- `data/moneybird/psp/account.json` and `data/moneybird/psp/monthly-YYYY.json`
- `data/moneybird/meta.json` 

### Rendering (static frontend)
- `index.html` is the static single-page shell and styling. 
- `app.js` fetches JSON from `./data/...` and renders:
  - Balances table (ETH/USDT on Ethereum, ETH/EQTY on Base).
  - Recent transfer lists for USDT and EQTY.
  - Moneybird account cards + monthly breakdown.

## Repository layout

```txt
.
├── index.html
├── app.js
├── scripts/
│   ├── fetch_onchain.js
│   └── fetch_moneybird.js
├── data/
│   ├── meta.json
│   ├── eth/treasury.json
│   ├── base/treasury.json
│   └── moneybird/...
├── treasury-eth.schema.json
├── treasury-base.schema.json
└── .github/workflows/refresh.yml

The on-chain JSON formats are described by JSON Schema:

treasury-eth.schema.json (Ethereum snapshot)

treasury-base.schema.json (Base snapshot)

Requirements
Node.js 18+ (recommended).

Dependencies: ethers and dotenv. 

Configuration (local + CI)
An example env file is provided as .env.example

Local setup
Copy .env.example to .env and fill in values. 

Install dependencies:

npm install

Run snapshots:

npm run fetch:onchain
npm run fetch:moneybird:local
The Moneybird local command uses node --env-file=.env .... 

GitHub Actions secrets setup
The workflow reads credentials from GitHub repository secrets (not from a committed .env). 

Take the keys from .env.example and create one secret per line via:
Settings > Secrets and variables > Actions > New repository secret. 

Required for on-chain:

ETH_RPC_URL 

BASE_RPC_URL 

ETHERSCAN_API_KEY 

Optional for Moneybird (required only if running Moneybird snapshots in CI):

MONEYBIRD_API_TOKEN 

MONEYBIRD_ADMINISTRATION_ID

MONEYBIRD_FINANCIAL_ACCOUNT_ID 

MONEYBIRD_FINANCIAL_ACCOUNT_ID_PSP

Hourly refresh (GitHub Actions)
This repo includes .github/workflows/refresh.yml which refreshes snapshots automatically and commits updated JSON back into the repository. 

Key behavior:

Triggers:

Manual run via workflow_dispatch. 

Scheduled run every hour at minute 17 UTC (17 * * * *) to avoid top-of-hour congestion. 

Uses Node.js 20 and npm ci. 

Runs both snapshot generators:

npm run fetch:onchain 

npm run fetch:moneybird 

Commits and pushes data/ only if files changed.

Requests contents: write permission so it can push updates.

Publishing (GitHub Pages)
Because the dashboard is just static files plus a generated data/ folder, GitHub Pages can serve it directly from the repository branch you configure in:
Settings → Pages.

As long as data/** is present in the published source, the site will render the latest committed snapshots.

Security notes
Never commit .env or any API keys. 

The Moneybird exporter is designed to publish aggregated data (monthly totals) rather than detailed per-transaction or contact data. 

Troubleshooting
“Fetch failed … ./data/…”:

Confirm data/meta.json, data/eth/treasury.json, and data/base/treasury.json exist in the published site source. 

Base transfers missing:

BASE_RPC_URL must be an Alchemy endpoint that supports alchemy_getAssetTransfers. 

Moneybird shows “not available yet”:

Confirm the workflow has Moneybird secrets set, and that data/moneybird/meta.json and related files exist.
