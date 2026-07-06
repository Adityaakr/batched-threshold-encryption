# bte progress

## Phase checklist

- [ ] Phase 0 — read, spec, scaffold (IN PROGRESS)
- [ ] Phase 1 — bte-crypto (go/no-go)
- [ ] Phase 2 — bte-coordinator
- [ ] Phase 3 — bte-node + local network
- [ ] Phase 4 — bte-sdk npm package
- [ ] Phase 5 — explorer
- [ ] Phase 6 — demos, benches, launch collateral
- [ ] Phase 7 — sepolia anchor
- [ ] Phase 8 — ship pack

## Current status

Phase 0: blog read (full scheme + FFT + pipeline captured), simple-bte cloned at
`147a0878` and read end to end (all 5 src files + tests). Key finding: `fo` module
provides byte-string message handling + built-in Shamir thresholdization in
`crs::setup` — no monorepo clone needed. spec/API-MAP.md, spec/index.md,
spec/DEVIATIONS.md written. Next: scaffold workspace + CI, run gate.

## Gate results

(none yet)

## Decisions log

- Use `fo` (Fujisaki-Okamoto) path for payloads; DEVIATIONS #1/#2.
- Pin simple-bte as git dependency at rev 147a0878 (clone kept in vendor/ for
  reference, gitignored).
- Per-slot validity at finalize via bandwidth-optimized hints + `[k_i]_1 == ct0_i`
  check (public API only) so one mauled ct never poisons a batch.
