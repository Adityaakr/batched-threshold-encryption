# bte — project model

## What this is
Reveal-later encryption network ("seal now. reveal on cue.") on commonware's
batched threshold encryption. Built end to end 2026-07-06/07, phases 0-8 all
green. Contract: `spec/index.md`. Status + gates: `PROGRESS.md`, `REPORT.md`.

## Architecture (verified)
- `crates/bte-crypto` is the ONLY crate touching group elements; it wraps
  simple-bte pinned at git rev `147a0878` (Cargo.toml workspace dep). Payload
  path is the FO module (`fo.rs`), NOT the Schnorr/G_T path — see
  spec/API-MAP.md for the exact function map.
- Coordinator: axum /v0 + rusqlite (single Mutex<Connection>), engine tick
  500ms (`engine.rs:tick`), cross-terms cached in memory, recomputed after
  restart (`finalize_batch`).
- Nodes: outbound-only pollers, argon2id+ChaCha20 keystores
  (`bte-node/src/keystore.rs`).
- SDK: wasm inlined as base64 (`packages/sdk/scripts/build.mjs`), two wasm
  chunks (seal / verify). Anchor helpers are dependency-free (precomputed
  selectors, raw eth_call).

## Invariants (do not break)
- Positions: real cts sort by ct_hash, dummies fill the tail — a pure
  function of the real ct set (invariant 6 test).
- Wire types all start `BTE0` + type byte; golden files in
  `crates/bte-crypto/tests/golden/` (regenerate only with BTE_BLESS=1 and a
  version bump).
- KEM header and shares are exactly 48 bytes (tested).
- `/v0/reveals/:id` must 404 before reveal (invariant 4 test greps the db
  for plaintext bytes).
- Rejected shares are stored flagged and NEVER count toward t.

## Gotchas (hard-won)
- ark-std 0.6 re-exports rand 0.8; simple-bte also deps rand 0.9 (unused by
  its lib API). Use `bte_crypto::rand` / `bte_crypto::os_rng()` downstream —
  never a direct rand dep (version split bites).
- wasm builds need `.cargo/config.toml` cfg `getrandom_backend="wasm_js"`
  (getrandom 0.3 via rand 0.9) AND getrandom 0.2 "js" feature.
- Docker runtime user needs /data + /ceremony chown'd in the image (named
  volumes inherit image ownership).
- pnpm 11 blocks build scripts; `allowBuilds: esbuild: true` in
  pnpm-workspace.yaml.
- Shell cwd persists between Bash calls in this harness; watch relative paths.
- Piping `just …` through `tail` masks exit codes — verify demo results via
  API state, not pipe tails.

## Decision log
- 2026-07-07: FO transform as DEM + CCA (spec allowed it; DEVIATIONS #1/#2).
- 2026-07-07: per-slot validity via bandwidth-optimized hints `[k_i]_1==ct0`
  (public API only) so mauled cts never poison a batch.
- 2026-07-07: revealRoot tx sent by key-holder script, coordinator stays
  chain-free (DEVIATIONS #6).
- 2026-07-07: explorer needed hand-rolled CORS in api.rs (no new deps).

## Open items
- No GitHub remote yet: CI/Actions and npm publish are validated locally only.
- Sepolia run of the anchored demo pending SEPOLIA_RPC_URL +
  funded ANCHOR_PRIVATE_KEY (anvil path verified).
- Public devnet: DEVNET_URL in the SDK is a placeholder
  (`https://devnet.bte.invalid`); update when a devnet exists + set the
  playground URL in docs/launch.md.
- Explorer: agent-built and gate-verified; do one human visual pass.

## Telemetry (final run)
- divergence: n/a (execution build; spec was the approved plan)
- models: main loop + 1 explorer subagent; gates (executable) replaced skeptic panels
- claims: all DoD rows verified in-session except "CI green" (supported: same commands local)
- fleet: 1 subagent · overhead vs single-pass ≈ 1.1x
