# Brand: Peal

_Status: active_ (renamed from bte 2026-07-07; design spec from the original build prompt)

## Naming

- Product name: **Peal**. Domain: peal.network. Site title: **Peal Network**.
- The explorer surface is titled **Peal Network**.
- Logo: the teal leaf at packages/explorer/public/peal-logo.svg (also the
  favicon). Leaf teals #00737F / #005866 are LOGO-ONLY colors, never UI
  accents; the UI accent stays #2563eb.
- Identity line: "peal — the programmable disclosure network." (user-approved
  em-dash exception, 2026-07-07; everywhere else the no-em-dash rule holds)
- Headline: "your users commit. the network reveals."
- Supporting line: "commit-reveal without the second transaction."
- Speed line: "add fair reveals to your dapp in minutes."
- Description: "add fair reveals to your dapp in minutes. seal data to the Peal
  committee; when the cue fires, the whole batch opens at once, guaranteed.
  nothing readable early, not even by operators. every share verified in
  public, every reveal on the record."
- Internal names stay: bte-* crates, bte-sdk on npm, /v0 API, wire magic BTE0.
  Peal is the product; bte is the plumbing.

## Voice

Sentence case everywhere, including headings. Short, declarative, technical,
no hype, no emoji in UI, **no em-dashes anywhere in UI copy** (use periods or
commas). No trust banner in the UI (removed 2026-07-07); the v0 trust caveat
lives in the README and docs instead.

## Color

| token | value | use |
|---|---|---|
| background | `#ffffff` | page, always white |
| text | `#111827` | body |
| muted | `#6b7280` | captions, secondary |
| border | `#e5e7eb` | hairlines, cards |
| accent | `#2563eb` | THE single accent: links, focus rings, frozen state, primary buttons |
| green | `#16a34a` | revealed / success only |
| red | `#dc2626` | stalled / rejected / corrupt only |

No gradients, no shadows heavier than `0 1px 2px rgb(0 0 0 / 0.05)`, no dark
mode (white is part of the identity).

## Typography

- UI: Satoshi via Fontshare (400/500/700), system-ui fallback.
- Hashes, ids, numbers: `ui-monospace` stack; `tabular-nums` globally.
- Generous whitespace over boxes; hairline borders over fills.

## Motion

Purposeful only: state transitions (reveal flip, share arrival) and micro
feedback. Durations 100-300 ms, ease-out on enter, ease-in on exit, all
gated behind `prefers-reduced-motion: no-preference`.
