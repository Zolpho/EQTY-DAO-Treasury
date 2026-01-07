# EQTY-DAO-Treasury

## Local run (Alchemy)

1) Install dependencies:
```bash
npm ci

2) Create .env (never commit it):
cp .env.example .env

3) Fill .env with your Alchemy endpoints:

ETH_RPC_URL=https://eth-mainnet.g.alchemy.com/v2/<API_KEY>

BASE_RPC_URL=https://base-mainnet.g.alchemy.com/v2/<API_KEY>

Then run:
npm run fetch:onchain

This generates/updates:

data/eth/treasury.json

data/base/treasury.json

data/meta.json

Key rotation (no leaks)
GitHub Actions (production)
Store secrets in GitHub:

Settings → Secrets and variables → Actions

ETH_RPC_URL

BASE_RPC_URL

ETHERSCAN_API_KEY

To rotate:

Create a new Alchemy API key (new app or regenerate key in Alchemy dashboard).

Update the GitHub secrets with the new URLs.

Revoke/disable the old key in Alchemy.

Trigger the workflow manually (Actions → “Refresh on-chain snapshots” → Run workflow).

Local
Update only .env. Never paste keys into code, commits, issues, or PRs.
