# Peal - The programmable disclosure network.

### Peal Network

 (peal.network)

Commit-reveal without the second transaction. Sealed bids, hidden votes,
fair launches, guaranteed openings: one call to seal, one guaranteed batch
reveal. Nothing is readable early. Not by the operators, not by us.

```ts
import { BteClient } from 'bte-sdk';

const client = new BteClient({ url: 'http://localhost:8080' });
const conditionId = await client.condition({ in: 60 });
await client.seal('sealed bid: 42', conditionId);

const reveal = await client.waitForReveal(conditionId);
for (const slot of reveal.slots.filter(s => !s.isDummy)) {
  console.log('revealed on cue:', slot.text);
}
```

That is the whole integration. Your users never send a reveal transaction,
so there is no "the winner never opened their commitment", no reveal
deadline griefing, no trusted auctioneer sitting on plaintexts.

## how it works

![bte architecture](docs/img/architecture.svg)

bte is a reveal-later encryption network built on commonware's
[batched threshold encryption](https://commonware.xyz/blogs/bte)
([simple-bte](https://github.com/commonwarexyz/simple-bte), paper:
[eprint 2026/760](https://eprint.iacr.org/2026/760) by Guru Vamsi Policharla).

1. **Seal.** Your dapp encrypts a payload in wasm, client-side, to a
   committee of 5 operators with threshold 3. The ciphertext costs 64 bytes
   of overhead and can be posted anywhere.
2. **Cue.** A condition fires: a clock time, or an Ethereum block height.
   The batch freezes at 64 slots (padded with marked dummies), positions
   assigned by ciphertext hash. The expensive FFT work starts immediately,
   before any operator has responded.
3. **Reveal.** Each operator posts **one 48-byte share for the whole
   batch**, however many ciphertexts it holds. Every share is publicly
   verifiable with a pairing check. Any 3 valid shares recover all 64
   plaintexts at once, published with a merkle root you can pin onchain.

Before the cue nobody can read anything. After it, everybody can. That
asymmetry is the product.

## the numbers

Measured with criterion at B=64, n=5, t=3 (M-series laptop, single process):

| operation | cost |
|---|---|
| seal one payload (client wasm) | 416 µs |
| operator's share, whole batch | 1.16 ms, 48 bytes |
| verify one share (public) | 12 ms |
| pre-decrypt (hidden before shares arrive) | 245 ms |
| finalize after t shares | 37 ms |

In line with the paper's single-thread numbers (121.5 ms @ B=32, 593.63 ms
@ B=128). The reveal your users feel is the 37 ms, because the 245 ms was
pipelined while shares were still in flight.

## quickstart

Prereqs: rust stable, node 20+, pnpm, docker, [just](https://github.com/casey/just),
wasm-pack. Foundry only for the onchain anchor.

```bash
git clone https://github.com/Adityaakr/batched-threshold-encryption
cd batched-threshold-encryption
just setup     # toolchain + deps
just demo      # boots a 5-operator network, runs a sealed-bid auction
```

`just demo` starts one coordinator, runs the dealer ceremony, brings up 5
operator nodes, seals 8 bids, and crowns the winner after the 60 second cue.
The explorer (`pnpm -C packages/explorer dev`, port 5173) shows every
condition flipping from ciphertext hashes to plaintexts, with the
per-operator share log. Full walkthrough: [docs/quickstart.md](docs/quickstart.md).

## try to break it

- **Read before the reveal.** `GET /v0/reveals/:id` is 404 until the cue.
  There is no plaintext anywhere: the coordinator stores ciphertexts, the
  operators hold Shamir shares of powers of tau. Below t shares, decryption
  does not exist.
- **Kill n-t operators.** `docker compose stop node4 node5`. The reveal
  still lands: any 3 of 5 shares recover the batch.
- **Kill more.** The condition goes `stalled`, loudly, in the API and the
  explorer. Restart a node and the reveal completes. No silent hangs.
- **Submit garbage shares.** `just demo-byzantine` runs operator 2 with
  `--byzantine` and kills operator 5 mid-flow. The bad share fails the
  public pairing check, is stored flagged, never counts toward t, and the
  reveal succeeds from the 3 honest shares.
- **Maul a ciphertext.** Flip a bit in someone's sealed blob: that one slot
  is flagged corrupt at reveal time, the other 63 are untouched.
- **Restart mid-flow.** Kill the coordinator between freeze and reveal; it
  recomputes the pipelined work and finishes. Nodes are stateless beyond
  their keystore.

## anchor it onchain (optional)

`BteAnchor.sol` records ciphertext commitments per condition and lets the
coordinator address publish the reveal's merkle root. The SDK recomputes
the root from revealed payloads and checks it against the chain
(`verifyAnchor`), so your app does not have to trust the coordinator's word:

```bash
just demo-anchored   # local anvil, or Sepolia with SEPOLIA_RPC_URL + ANCHOR_PRIVATE_KEY
```

## trust model, honestly

v0 uses a **single trusted dealer**: `bte-cli ceremony` samples tau, deals
Shamir shares of each power to the operators, publishes public parameters,
and drops tau. A dealer compromised at ceremony time can read everything
sealed under that committee. There is no DKG yet, no resharing, and the
committee can censor by refusing to reveal (you will see it stall; you
cannot force it).

What you do NOT have to trust: operators below the threshold learn nothing,
shares are publicly verifiable so a lying operator cannot corrupt a reveal,
and the coordinator never sees plaintext before the cue. Details in
[SECURITY.md](SECURITY.md), every divergence from the paper in
[spec/DEVIATIONS.md](spec/DEVIATIONS.md), the path to trustlessness (DKG,
EIP-2537 onchain verification, staking) in [spec/ROADMAP.md](spec/ROADMAP.md).

## repo map

| path | what |
|---|---|
| `crates/bte-crypto` | the only crate touching group elements; wraps simple-bte |
| `crates/bte-coordinator` | registry, condition engine, aggregator, REST, sqlite |
| `crates/bte-node` | operator binary (encrypted keystore, outbound-only) |
| `crates/bte-cli` | ceremony, committee init, e2e driver |
| `packages/sdk` | `bte-sdk` on npm: TS + inlined wasm, zero bundler config |
| `packages/explorer` | live committee / conditions / reveal explorer |
| `contracts/` | `BteAnchor.sol`: ciphertext commits + reveal roots |
| `demos/` | sealed-bid auction, byzantine run, anchored variant |

## credits

The cryptography is entirely [commonware](https://commonware.xyz)'s work:
[commonwarexyz/simple-bte](https://github.com/commonwarexyz/simple-bte) by
Guru Vamsi Policharla ([eprint 2026/760](https://eprint.iacr.org/2026/760)),
used unmodified as a dependency. bte adds the network around it:
coordinator, operator nodes, wire formats, SDK, explorer, and the onchain
anchor.

Apache-2.0. See [NOTICE](NOTICE).
