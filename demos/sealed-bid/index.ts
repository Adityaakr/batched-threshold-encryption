// Sealed-bid auction demo: 8 bidders seal {name, bid} to a condition that
// fires in 60 seconds. Until then the board shows only ciphertext hashes.
// On cue the committee reveals every bid at once; highest bid wins.
//
// Flags:
//   --in-secs N            condition delay (default 60)
//   --expect-rejected N    assert exactly N rejected shares in the reveal log
//   --expect-verified N    assert exactly N verified shares
import { BteClient } from 'bte-sdk';

const arg = (name: string): string | undefined => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

const inSecs = Number(arg('in-secs') ?? 60);
const expectRejected = arg('expect-rejected');
const expectVerified = arg('expect-verified');

const client = new BteClient({ url: process.env.BTE_DEVNET_URL ?? 'http://localhost:8080' });

const committee = await client.committee();
console.log(`committee: ${committee.n} operators, threshold ${committee.t}, batch size ${committee.b}\n`);

const conditionId = await client.condition({ in: inSecs });
console.log(`auction closes in ${inSecs}s (condition ${conditionId})\n`);

const bidders = ['alice', 'bob', 'carol', 'dave', 'erin', 'frank', 'grace', 'heidi'];
const bids = bidders.map((name) => ({ name, bid: 100 + Math.floor(Math.random() * 900) }));

console.log('sealed board (nobody, operators included, can read these):');
const sealedAt = Date.now();
for (const bid of bids) {
  const { ctHash } = await client.seal(JSON.stringify(bid), conditionId);
  console.log(`  ${bid.name.padEnd(6)} -> ${ctHash.slice(0, 20)}…${ctHash.slice(-8)}`);
}
console.log();

console.log('waiting for the cue (freeze -> one 48-byte share per operator -> reveal)…');
const reveal = await client.waitForReveal(conditionId, { timeoutMs: 300_000 });
console.log(`revealed ${((Date.now() - sealedAt) / 1000).toFixed(1)}s after sealing\n`);

const revealed = reveal.slots
  .filter((s) => !s.isDummy && s.valid && s.text)
  .map((s) => JSON.parse(s.text!) as { name: string; bid: number })
  .sort((a, b) => b.bid - a.bid);

console.log('revealed bids:');
for (const { name, bid } of revealed) {
  console.log(`  ${name.padEnd(6)} ${String(bid).padStart(4)}`);
}

// The demo knows the bids it sealed; the reveal must match exactly.
const expected = [...bids].sort((a, b) => b.bid - a.bid);
if (JSON.stringify(revealed) !== JSON.stringify(expected)) {
  console.error('\nFAIL: revealed bids do not match sealed bids');
  process.exit(1);
}

const winner = revealed[0];
console.log(`\nwinner: ${winner.name} with ${winner.bid} 👑`);

const verified = reveal.shares.filter((s) => s.verified).length;
const rejected = reveal.shares.filter((s) => !s.verified).length;
console.log(`share log: ${verified} verified, ${rejected} rejected (flagged, never used)`);
console.log(`merkle root: ${reveal.merkleRoot}`);

if (expectRejected !== undefined && rejected !== Number(expectRejected)) {
  console.error(`FAIL: expected ${expectRejected} rejected shares, saw ${rejected}`);
  process.exit(1);
}
if (expectVerified !== undefined && verified !== Number(expectVerified)) {
  console.error(`FAIL: expected ${expectVerified} verified shares, saw ${verified}`);
  process.exit(1);
}
const dummies = reveal.slots.filter((s) => s.isDummy).length;
console.log(`(${dummies} dummy slots padded the batch, marked as such)`);
console.log('\ndemo PASS');
