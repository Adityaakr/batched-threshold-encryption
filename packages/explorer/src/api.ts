/** Typed fetch helpers for the coordinator REST API (/v0). */

// Same-origin by default: vite's dev/preview proxy (vite.config.ts) or the
// production Caddy edge forwards /v0 to the coordinator. Set VITE_BTE_URL at
// build time only to talk to a coordinator on another origin directly.
const BASE: string = import.meta.env.VITE_BTE_URL ?? '';

export interface CommitteeDetail {
  id: string;
  n: number;
  t: number;
  b: number;
  params_b64: string;
  params_digest: string;
  created_at: number;
}

export interface ConditionSummary {
  id: string;
  committee_id: string;
  kind: string;
  fires_at: number | null;
  status: 'pending' | 'frozen' | 'revealed' | 'stalled';
  created_at: number;
  /** Client label set at creation (round:bid, round:vote, capsule). */
  tag?: string | null;
  ciphertext_count: number;
  real_count: number;
}

export interface Batch {
  batch_id: number;
  batch_index: number;
  frozen_at?: number;
  finalized_at?: number | null;
  predecrypt_ms: number | null;
  finalize_ms: number | null;
  /** Live share progress (present on /v0/conditions/:id). */
  verified_shares?: number;
  total_shares?: number;
}

export const API_BASE = BASE;

export interface ConditionDetail extends ConditionSummary {
  chain_id: number | null;
  height: number | null;
  batches: Batch[];
}

export interface RevealSlot {
  position: number;
  ct_hash: string;
  is_dummy: boolean;
  valid: boolean;
  payload_b64: string;
}

export interface ShareEntry {
  batch_id: number;
  operator_id: number;
  verified: boolean;
  submitted_at_ms: number;
}

export interface Reveal {
  condition_id: string;
  revealed_at: number;
  merkle_root: string;
  slots: RevealSlot[];
  shares: ShareEntry[];
  batches: Batch[];
}

/** Fetch JSON with a human error when something other than the bte
 * coordinator answers (a stray dev server on the same port returns HTML). */
async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`);
  const type = res.headers.get('content-type') ?? '';
  if (!type.includes('application/json')) {
    const where = BASE || window.location.origin;
    throw new Error(
      `${where} answered ${path} with ${type.split(';')[0] || 'no content type'}, not JSON. ` +
        `that is not the bte coordinator. it usually means another dev server holds the port. ` +
        `restart with: BTE_URL=http://localhost:<coordinator port> pnpm dev`,
    );
  }
  if (!res.ok) {
    let detail = '';
    try {
      detail = ((await res.json()) as { error?: string }).error ?? '';
    } catch {
      // body was not JSON after all
    }
    throw new Error(detail || `GET ${path} failed with ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export function getCommittee(): Promise<CommitteeDetail> {
  return get<CommitteeDetail>('/v0/committees/default');
}

export async function listConditions(): Promise<ConditionSummary[]> {
  const body = await get<{ conditions: ConditionSummary[] }>('/v0/conditions');
  return body.conditions;
}

export function getCondition(id: string): Promise<ConditionDetail> {
  return get<ConditionDetail>(`/v0/conditions/${encodeURIComponent(id)}`);
}

/** Returns null while the condition is not revealed (the API 404s). */
export async function getReveal(conditionId: string): Promise<Reveal | null> {
  const res = await fetch(`${BASE}/v0/reveals/${encodeURIComponent(conditionId)}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GET /v0/reveals failed with ${res.status}`);
  const type = res.headers.get('content-type') ?? '';
  if (!type.includes('application/json')) {
    throw new Error('non-JSON reveal response; wrong server on this port?');
  }
  return res.json() as Promise<Reveal>;
}
