# bte

## seal now. reveal on cue.

**Commit-reveal without the second transaction.** Add sealed bids, hidden
votes, and fair reveals to your onchain app in minutes. One call to seal,
guaranteed batch reveal, nothing readable early, not even by us.

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

That is the whole integration. No reveal transaction from the bidder, no
"sorry, the winner never opened their commitment", no trusted auctioneer
holding plaintexts.

> **v0: dealer-trusted setup. do not protect real value with this.**

## how it works

bte is a reveal-later encryption network built on commonware's
[batched threshold encryption](https://commonware.xyz/blogs/bte)
([simple-bte](https://github.com/commonwarexyz/simple-bte), paper:
[eprint 2026/760](https://eprint.iacr.org/2026/760), Guru Vamsi Policharla).

You seal a payload to a committee of n operators with threshold t (default
5-of-3, batch size B=64). The ciphertext is small (64 bytes of overhead) and
can be posted anywhere. When your condition fires, a clock time or an Ethereum
block height, the batch freezes and each operator publishes **one 48-byte
share for the entire batch**, regardless of how many ciphertexts are in it.
Every share is publicly verifiable with a pairing check. Any t valid shares
recover every plaintext at once via an FFT-accelerated decryption that runs in
O(B log B) group operations, and most of that work is pipelined before the
shares even arrive.

Before the cue: nobody can read anything, operators included. After: everybody
can. That asymmetry is the product.

```
  dapp ── seal (wasm, client-side) ──> coordinator ── freeze on cue ──> operators (5)
                                          │  pads batch, assigns          │ one 48-byte
                                          │  positions, pre-computes      │ share each
                                          │  cross-terms (pipelined)      ▼
   everyone <── plaintexts + merkle root ─┴── verify shares publicly, combine any 3,
                                              FFT-recover all 64 slots at once
```

## quickstart

Prereqs: rust stable, node 20+, pnpm, docker, [just](https://github.com/casey/just),
wasm-pack. Foundry only for the onchain anchor.

```bash
git clone https://github.com/Adityaakr/batched-threshold-encryption && cd bte
just setup          # toolchain + deps
just compose-up     # 1 coordinator + fresh ceremony + 5 operator nodes
just demo           # sealed-bid auction: 8 bidders, 60s cue, winner crowned
```

The explorer (`pnpm -C packages/explorer dev`, port 5173) shows the committee,
every condition, and each reveal flipping from ciphertext hashes to
plaintexts, with the per-operator share log.

Full walkthrough: [docs/quickstart.md](docs/quickstart.md).

## try to break it

- **Read before the reveal.** `GET /v0/reveals/:id` is 404 until the cue.
  There is no plaintext anywhere: not in the database, not in memory, not
  held by any operator. The coordinator stores ciphertexts, the operators
  hold Shamir shares of powers of tau. Decryption is impossible below t.
- **Kill n-t operators.** `docker compose stop node4 node5`. The reveal still
  lands: any 3 of 5 shares recover the batch.
- **Kill more.** Stop a third node and the condition goes `stalled`, loudly,
  in the API and the explorer. Restart a node and the reveal completes. No
  silent hangs.
- **Submit garbage shares.** `just demo-byzantine` runs operator 2 with
  `--byzantine` (random shares) and kills operator 5 mid-flow. The bad share
  fails the public pairing check, is stored flagged, never counts toward t,
  and the reveal succeeds from the 3 honest shares.
- **Maul a ciphertext.** Flip a bit in someone's sealed blob and the FO
  re-derivation check flags that slot corrupt at reveal time. The other 63
  slots are untouched.
- **Restart mid-flow.** Kill the coordinator between freeze and reveal. On
  restart it recomputes the pipelined cross-terms and finishes. Nodes are
  stateless beyond their keystore; restart them any time.

## trust model, honestly

v0 uses a **single trusted dealer**: `bte-cli ceremony` samples tau, deals
Shamir shares of each power tau^i to the operators, publishes the public
parameters, and drops tau. If the dealer was compromised at ceremony time,
everything sealed under that committee is readable by the attacker. There is
no DKG yet, no proactive resharing, and operator replacement means a new
ceremony. The committee can also censor by refusing to reveal (you will see
it stall; you will not be able to force it).

What you do NOT have to trust: operators cannot read anything early (any
subset below t learns nothing), shares are publicly verifiable so a wrong
share cannot corrupt a reveal, and the coordinator never sees a plaintext
before the cue. Details in [SECURITY.md](SECURITY.md), gaps in
[spec/DEVIATIONS.md](spec/DEVIATIONS.md), path to trustlessness in
[spec/ROADMAP.md](spec/ROADMAP.md).

## repo map

| path | what |
|---|---|
| `crates/bte-crypto` | the only crate touching group elements; wraps simple-bte |
| `crates/bte-coordinator` | registry, condition engine, aggregator, REST, sqlite |
| `crates/bte-node` | operator binary (encrypted keystore, outbound-only) |
| `crates/bte-cli` | ceremony, committee init, e2e driver |
| `packages/sdk` | `bte-sdk` on npm: TS + inlined wasm, zero bundler config |
| `packages/explorer` | live committee/conditions/reveal explorer |
| `contracts/` | `BteAnchor.sol`: commit ct hashes + reveal roots on Sepolia |
| `demos/` | sealed-bid auction, byzantine run, anchored variant |

## credits

The cryptography is entirely
[commonware](https://commonware.xyz)'s work:
[commonwarexyz/simple-bte](https://github.com/commonwarexyz/simple-bte) by
Guru Vamsi Policharla ([eprint 2026/760](https://eprint.iacr.org/2026/760)),
used unmodified as a dependency. bte adds the network around it: coordinator,
operator nodes, wire formats, SDK, explorer, and the onchain anchor.

Apache-2.0. See [NOTICE](NOTICE).
