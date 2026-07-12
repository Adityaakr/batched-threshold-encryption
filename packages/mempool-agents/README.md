# bte-mempool-agents

On-chain agents for the encrypted-mempool demo (`#/encrypted-mempool` in the
explorer). Three services front the two `SwapPool` lanes deployed by
`contracts/script/DeployMempool.s.sol`:

- **relayer** — the visitor's sponsored, no-wallet gateway. Submits the public
  order (cleartext) and the peal commitment (a hash) on the visitor's behalf,
  and serves read endpoints (`/config`, `/state`, `/public-result`,
  `/peal-result`) so the browser needs no chain library.
- **searcher** — a real bot with its own key. Reads each public order, sizes a
  sandwich to the victim's slippage floor, and submits real front/back-run
  transactions when profitable (else includes honestly). On the peal lane it
  sees only a hash and does nothing.
- **settler** — the coordinator's on-chain arm. Watches the coordinator reveal
  API for `mempool`-tagged conditions and submits `PealMempool.executeBatch`,
  which the contract binds to the revealed batch by re-deriving the merkle root.

## Keys

Sourced from `.secrets/tempo-keys.env` (gitignored). The deployer doubles as the
coordinator/settler. Each service reads one key from the environment:

| service  | env var                 |
|----------|-------------------------|
| relayer  | `RELAYER_PRIVATE_KEY`   |
| searcher | `SEARCHER_PRIVATE_KEY`  |
| settler  | `DEPLOYER_PRIVATE_KEY`  |

`CHAIN_ID` picks `deployments/<chainId>.json`. `COORDINATOR_URL` points the
settler at the coordinator whose reveals it settles.

## Local run (anvil)

```sh
# 1. anvil
anvil --port 8546

# 2. deploy (writes deployments/31337.json is manual; the script prints addrs)
cd ../../contracts
DEPLOYER_PRIVATE_KEY=<anvil key0> RELAYER_ADDRESS=0x.. SEARCHER_ADDRESS=0x.. \
  forge script script/DeployMempool.s.sol --rpc-url http://localhost:8546 --broadcast

# 3. fund relayer + searcher with gas, then run the agents
cd ../packages/mempool-agents
CHAIN_ID=31337 RELAYER_PRIVATE_KEY=0x..  pnpm relayer
CHAIN_ID=31337 SEARCHER_PRIVATE_KEY=0x.. pnpm searcher
CHAIN_ID=31337 DEPLOYER_PRIVATE_KEY=0x.. COORDINATOR_URL=<coordinator> pnpm settler
```

Point the explorer at the relayer with `VITE_RELAYER_URL` (defaults to
`http://localhost:8799`); its `/v0` proxy (or `VITE_BTE_URL`) must reach the same
coordinator the settler watches.

## Tempo

Deploy with `CHAIN_ID=42431`, the RPC `https://rpc.moderato.tempo.xyz`, and the
funded `.secrets` keys; write the printed addresses to `deployments/42431.json`
with `explorerBase: "https://explore.testnet.tempo.xyz"` so the UI links to the
block explorer. Gas is paid in stablecoins (no native token), so the accounts
need pathUSD from the faucet, not ETH.
