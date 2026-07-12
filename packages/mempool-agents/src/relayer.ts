// The relayer: the browser's sponsored, no-wallet gateway to the chain.
//
// The visitor signs nothing. The relayer holds a funded key, and on the
// visitor's behalf it submits the public-lane order (in the clear) and the
// peal-lane commitment (a hash). It also serves read endpoints so the browser
// stays a thin fetch client with no chain library of its own: current reserves,
// and the on-chain results of a given order / condition so the page can link
// straight to the block explorer.
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import {
  decodeEventLog,
  formatEther,
  parseEther,
  sha256,
  toBytes,
  type Address,
  type Hex,
} from 'viem';
import { erc20Abi, pealMempoolAbi, publicBuilderAbi, swapPoolAbi } from './abi.js';
import { chainFor, loadDeployment, publicClient, requireKey, serializer, walletFor } from './config.js';

const d = loadDeployment();
const pub = publicClient(d);
const wallet = walletFor(d, requireKey('RELAYER_PRIVATE_KEY'));
const relayer = wallet.account.address;
const PORT = Number(process.env.RELAYER_PORT ?? 8799);
// Serialize every relayer send: concurrent visitor requests share one key.
const tx = serializer();

let bootBlock = 0n;

async function ensureApproval(token: Address, spender: Address): Promise<void> {
  const allowance = await pub.readContract({
    address: token, abi: erc20Abi, functionName: 'allowance', args: [relayer, spender],
  });
  if (allowance > 10n ** 30n) return;
  const hash = await tx(() =>
    wallet.writeContract({
      address: token, abi: erc20Abi, functionName: 'approve', args: [spender, 2n ** 256n - 1n],
      chain: chainFor(d),
    }),
  );
  await pub.waitForTransactionReceipt({ hash });
}

async function reserves(pool: Address): Promise<{ base: string; quote: string }> {
  // Raw wei strings: the browser needs contract-precision reserves to size
  // amountIn/minOut so its quote matches what the pool will actually give.
  const [base, quote] = await Promise.all([
    pub.readContract({ address: pool, abi: swapPoolAbi, functionName: 'reserveBase' }),
    pub.readContract({ address: pool, abi: swapPoolAbi, functionName: 'reserveQuote' }),
  ]);
  return { base: base.toString(), quote: quote.toString() };
}

// ---- handlers -----------------------------------------------------------

async function config() {
  return {
    chainId: d.chainId,
    explorerBase: d.explorerBase,
    relayer,
    publicPool: d.publicPool,
    publicBuilder: d.publicBuilder,
    pealPool: d.pealPool,
    pealMempool: d.pealMempool,
  };
}

async function state() {
  const [pubR, pealR] = await Promise.all([reserves(d.publicPool), reserves(d.pealPool)]);
  return { publicPool: pubR, pealPool: pealR };
}

/** Submit the public-lane order in the clear, on the visitor's behalf. */
async function publicSwap(body: { amountIn: string; minOut: string; baseToQuote: boolean }) {
  const order = {
    trader: relayer,
    baseToQuote: body.baseToQuote,
    amountIn: parseEther(body.amountIn),
    minOut: parseEther(body.minOut),
    to: relayer,
  };
  const hash = await tx(() =>
    wallet.writeContract({
      address: d.publicBuilder, abi: publicBuilderAbi, functionName: 'submitOrder',
      args: [order], chain: chainFor(d),
    }),
  );
  const rcpt = await pub.waitForTransactionReceipt({ hash });
  let orderId: Hex | null = null;
  for (const log of rcpt.logs) {
    try {
      const ev = decodeEventLog({ abi: publicBuilderAbi, data: log.data, topics: log.topics });
      if (ev.eventName === 'Pending') orderId = (ev.args as { id: Hex }).id;
    } catch {
      /* not a builder event */
    }
  }
  return { txHash: hash, orderId };
}

/** Record the sealed order on the peal lane: only the ciphertext hash. */
async function commit(body: { conditionId: string; ctHash: string }) {
  const cond = sha256(toBytes(body.conditionId));
  const ct = (`0x${body.ctHash.replace(/^0x/, '')}`) as Hex;
  const hash = await tx(() =>
    wallet.writeContract({
      address: d.pealMempool, abi: pealMempoolAbi, functionName: 'commitSealed',
      args: [cond, ct], chain: chainFor(d),
    }),
  );
  await pub.waitForTransactionReceipt({ hash });
  return { txHash: hash };
}

/** The public order's fate: sandwiched (with the numbers) or honestly filled. */
async function publicResult(orderId: Hex) {
  const [sandwiched, executed] = await Promise.all([
    pub.getContractEvents({
      address: d.publicBuilder, abi: publicBuilderAbi, eventName: 'Sandwiched',
      args: { id: orderId }, fromBlock: bootBlock,
    }),
    pub.getContractEvents({
      address: d.publicBuilder, abi: publicBuilderAbi, eventName: 'Executed',
      args: { id: orderId }, fromBlock: bootBlock,
    }),
  ]);
  if (sandwiched.length > 0) {
    const a = sandwiched[0].args as { victimOut: bigint; searcherProfit: bigint };
    return {
      done: true, sandwiched: true,
      victimOut: formatEther(a.victimOut), profit: formatEther(a.searcherProfit),
      txHash: sandwiched[0].transactionHash,
    };
  }
  if (executed.length > 0) {
    const a = executed[0].args as { amountOut: bigint };
    return { done: true, sandwiched: false, victimOut: formatEther(a.amountOut), profit: '0', txHash: executed[0].transactionHash };
  }
  return { done: false };
}

/** The sealed order's fate: settled on-chain at reveal, with the fill. */
async function pealResult(conditionId: string) {
  const cond = sha256(toBytes(conditionId));
  const [batch, fills] = await Promise.all([
    pub.getContractEvents({
      address: d.pealMempool, abi: pealMempoolAbi, eventName: 'BatchExecuted',
      args: { conditionId: cond }, fromBlock: bootBlock,
    }),
    pub.getContractEvents({
      address: d.pealMempool, abi: pealMempoolAbi, eventName: 'OrderFilled',
      args: { conditionId: cond }, fromBlock: bootBlock,
    }),
  ]);
  if (batch.length === 0) return { done: false };
  const a = batch[0].args as { realCount: bigint; merkleRoot: Hex };
  return {
    done: true, realCount: Number(a.realCount), merkleRoot: a.merkleRoot,
    txHash: batch[0].transactionHash,
    fills: fills.map((f) => {
      const fa = f.args as { position: number; amountOut: bigint };
      return { position: fa.position, amountOut: formatEther(fa.amountOut) };
    }),
  };
}

// ---- http plumbing ------------------------------------------------------

function send(res: ServerResponse, code: number, body: unknown): void {
  const data = JSON.stringify(body);
  res.writeHead(code, {
    'content-type': 'application/json',
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'content-type',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
  });
  res.end(data);
}

function readBody(req: IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
    if (req.method === 'OPTIONS') return send(res, 204, {});
    if (req.method === 'GET' && url.pathname === '/config') return send(res, 200, await config());
    if (req.method === 'GET' && url.pathname === '/state') return send(res, 200, await state());
    if (req.method === 'GET' && url.pathname === '/public-result') {
      const id = url.searchParams.get('orderId') as Hex;
      return send(res, 200, await publicResult(id));
    }
    if (req.method === 'GET' && url.pathname === '/peal-result') {
      return send(res, 200, await pealResult(url.searchParams.get('conditionId') ?? ''));
    }
    if (req.method === 'POST' && url.pathname === '/public-swap') return send(res, 200, await publicSwap(await readBody(req)));
    if (req.method === 'POST' && url.pathname === '/commit') return send(res, 200, await commit(await readBody(req)));
    send(res, 404, { error: 'not found' });
  } catch (e) {
    console.error('[relayer]', e instanceof Error ? e.message : e);
    send(res, 500, { error: e instanceof Error ? e.message : String(e) });
  }
});

async function main(): Promise<void> {
  bootBlock = await pub.getBlockNumber();
  // Sequential: these all send from the relayer key, and firing them together
  // would hand the same nonce to every approval. Approve the POOLS, not the
  // builders: the pool is what calls transferFrom on a trader's tokens.
  await ensureApproval(d.usdc, d.publicPool);
  await ensureApproval(d.eth, d.publicPool);
  await ensureApproval(d.usdc, d.pealPool);
  await ensureApproval(d.eth, d.pealPool);
  server.listen(PORT, () => console.log(`[relayer] ${relayer} listening on :${PORT} (from block ${bootBlock})`));
}

void main();
