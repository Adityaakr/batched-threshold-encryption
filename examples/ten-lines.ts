import { BteClient } from 'bte-sdk';

const client = new BteClient({ url: process.env.BTE_DEVNET_URL ?? 'http://localhost:8080' });
const conditionId = await client.condition({ in: 5 });
console.log(`sealed bid goes in; nobody can read it until the cue (${conditionId})`);
await client.seal('sealed bid: 42', conditionId);
const reveal = await client.waitForReveal(conditionId);
for (const slot of reveal.slots.filter((s) => !s.isDummy)) {
  console.log('revealed on cue:', slot.text);
}
