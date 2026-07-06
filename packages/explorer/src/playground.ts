// The playground: seal a secret in this browser tab, watch the network
// reveal it on cue. Sealing runs in bte-sdk's wasm; only the ciphertext
// leaves the tab. A live trace narrates every stage with the real
// artifacts: the actual KEM header bytes, the real hash, the measured
// FFT and finalize times.
import { BteClient } from 'bte-sdk';
import { API_BASE, getCondition, getReveal, type ConditionDetail } from './api';
import { esc, fmtCountdown, truncMiddle } from './util';

const POLL_MS = 1500;

interface PlaygroundRun {
  conditionId: string;
  ctHash: string;
  secret: string;
  n: number;
  t: number;
  b: number;
  digest: string;
  /** Parsed from the real wire bytes: [k]_1 KEM header + payload length. */
  ct0hex: string;
  payloadLen: number;
}

type StepState = 'todo' | 'active' | 'done';

interface TraceStep {
  label: string;
  detail: string;
  state: StepState;
}

function b64Bytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function hex(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function renderPlayground(host: HTMLElement): () => void {
  const client = new BteClient({ url: API_BASE });
  let run: PlaygroundRun | null = null;
  let pollTimer: number | undefined;
  let tickTimer: number | undefined;
  let condition: ConditionDetail | null = null;
  let done = false;
  let steps: TraceStep[] = [];

  host.innerHTML = `
    <div class="playground card" id="pg">
      <form id="pg-form" autocomplete="off">
        <label class="field-label" for="pg-secret">your secret</label>
        <div class="pg-row">
          <input id="pg-secret" name="secret" type="text" maxlength="200" required
                 placeholder="a bid, a vote, a prediction…" />
          <select id="pg-delay" aria-label="reveal delay">
            <option value="30">reveal in 30s</option>
            <option value="60" selected>reveal in 60s</option>
            <option value="120">reveal in 2m</option>
          </select>
          <button type="submit" class="btn btn-primary" id="pg-seal">seal it</button>
        </div>
        <p class="field-hint">encrypted in this tab with wasm. nobody can read it early, us included.</p>
        <p class="error" id="pg-error" hidden></p>
      </form>
      <div id="pg-live" hidden></div>
    </div>
  `;

  const form = host.querySelector<HTMLFormElement>('#pg-form')!;
  const input = host.querySelector<HTMLInputElement>('#pg-secret')!;
  const delaySel = host.querySelector<HTMLSelectElement>('#pg-delay')!;
  const sealBtn = host.querySelector<HTMLButtonElement>('#pg-seal')!;
  const errorEl = host.querySelector<HTMLElement>('#pg-error')!;
  const liveEl = host.querySelector<HTMLElement>('#pg-live')!;

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    void seal();
  });

  function initSteps(): void {
    steps = [
      { label: 'fetch committee params', detail: '', state: 'todo' },
      { label: 'encrypt in wasm (FO transform)', detail: '', state: 'todo' },
      { label: 'content-address the ciphertext', detail: '', state: 'todo' },
      { label: 'post to the coordinator', detail: '', state: 'todo' },
      { label: 'cue fires, batch freezes', detail: '', state: 'todo' },
      { label: 'operators post one 48-byte share each', detail: '', state: 'todo' },
      { label: 'combine any t shares, recover every slot', detail: '', state: 'todo' },
    ];
  }

  function setStep(i: number, state: StepState, detail?: string): void {
    steps[i].state = state;
    if (detail !== undefined) steps[i].detail = detail;
  }

  async function seal(): Promise<void> {
    const secret = input.value.trim();
    if (!secret) return;
    errorEl.hidden = true;
    sealBtn.disabled = true;
    sealBtn.setAttribute('aria-busy', 'true');
    sealBtn.textContent = 'sealing…';
    initSteps();
    try {
      // The real work happens in these awaits; the trace then replays the
      // stages with the genuine artifacts each one produced.
      setStep(0, 'active');
      const committee = await client.committee();
      const conditionId = await client.condition({ in: Number(delaySel.value) });
      setStep(0, 'done',
        `digest ${committee.digest.slice(0, 12)}…, n=${committee.n} t=${committee.t} B=${committee.b}, re-checked against the wasm parse`);

      setStep(1, 'active');
      const { ctHash, sealedB64 } = await client.seal(secret, conditionId);
      const wire = b64Bytes(sealedB64);
      const ct0hex = hex(wire.slice(5, 53));
      const payloadLen = wire.length - 73;
      run = {
        conditionId,
        ctHash,
        secret,
        n: committee.n,
        t: committee.t,
        b: committee.b,
        digest: committee.digest,
        ct0hex,
        payloadLen,
      };
      done = false;
      condition = null;
      form.hidden = true;
      renderLive();

      // Perceivable pacing only; every value shown is real.
      await sleep(500);
      setStep(1, 'done',
        `KEM header [k]₁ = ${ct0hex.slice(0, 20)}… (48 bytes), key mask 16 bytes, body ${payloadLen} bytes of keystream`);
      renderLive();
      await sleep(500);
      setStep(2, 'done', `ct_hash = sha256(wire) = ${ctHash.slice(0, 20)}…`);
      setStep(3, 'active');
      renderLive();
      await sleep(500);
      setStep(3, 'done', `stored. ${wire.length} ciphertext bytes are all that ever left this tab`);
      setStep(4, 'active');
      renderLive();
      startPolling();
    } catch (err) {
      form.hidden = false;
      liveEl.hidden = true;
      errorEl.textContent = `sealing failed. ${String(err)}. is the devnet up? try: just compose-up`;
      errorEl.hidden = false;
    } finally {
      sealBtn.disabled = false;
      sealBtn.removeAttribute('aria-busy');
      sealBtn.textContent = 'seal it';
    }
  }

  function startPolling(): void {
    stopPolling();
    pollTimer = window.setInterval(() => void poll(), POLL_MS);
    tickTimer = window.setInterval(renderLive, 1000);
    void poll();
  }

  function stopPolling(): void {
    if (pollTimer !== undefined) clearInterval(pollTimer);
    if (tickTimer !== undefined) clearInterval(tickTimer);
    pollTimer = tickTimer = undefined;
  }

  /** Feed live coordinator state into trace steps 5-7. */
  function syncSteps(): void {
    if (!run || !condition) return;
    const batch = condition.batches?.[0];
    const verified = batch?.verified_shares ?? 0;
    const status = condition.status;

    if (status === 'frozen' || status === 'stalled' || status === 'revealed') {
      const pre = batch?.predecrypt_ms;
      setStep(4, 'done',
        pre != null
          ? `positions assigned by hash order, dummies padded to ${run.b}. FFT cross-terms precomputed in ${pre} ms, before any share existed (pipelined)`
          : `positions assigned by hash order, dummies padded to ${run.b}. FFT cross-terms computing…`);
      setStep(5, verified >= run.t ? 'done' : 'active',
        `${verified} verified, ${run.t} needed. each checked publicly: e(pd_j, g₂) = Σ e(ct_i, v_j^i)`);
      if (verified >= run.t) {
        setStep(6, status === 'revealed' ? 'done' : 'active',
          status === 'revealed' && batch?.finalize_ms != null
            ? `Lagrange combine + finalize in ${batch.finalize_ms} ms. all ${run.b} slots opened at once`
            : 'Lagrange combine + finalize running…');
      }
    }
  }

  async function poll(): Promise<void> {
    if (!run || done) return;
    try {
      condition = await getCondition(run.conditionId);
    } catch {
      return; // transient; next poll retries
    }
    syncSteps();
    if (condition.status === 'revealed') {
      const reveal = await getReveal(run.conditionId).catch(() => null);
      if (reveal) {
        done = true;
        stopPolling();
        const batch = condition.batches?.[0];
        setStep(5, 'done');
        setStep(6, 'done',
          batch?.finalize_ms != null
            ? `Lagrange combine + finalize in ${batch.finalize_ms} ms. all ${run.b} slots opened at once`
            : `all ${run.b} slots opened at once`);
        const mine = reveal.slots.find((s) => s.ct_hash === run!.ctHash);
        renderRevealed(mine != null && mine.valid);
        return;
      }
    }
    renderLive();
  }

  function traceHtml(): string {
    const items = steps
      .map((s) => {
        const detail = s.detail
          ? `<span class="trace-detail mono">${esc(s.detail)}</span>`
          : '';
        return `<li class="trace-step trace-${s.state}">
          <span class="trace-marker" aria-hidden="true"></span>
          <span class="trace-body"><span class="trace-label">${esc(s.label)}</span>${detail}</span>
        </li>`;
      })
      .join('');
    return `<ol class="trace" aria-label="what is happening behind the scenes">${items}</ol>`;
  }

  let lastRest = '';

  /** Stage line + operator share dots + crypto trace while in flight.
   * The countdown line re-renders every second; the dots and trace only
   * re-render when their state actually changes, so their animations keep
   * their phase instead of restarting each tick. */
  function renderLive(): void {
    if (!run || done) return;
    const status = condition?.status ?? 'pending';
    const firesAt = condition?.fires_at ?? null;
    const secs = firesAt != null ? firesAt - Math.floor(Date.now() / 1000) : null;
    const batch = condition?.batches?.[0];
    const verified = batch?.verified_shares ?? 0;

    if (liveEl.hidden || !liveEl.querySelector('#pg-rest')) {
      liveEl.hidden = false;
      liveEl.innerHTML = `
        <div class="pg-stage">
          <div class="pg-sealed-row">
            <span class="sealed-label">sealed</span>
            <button type="button" class="hash-copy mono" data-copy="${esc(run.ctHash)}"
                    title="copy ciphertext hash">${esc(truncMiddle(run.ctHash, 14, 10))}</button>
          </div>
          <p class="pg-status" id="pg-head"></p>
          <div id="pg-rest"></div>
          <p class="pg-links">
            <a class="link" href="#/condition/${encodeURIComponent(run.conditionId)}">watch it in the explorer</a>
          </p>
        </div>
      `;
      wireCopy(liveEl);
      lastRest = '';
    }

    let stage: string;
    if (status === 'stalled') {
      stage = `<span class="error">stalled. fewer than ${run.t} shares arrived in time. it recovers if late shares show up.</span>`;
    } else if (status === 'frozen') {
      stage = `batch frozen. operators are posting shares: <strong class="num">${verified}</strong> verified, <strong class="num">${run.t}</strong> needed`;
    } else if (secs != null && secs > 0) {
      stage = `sealed. reveals in <strong class="num accent">${esc(fmtCountdown(secs))}</strong>`;
    } else {
      stage = 'cue reached. freezing the batch…';
    }
    liveEl.querySelector('#pg-head')!.innerHTML = stage;

    const dots = Array.from({ length: run.n }, (_, i) => {
      const cls =
        status === 'frozen' || status === 'revealed'
          ? i < verified
            ? 'dot dot-done'
            : 'dot dot-wait'
          : 'dot';
      return `<span class="${cls}" title="operator ${i + 1}"></span>`;
    }).join('');
    const rest = `
      <div class="pg-operators" role="img" aria-label="${verified} of ${run.n} operator shares verified">
        ${dots}
        <span class="pg-operators-label">committee, any ${run.t} of ${run.n} reveal</span>
      </div>
      ${traceHtml()}
    `;
    if (rest !== lastRest) {
      liveEl.querySelector('#pg-rest')!.innerHTML = rest;
      lastRest = rest;
    }
  }

  function renderRevealed(valid: boolean): void {
    if (!run) return;
    liveEl.innerHTML = `
      <div class="pg-stage pg-revealed reveal-in">
        <div class="pg-sealed-row">
          <span class="sealed-label sealed-label-open">revealed</span>
          <span class="mono muted">${esc(truncMiddle(run.ctHash, 14, 10))}</span>
        </div>
        <p class="pg-secret-out">${valid ? esc(run.secret) : '<span class="error">slot flagged corrupt</span>'}</p>
        <p class="muted">everyone can read it now. that is the whole trick: unreadable before the cue, public after.</p>
        ${traceHtml()}
        <p class="pg-links">
          <a class="link" href="#/condition/${encodeURIComponent(run.conditionId)}">see the full reveal, shares and timings</a>
          <button type="button" class="btn" id="pg-again">seal another</button>
        </p>
      </div>
    `;
    lastRest = '';
    liveEl.querySelector<HTMLButtonElement>('#pg-again')?.addEventListener('click', () => {
      run = null;
      liveEl.hidden = true;
      liveEl.innerHTML = '';
      form.hidden = false;
      input.value = '';
      input.focus();
    });
  }

  return () => stopPolling();
}

/** Copy-to-clipboard with a 1.5s transient "copied" state. */
export function wireCopy(scope: HTMLElement): void {
  scope.querySelectorAll<HTMLButtonElement>('[data-copy]').forEach((btn) => {
    if (btn.dataset.wired) return;
    btn.dataset.wired = '1';
    const original = btn.innerHTML;
    btn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(btn.dataset.copy ?? '');
        btn.classList.add('copied');
        btn.textContent = 'copied';
        setTimeout(() => {
          btn.classList.remove('copied');
          btn.innerHTML = original;
        }, 1500);
      } catch {
        // clipboard unavailable (http origin): leave the hash visible
      }
    });
  });
}
