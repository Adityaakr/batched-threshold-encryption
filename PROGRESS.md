# bte progress

## Phase checklist

- [x] Phase 0 — read, spec, scaffold
- [x] Phase 1 — bte-crypto (go/no-go) ✅ GREEN
- [x] Phase 2 — bte-coordinator
- [x] Phase 3 — bte-node + local network
- [x] Phase 4 — bte-sdk npm package
- [x] Phase 5 — explorer
- [x] Phase 6 — demos, benches, launch collateral
- [x] Phase 7 — sepolia anchor
- [x] Phase 8 — ship pack

ALL PHASES COMPLETE. See REPORT.md.

## Current status

Build complete, phases 0-8, every gate green. See REPORT.md for the
definition-of-done checklist, bench table, deviations, and run commands.

## Gate results

- Phase 0: `just lint && just test` green on scaffold; CI valid.
- Phase 1: `cargo test -p bte-crypto` 9/9 green (roundtrip, t-1 explicit error,
  corrupted share, mauled ct per-slot, goldens, 48-byte asserts, pipelining).
- Phase 2: `cargo test -p bte-coordinator` 6/6 green (full flow, invariants
  4/5/6, byzantine share flagged + stall recovery, merkle).
- Phase 3: `just compose-up && just test-e2e` PASS against live 5-node Docker
  network (B=64: 3 payloads + 61 dummies revealed, 5/5 shares verified).
- Phase 4: SDK vitest 7/7 green; `node examples/ten-lines.ts` sealed + revealed
  against live compose; `just publish-dry` clean (bte-sdk name free on npm).
- Phase 5: `pnpm -C packages/explorer build` green (9.3 kB JS). Manual checklist:
  [x] app serves (vite preview, banner present) [x] /v0/conditions + CORS live
  from the compose coordinator [x] home: committee stats + roster + condition
  chips (agent-verified against live data) [x] detail: before/after board,
  share log with rejected highlight, pre-decrypt vs finalize timings
  (agent-verified DOM build; visual pass on next `pnpm -C packages/explorer dev`).
- Phase 6: `just demo` PASS (8 bidders, winner crowned, 56 dummies marked).
  `just demo-byzantine` PASS, verified via API state: 3 verified shares
  (operator 5 killed mid-flow), operator 2 flagged rejected, reveal complete.
  Benches (M-series, single process): seal 416µs; partial 1.16ms;
  verify_share 12.0ms; pre_decrypt 245ms + finalize 37ms (B=64);
  recover e2e 432ms. Consistent with paper scale (121.5ms @ B=32,
  593.63ms @ B=128).
- Phase 7: `forge test` 6/6 green; anchored demo PASS against anvil
  (coordinator root == onchain root == SDK-recomputed root; winner asserted).
- Phase 8: `just prod-up` boots (Caddy TLS edge, explorer served, healthz ok);
  in-network e2e PASS on the prod stack; `just publish-dry` clean; final
  sweep green (clippy 0 errors, 13 rust test targets ok, forge 6/6, sdk 7/7,
  explorer builds).

## Decisions log

- Explorer required CORS: hand-rolled middleware in api.rs (no new deps).
- demo-byzantine orchestration: compose overlay makes node2 byzantine from
  boot; node5 is stopped 20s into the run (mid-flow, pre-freeze).

- Use `fo` (Fujisaki-Okamoto) path for payloads; DEVIATIONS #1/#2.
- Pin simple-bte as git dependency at rev 147a0878 (clone kept in vendor/ for
  reference, gitignored).
- Per-slot validity at finalize via bandwidth-optimized hints + `[k_i]_1 == ct0_i`
  check (public API only) so one mauled ct never poisons a batch.
