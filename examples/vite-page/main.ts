// Vite needs zero config: the wasm is inlined inside bte-sdk.
import { BteClient } from 'bte-sdk';

const log = (line: string) => {
  document.querySelector('#log')!.textContent += line + '\n';
};

document.querySelector('#go')!.addEventListener('click', async () => {
  const client = new BteClient({ url: 'http://localhost:8080' });
  const conditionId = await client.condition({ in: 5 });
  log(`condition ${conditionId} fires in 5s`);
  const { ctHash } = await client.seal(`browser bid @ ${new Date().toISOString()}`, conditionId);
  log(`sealed: ${ctHash.slice(0, 16)}… (only the ciphertext left this tab)`);
  const reveal = await client.waitForReveal(conditionId);
  for (const slot of reveal.slots.filter((s) => !s.isDummy)) {
    log(`revealed: ${slot.text}`);
  }
});
