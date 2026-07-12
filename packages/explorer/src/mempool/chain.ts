// Browser-side client for the live encrypted-mempool demo.
//
// Talks to the relayer (sponsored, no wallet) for on-chain writes and reads,
// and encodes the sealed order the exact way PealMempool.executeBatch decodes
// it. The order rides through the real coordinator sealed, so the payload here
// is what the committee opens and what the contract settles.

const RELAYER = import.meta.env.VITE_RELAYER_URL ?? 'http://localhost:8799';

export interface MempoolConfig {
  chainId: number;
  explorerBase: string;
  relayer: `0x${string}`;
  publicPool: `0x${string}`;
  publicBuilder: `0x${string}`;
  pealPool: `0x${string}`;
  pealMempool: `0x${string}`;
}

export interface PoolState {
  /** Reserves in wei. */
  base: bigint;
  quote: bigint;
}

async function j<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${RELAYER}${path}`, init);
  if (!res.ok) throw new Error(`relayer ${path} -> ${res.status}`);
  return res.json() as Promise<T>;
}

export function getConfig(): Promise<MempoolConfig> {
  return j<MempoolConfig>('/config');
}

export async function getState(): Promise<{ publicPool: PoolState; pealPool: PoolState }> {
  const raw = await j<{ publicPool: { base: string; quote: string }; pealPool: { base: string; quote: string } }>(
    '/state',
  );
  const p = (s: { base: string; quote: string }) => ({ base: BigInt(s.base), quote: BigInt(s.quote) });
  return { publicPool: p(raw.publicPool), pealPool: p(raw.pealPool) };
}

export function commitSealed(conditionId: string, ctHash: string): Promise<{ txHash: string }> {
  return j('/commit', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ conditionId, ctHash }),
  });
}

export function submitPublicSwap(body: {
  amountIn: string;
  minOut: string;
  baseToQuote: boolean;
}): Promise<{ txHash: string; orderId: `0x${string}` }> {
  return j('/public-swap', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export interface PublicResult {
  done: boolean;
  sandwiched?: boolean;
  victimOut?: string;
  profit?: string;
  txHash?: string;
}

export function getPublicResult(orderId: string): Promise<PublicResult> {
  return j<PublicResult>(`/public-result?orderId=${orderId}`);
}

export interface PealResult {
  done: boolean;
  realCount?: number;
  merkleRoot?: string;
  txHash?: string;
  fills?: Array<{ position: number; amountOut: string }>;
}

export function getPealResult(conditionId: string): Promise<PealResult> {
  return j<PealResult>(`/peal-result?conditionId=${encodeURIComponent(conditionId)}`);
}

// ---- amounts, at contract precision ------------------------------------

const FEE_NUM = 997n;
const FEE_DEN = 1000n;

/** Matches SwapPool.getAmountOut exactly. */
export function getAmountOut(amountIn: bigint, reserveIn: bigint, reserveOut: bigint): bigint {
  if (amountIn <= 0n) return 0n;
  const inWithFee = amountIn * FEE_NUM;
  return (reserveOut * inWithFee) / (reserveIn * FEE_DEN + inWithFee);
}

const WAD = 10n ** 18n;

export function toWad(whole: number): bigint {
  // Parse a human decimal to wei without floating error for typical inputs.
  const [int, frac = ''] = String(whole).split('.');
  const fracPadded = (frac + '0'.repeat(18)).slice(0, 18);
  return BigInt(int || '0') * WAD + BigInt(fracPadded || '0');
}

export function fromWad(wei: bigint, dp = 4): string {
  const neg = wei < 0n;
  const abs = neg ? -wei : wei;
  const whole = abs / WAD;
  const frac = (abs % WAD).toString().padStart(18, '0').slice(0, dp);
  return `${neg ? '-' : ''}${whole}.${frac}`;
}

/** The swap order, abi-encoded to the 160 bytes the contract decodes. */
export function encodeOrder(o: {
  trader: `0x${string}`;
  baseToQuote: boolean;
  amountIn: bigint;
  minOut: bigint;
  to: `0x${string}`;
}): Uint8Array {
  const out = new Uint8Array(160);
  const addr = (hex: string, wordStart: number) => {
    const bytes = hexToBytes(hex);
    out.set(bytes, wordStart + 32 - 20);
  };
  const uint = (x: bigint, wordStart: number) => {
    let v = x;
    for (let i = 31; i >= 0; i--) {
      out[wordStart + i] = Number(v & 0xffn);
      v >>= 8n;
    }
  };
  addr(o.trader, 0);
  out[63] = o.baseToQuote ? 1 : 0;
  uint(o.amountIn, 64);
  uint(o.minOut, 96);
  addr(o.to, 128);
  return out;
}

function hexToBytes(hex: string): Uint8Array {
  const h = hex.replace(/^0x/, '');
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function txUrl(cfg: MempoolConfig, hash: string): string | null {
  if (!cfg.explorerBase) return null;
  return `${cfg.explorerBase.replace(/\/$/, '')}/tx/${hash}`;
}
