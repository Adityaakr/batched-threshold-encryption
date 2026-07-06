# bte build report

Phases 0-8 complete. Every gate ran and passed on this machine
(macOS, M-series, rust 1.95.0, node 24, pnpm 11, docker 29, foundry 1.5.1).

## definition of done

| item | status | evidence |
|---|---|---|
| `git clone && just setup && just demo` prints the winner | PASS | demo auto-boots compose; run output: "winner: frank with 995", "demo PASS" |
| `just demo-byzantine` passes | PASS | verified via API state: operator 2's share flagged rejected, operator 5 killed mid-flow, reveal from 3 honest shares |
| explorer shows reveal, 5 operators, rejected share highlighted | PASS | built + served (9.3 kB JS); share log renders verified/rejected rows, rejected in red; CORS added to coordinator |
| `node examples/ten-lines.ts` works against local stack | PASS | "revealed on cue: sealed bid: 42" |
| `forge test` green | PASS | 6/6 (commit open, revealRoot restricted/once/nonzero, fuzz) |
| `just publish-dry` clean | PASS | bte-sdk@0.1.0 tarball, name free on npm (E404 on `npm view bte-sdk`) |
| `just prod-up` boots | PASS | Caddy TLS edge serves explorer + /v0; in-network e2e PASS (3 payloads + 61 dummies, 5/5 shares) |
| all CI green | PASS (local) | ci.yml runs fmt+clippy+test: identical commands green locally; no GitHub remote configured yet, so Actions itself has not run |
| README opens with headline, hook, snippet | PASS | README.md lines 1-20 |
| commonware credited prominently | PASS | README credits section, NOTICE, SECURITY.md, launch.md |
| DEVIATIONS.md honest | PASS | 6 entries, see summary below |

Invariants (section G) test map: 1,2,3,7,8,9,10 in `crates/bte-crypto/tests/api.rs`;
3 also in coordinator `rejected_share_flagged_never_used_and_stall_recovery`;
4,5,6 in `crates/bte-coordinator/tests/integration.rs`; 9 additionally asserted
in-flow (predecrypt_ms recorded at freeze, before any share exists); 10 asserted
at 48 bytes for both the KEM header and the share element.

## benches (criterion, single process, M-series; B=64, n=5, t=3)

| op | time |
|---|---|
| seal (1 payload) | 416 µs |
| partial (one 48-byte share for the whole batch) | 1.16 ms |
| verify_share (public pairing check) | 12.0 ms |
| pre_decrypt (FFT cross-terms, pipelined) | 244.7 ms |
| finalize (B pairings + open all slots) | 37.3 ms |
| recover end-to-end (verify 3 shares + pre_decrypt + finalize) | 432 ms |

Comparison: the paper reports 121.5 ms @ B=32 and 593.63 ms @ B=128 for full
decryption (single-thread M5). Our pre_decrypt+finalize at B=64 is ~282 ms,
sitting where interpolation predicts; the pipeline split (245 ms hidden before
shares arrive, 37 ms after) matches the paper's motivation for pipelining.

## deviations summary (full text in spec/DEVIATIONS.md)

1. DEM is simple-bte's FO keystream, not ChaCha20-Poly1305 (spec prefers the
   scheme's own message handling; it has one).
2. CCA via the FO transform's re-derivation check, not a separate 64-byte
   proof; rejection happens per-slot at reveal time.
3. Header-only `partial`/`verify_share` mirror fo.rs call-for-call (API
   adaptation, not reimplementation).
4. commonware monorepo clone unnecessary: thresholdization is built into
   `crs::setup`.
5. `partial()` verifies no ciphertext proofs (FO path has none), matching
   fo.rs.
6. revealRoot tx sent by the ANCHOR_PRIVATE_KEY holder (demo script), not the
   chain-free Rust coordinator; onchain restriction unchanged.

## artifact inventory

- `crates/bte-crypto`: wrapper over simple-bte (pinned rev 147a0878), wire
  formats (BTE_WIRE_V0), golden files, 9 tests, criterion benches.
- `crates/bte-coordinator`: axum /v0 API, condition engine (at_time +
  at_block via JSON-RPC), padding/positions, share verification, merkle
  reveals, stall detection, per-IP rate limiting, CORS; 6 tests.
- `crates/bte-node`: operator binary, argon2id+ChaCha20-Poly1305 keystore,
  `--byzantine` (BTE_DEV-gated); keystore tests.
- `crates/bte-cli`: `ceremony`, `committee-init`, `e2e`.
- `crates/bte-wasm`: wasm-bindgen bindings (seal-only + verify builds).
- `packages/sdk`: bte-sdk 0.1.0 (root + ./verify exports, inlined wasm,
  anchor helpers, verifyAnchor); 7 vitest tests; release workflow with
  provenance dry-run.
- `packages/explorer`: vite + vanilla TS, 3 views, live polling, Satoshi,
  #2563eb accent, permanent trust banner.
- `contracts/`: BteAnchor.sol + 6 forge tests (incl. fuzz).
- `demos/`: sealed-bid (8 bidders, 60 s cue), byzantine variant recipe,
  sealed-bid-anchored (anvil-verified; Sepolia via env).
- `docker/`: dev compose (coordinator + ceremony + 5 nodes), byzantine
  overlay, prod compose (+ Caddy TLS edge, static explorer, healthchecks,
  restart policies, prod rate limits), multi-stage Dockerfiles.
- `docs/`: quickstart, devnet-runbook (offline ceremony, keystore
  distribution, DNS/Caddy, weekly wipe cron, incident basics), launch.md
  (storyboard, snippet block, technical summary).
- `spec/`: index.md (the contract), API-MAP.md, DEVIATIONS.md, ROADMAP.md.
- CI: fmt + clippy -D warnings + tests on push; tag-triggered npm publish
  dry-run with provenance.

## see it yourself

```bash
just setup            # toolchain, submodules, deps
just demo             # boots the 5-node network if needed; sealed-bid auction
just demo-byzantine   # bad operator flagged, dead operator tolerated
pnpm -C packages/explorer dev   # http://localhost:5173
node examples/ten-lines.ts      # the 10-line integration
just bench            # criterion suite
cd contracts && forge test      # anchor contract
just demo-anchored    # anvil (or Sepolia with SEPOLIA_RPC_URL + ANCHOR_PRIVATE_KEY)
just prod-up          # production compose: https://localhost
just compose-down && just prod-down   # clean up
```

## Telemetry

- divergence: n/a (execution build; no multi-lens fan-out rounds ran — the spec was the approved plan)
- grounding: all crypto API claims grounded in simple-bte source (file:line in spec/API-MAP.md); every gate re-run live
- models: main loop only + 1 explorer subagent; skeptic panel not used (gates are executable, stronger than review)
- claims: all DoD rows `verified` (command ran in-session); "CI green" is `supported` (same commands local; Actions not yet triggered)
- fleet: 1 subagent (explorer) · overhead vs single-pass ≈ 1.1x
