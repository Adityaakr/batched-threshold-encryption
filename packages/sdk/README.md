# bte-sdk

**seal now. reveal on cue.** Commit-reveal without the second transaction.

Seal data to a t-of-n committee running [bte](https://github.com/Adityaakr/bte);
when the condition fires, the whole batch is revealed to everyone. Nothing is
readable early, not even by the operators.

```ts
import { BteClient } from 'bte-sdk';

const client = new BteClient({ url: 'http://localhost:8080' });
const conditionId = await client.condition({ in: 60 });
await client.seal('sealed bid: 42', conditionId);
const reveal = await client.waitForReveal(conditionId);
console.log(reveal.slots.filter(s => !s.isDummy).map(s => s.text));
```

Sealing runs client-side in wasm (inlined, zero bundler config in vite, next,
and node). Client-side share verification ships separately as `bte-sdk/verify`.

> v0: dealer-trusted setup. do not protect real value with this.

Apache-2.0. Built on commonwarexyz/simple-bte (eprint 2026/760).
