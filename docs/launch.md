# launch assets

## 30-second demo storyboard (screen capture, no voiceover needed)

1. 0-4s: terminal, `just demo`. Cut to the explorer conditions list: a new
   condition appears, chip says **pending**, countdown ticking.
2. 4-10s: explorer reveal detail, "before" board: eight rows of ciphertext
   hashes. Cursor hovers; nothing to see. Caption: "8 sealed bids. nobody can
   read them. not us, not the operators."
3. 10-16s: countdown hits zero. Chip flips to **frozen**. The batch pads to
   64, positions assigned. Caption: "the cue fires. the batch freezes."
4. 16-22s: share log fills in: five rows, one 48-byte share each, all
   verified. Caption: "one 48-byte share per operator. for the whole batch."
5. 22-28s: the board flips: hashes become plaintext bids, dummies dimmed,
   winner sorted to the top. Terminal shows "winner: bob with 815 👑".
6. 28-30s: end card: "Peal. your users commit. the network reveals." + repo URL + "v0. testnet
   toy."

Alternate ending for the byzantine cut: at step 4 one share row flashes red
(**rejected**), a node's log shows it was killed, and the reveal lands anyway.
Caption: "one operator lied. one died. the reveal happened anyway."

## launch snippet block

> **Peal. your users commit. the network reveals.**
>
> commit-reveal without the second transaction. sealed bids, hidden votes,
> fair reveals: one call to seal, guaranteed batch reveal, nothing readable
> early, not even by us.
>
> ```ts
> const client = new BteClient();
> const conditionId = await client.condition({ in: 60 });
> await client.seal('sealed bid: 42', conditionId);
> const reveal = await client.waitForReveal(conditionId);
> console.log(reveal.slots.map(s => s.text));
> ```
>
> playground: <PLAYGROUND_URL_PLACEHOLDER> · code: github.com/Adityaakr/batched-threshold-encryption
> · built on commonware's batched threshold encryption (eprint 2026/760)

## one-paragraph technical summary (for the commonware team)

bte wraps simple-bte, unmodified, in a reveal-later network: a coordinator
(axum + sqlite) accepts FO-transformed ciphertexts sealed client-side in wasm
against a committee from `crs::setup` (n=5, t=3, B=64, single-dealer v0),
freezes per-condition batches on wall-clock or Sepolia block-height cues,
pads them with self-sealed dummies, assigns positions by ct-hash order, and
runs `predecrypt_fft` at freeze time so the O(B log B) work is done before
any share exists. Outbound-only operator nodes hold argon2id/ChaCha20
keystores of the Shamir shares and post one 48-byte partial per batch, which
the coordinator verifies with the public pairing check before Lagrange
combination and `helper_finalize_bandwidth_optimized`; the recovered FO
randomness doubles as a per-slot integrity check so a mauled ciphertext
flags corrupt without poisoning its batch. Reveals publish plaintexts plus a
merkle root over (position, payload) that an optional Sepolia anchor
contract pins onchain and the TypeScript SDK re-derives for verification.
Measured on an M-series laptop at B=64: 245 ms pre-decrypt + 37 ms finalize,
in line with the paper's single-thread numbers. The dealer ceremony,
explorer, byzantine/liveness demos, and npm SDK (`bte-sdk`) are in the repo;
DKG and EIP-2537 onchain verification are the obvious next steps.
