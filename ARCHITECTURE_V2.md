# Escrow architecture v2

## What changes

- Service wallet no longer deploys every escrow.
- Backend only calculates the deterministic escrow address after both wallet addresses are known.
- Buyer pays through Mini App with TON Connect using one message that contains `StateInit` and the exact escrow deposit. This deploys and funds the escrow in one transaction.
- Happy-path confirmation is signed by the buyer's own TON wallet (`Confirm`).
- Arbiter/service wallet remains authorized as an emergency Confirm fallback and for `Cancel` / `Resolve` in disputes.
- Platform percentage fee goes to `PLATFORM_ADDRESS`.
- Unused network reserve goes back to the arbiter/service wallet, not the revenue wallet.

## Service wallet balance

The current ~0.07 TON balance is no longer a prerequisite for creating new ordinary deals. It is only a bootstrap/emergency reserve for admin blockchain actions. Completed v2 deals replenish that reserve with unused network budget.

Do not assume 0.07 TON is enough for many simultaneous disputes. Monitor the balance and measure real mainnet fees before reducing the network reserve.

## Deployment

Railway should use:

- Root Directory: `/`
- Build Command: `npm run build`
- Start Command: `npm start`

`npm run build` now recompiles `contracts/escrow.tact`, copies the generated TypeScript wrapper to `contracts/wrappers/Escrow.ts`, compiles the backend, and copies Mini App assets to `dist/miniapp`.

## Contract verification

The v2 smart contract has different bytecode / code hash from the old contract. The old TON Verifier link must not be reused. After publishing/verifying v2, set:

`VERIFIER_URL_V2=https://...`

Until then the UI explicitly shows that re-verification is pending.

## Legacy deals

Already-deployed old contracts keep their old bytecode and old rules. Finish them using the old admin flow or recreate them after the v2 deployment. Do not assume buyer-signed Confirm works against a legacy contract.
