# bte progress

## Phase checklist

- [x] Phase 0 — read, spec, scaffold
- [x] Phase 1 — bte-crypto (go/no-go) ✅ GREEN
- [x] Phase 2 — bte-coordinator
- [x] Phase 3 — bte-node + local network
- [x] Phase 4 — bte-sdk npm package
- [ ] Phase 5 — explorer (IN PROGRESS)
- [ ] Phase 6 — demos, benches, launch collateral
- [ ] Phase 7 — sepolia anchor
- [ ] Phase 8 — ship pack

## Current status

Phases 0-4 complete, all gates green. simple-bte read end to end; `fo` module
(FO transform) is the payload path with built-in Shamir thresholdization in
`crs::setup`. Crypto core, coordinator, node network, and publishable SDK all
tested. Next: explorer (phase 5) + demos (phase 6).

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

## Decisions log

- Use `fo` (Fujisaki-Okamoto) path for payloads; DEVIATIONS #1/#2.
- Pin simple-bte as git dependency at rev 147a0878 (clone kept in vendor/ for
  reference, gitignored).
- Per-slot validity at finalize via bandwidth-optimized hints + `[k_i]_1 == ct0_i`
  check (public API only) so one mauled ct never poisons a batch.
