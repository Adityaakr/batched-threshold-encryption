# bte — project model
<!-- updated 2026-07-07 by prism-understand (share-link recipient flow + engagement audit) -->

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

## Docs
- Standalone protocol article: docs/protocol.html (self-contained HTML, brand
  tokens inline, SVG architecture diagram). Same content spine as #/protocol;
  update BOTH when the protocol or SDK surface changes.
- In-app protocol reference at #/protocol (packages/explorer/src/pages/protocol.ts,
  nav in index.html): overview, use cases, lifecycle, cryptography (wire, FO,
  punctured setup, pipelined recovery, merkle commitment), private seals,
  architecture, production posture, integration (incl. tags), trust model.
  Grounded in spec/index.md + engine.rs/merkle.rs; keep in sync when the
  protocol or SDK surface changes. Styles live under .protocol-* in style.css.

## Decision log
- 2026-07-07: product renamed OPEN then Peal (peal.network) same day;
  explorer is "Peal Explorer", identity "the guaranteed reveal network",
  headline "commit-reveal without the second transaction.", speed line "add
  fair reveals to your dapp in minutes." Display strings only (brand.md
  Naming section); bte-* crates, bte-sdk, /v0 API, BTE0 wire magic unchanged.
- 2026-07-07: private seals: AES-128-GCM layer over capsule payloads, key in
  the share-link fragment only (packages/explorer/src/privacy.ts, BTEP1 wire
  prefix). Default ON for time capsules; bids/votes stay public by design.
- 2026-07-07: FO transform as DEM + CCA (spec allowed it; DEVIATIONS #1/#2).
- 2026-07-07: per-slot validity via bandwidth-optimized hints `[k_i]_1==ct0`
  (public API only) so mauled cts never poison a batch.
- 2026-07-07: revealRoot tx sent by key-holder script, coordinator stays
  chain-free (DEVIATIONS #6).
- 2026-07-07: explorer needed hand-rolled CORS in api.rs (no new deps).

## Frontend (playground, 2026-07-07)
- Explorer is a playground: seal in-browser via bte-sdk wasm (packages/explorer/src/playground.ts),
  live share dots from `verified_shares` per batch (api.rs get_condition), reveal flip.
- brand.md at repo root is the design source of truth (white, Satoshi, #2563eb, sentence case, no em-dashes).
- SDK gotcha FIXED: `fetch` must be bound to globalThis (bare reference = Illegal invocation in browsers).
- Dockerfile.web builds the pnpm workspace in 3 stages (wasm-pack -> pnpm -> caddy); .dockerignore added.
- Browser e2e pattern: playwright script in scratchpad drives seal->reveal with screenshots; port 8080
  may be held by the user's other projects (cusp-fi vite) — use a compose port override (18080) for tests.

## Condition tags + round segregation (2026-07-07)
- conditions carry an optional `tag` TEXT column (db.rs schema + ALTER
  migration in db.rs open()); create_condition validates <=32 chars of
  [a-z0-9:_-] (api.rs); returned by list/get. SDK condition() takes tag.
- Playground tags: `round:bid`, `round:vote` (shared, joinable), `capsule`
  (never joined). findOpenRound(tag) matches tag exactly — untagged/legacy
  conditions are never joined (playground.ts). Round length: first sealer's
  #pg-round-secs select (30s..1h) sets it; joiners inherit.
- INVARIANT: never join a condition whose tag you did not create for that
  purpose — joining someone's capsule strands the entry until the capsule
  fires (the original bug).

## Dummy padding (mapped 2026-07-07)
- WHY: B=64 is baked into the ceremony CRS (punctured powers-of-tau, FFT domain,
  spec/index.md:32,39-42); every batch MUST be exactly B slots, so the
  coordinator pads with self-sealed dummies at freeze (engine.rs:135-143).
- Each dummy is a REAL FO ciphertext sealing "BTE_DUMMY_V0:" + 16 random bytes
  (bte-crypto/src/lib.rs:449-455); unique ct_hash per batch; committed in the
  merkle root with all slots (engine.rs:407-430); operators do real work on them.
- Reveal API exposes per slot ONLY: position, ct_hash, is_dummy, valid,
  payload_b64 (engine.rs:19-25, api.ts:50-56). Dummy rows are visually
  identical except position/hash — the expandable 63-row table in
  condition.ts boardTable duplicates what the slot grid already shows.
- Classification logic (corrupt/dummy/private/real) is duplicated between
  slotGrid (condition.ts:211-219) and slotRow (condition.ts:234-245).

## Share-link recipient flow (mapped 2026-07-07)
- Link format: `${origin}${pathname}#/s/<conditionId>/<ctHash>` (packages/explorer/src/playground.ts:70);
  router regex requires exact 64-hex ctHash (packages/explorer/src/main.ts:16).
- Recipient page packages/explorer/src/pages/seal-view.ts: 2s status poll + 1s countdown tick
  (seal-view.ts:99-100); reveal detected purely by `status === 'revealed'` (seal-view.ts:69), then
  getReveal + slot match by ct_hash (seal-view.ts:75).
- Deployment: hash routes never reach the server; Caddy is static try_files fallback
  (docker/Caddyfile:11-15) so per-link OG previews are impossible without a server route.
- Coordinator: CORS `*` (api.rs:70), rate limit 50 rps / 400 burst per IP (state.rs:16) — polling
  is a non-issue. NO push machinery anywhere (no WS/SSE/webhook/email); only pull. The one hook
  point for future push is the reveal write in engine.rs finalize_ready.
- Engagement primitives ABSENT (all confirmed by grep): document.title never updated, no
  favicon/OG/manifest in index.html, no service worker/Notification API, no localStorage
  (no "my seals" persistence), no visibilitychange handling (background tabs throttle the
  2s poll to ~1/min, so "opens by itself" is unreliable when hidden), no sender name/label
  (conditions table has no creator/memo column, db.rs:16-25; kicker hardcoded seal-view.ts:13).

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
