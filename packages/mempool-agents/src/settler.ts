// The settler: the coordinator's on-chain arm.
//
// It watches the coordinator's reveal API for mempool-tagged conditions that
// have opened, reconstructs the batch's (position, payload) slots exactly as
// revealed, and submits PealMempool.executeBatch. The contract re-derives the
// merkle root and refuses anything that is not the revealed batch, so the
// settler cannot substitute an ordering even though it holds the key.
//
// This runs as a TS service rather than inside the Rust coordinator, so the
// shipped devnet is untouched; all chain interaction lives here.
import { sha256, toBytes, toHex } from 'viem';
import { pealMempoolAbi } from './abi.js';
import { chainFor, loadDeployment, publicClient, requireKey, walletFor } from './config.js';

const d = loadDeployment();
const pub = publicClient(d);
const wallet = walletFor(d, requireKey('DEPLOYER_PRIVATE_KEY')); // deployer == coordinator
const COORD = process.env.COORDINATOR_URL ?? 'http://localhost:8080';
const TAG = 'mempool';
const POLL_MS = 1500;

interface ConditionSummary {
  id: string;
  status: string;
  tag?: string | null;
}
interface RevealSlot {
  position: number;
  ct_hash: string;
  is_dummy: boolean;
  payload_b64: string;
}
interface Reveal {
  merkle_root: string;
  slots: RevealSlot[];
}

// `done` covers both successfully settled and permanently skipped conditions.
// Conditions already revealed when the settler boots are pre-existing (possibly
// from an older payload format) and are marked done up front, so the settler
// only ever opens batches sealed after it started.
const done = new Set<string>();

function b64ToHex(b64: string): `0x${string}` {
  return toHex(Uint8Array.from(Buffer.from(b64, 'base64')));
}

/** conditionId string -> bytes32, matching bte-sdk anchor.ts (sha256(utf8(id))). */
function cond32(id: string): `0x${string}` {
  return sha256(toBytes(id));
}

async function settle(id: string): Promise<void> {
  const key = cond32(id);
  const already = (await pub.readContract({
    address: d.pealMempool, abi: pealMempoolAbi, functionName: 'settledRoot', args: [key],
  })) as `0x${string}`;
  if (already !== `0x${'0'.repeat(64)}`) {
    done.add(id);
    return;
  }

  const reveal = (await (await fetch(`${COORD}/v0/reveals/${encodeURIComponent(id)}`)).json()) as Reveal;
  const slots = [...reveal.slots]
    .sort((a, b) => a.position - b.position)
    .map((s) => ({ position: s.position, isReal: !s.is_dummy, payload: b64ToHex(s.payload_b64) }));

  const root = (`0x${reveal.merkle_root.replace(/^0x/, '')}`) as `0x${string}`;
  const real = slots.filter((s) => s.isReal).length;
  console.log(`[settler] opening ${id.slice(0, 10)} on-chain: ${slots.length} slots, ${real} real`);

  try {
    const hash = await wallet.writeContract({
      address: d.pealMempool, abi: pealMempoolAbi, functionName: 'executeBatch',
      args: [key, slots, root], chain: chainFor(d),
    });
    const rcpt = await pub.waitForTransactionReceipt({ hash });
    done.add(id);
    console.log(`[settler] SETTLED ${id.slice(0, 10)} in ${hash} (block ${rcpt.blockNumber})`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/revert/i.test(msg)) {
      // A revert means the batch cannot settle against these contracts (e.g. a
      // payload that is not an order, or a trader without balance/approval).
      // Permanently skip it rather than retry forever.
      done.add(id);
      console.warn(`[settler] skipping ${id.slice(0, 10)}: executeBatch reverted (${msg.split('\n')[0]})`);
      return;
    }
    throw e; // transient (RPC/network): let poll retry
  }
}

async function poll(): Promise<void> {
  try {
    const body = (await (await fetch(`${COORD}/v0/conditions`)).json()) as { conditions: ConditionSummary[] };
    for (const c of body.conditions) {
      if (c.tag === TAG && c.status === 'revealed' && !done.has(c.id)) {
        await settle(c.id).catch((e) =>
          console.error(`[settler] transient on ${c.id.slice(0, 10)}:`, e instanceof Error ? e.message : e),
        );
      }
    }
  } catch (e) {
    console.error('[settler] poll error:', e instanceof Error ? e.message : e);
  }
}

/** Mark everything already revealed as handled, so only batches sealed after
 * boot get settled (older reveals may predate this payload format). */
async function snapshot(): Promise<void> {
  try {
    const body = (await (await fetch(`${COORD}/v0/conditions`)).json()) as { conditions: ConditionSummary[] };
    let n = 0;
    for (const c of body.conditions) {
      if (c.tag === TAG && c.status === 'revealed') {
        done.add(c.id);
        n++;
      }
    }
    if (n) console.log(`[settler] ignoring ${n} pre-existing revealed condition(s)`);
  } catch (e) {
    console.error('[settler] snapshot failed:', e instanceof Error ? e.message : e);
  }
}

async function main(): Promise<void> {
  console.log(`[settler] ${wallet.account.address} settling ${TAG} reveals from ${COORD} -> ${d.pealMempool}`);
  await snapshot();
  setInterval(() => void poll(), POLL_MS);
}

void main();
