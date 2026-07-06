// The playground: seal into the network from this tab and watch the reveal
// land on cue. Three scenarios show what reveal-later encryption is for:
//   sealed bid   -> joins a shared round; highest bid wins at reveal
//   hidden vote  -> joins a shared round; the tally appears all at once
//   time capsule -> your own note, revealed to everyone later
// Sealing runs in bte-sdk's wasm; only the ciphertext leaves the tab. A live
// trace narrates every stage with the real artifacts.
import { BteClient } from 'bte-sdk';
import {
  API_BASE,
  getCondition,
  getReveal,
  listConditions,
  type ConditionDetail,
  type Reveal,
} from './api';
import { decodePayload, esc, fmtCountdown, truncMiddle } from './util';

const POLL_MS = 1500;
const ROUND_SECS = 60;
/** Do not join a round about to freeze; sealing would race the cue. */
const MIN_JOIN_SECS = 12;

type Scenario = 'bid' | 'vote' | 'note';

interface PlaygroundRun {
  conditionId: string;
  ctHash: string;
  scenario: Scenario;
  /** What this tab sealed, for the "you" marker and the capsule view. */
  summary: string;
  n: number;
  t: number;
  b: number;
}

type StepState = 'todo' | 'active' | 'done';

interface TraceStep {
  label: string;
  detail: string;
  state: StepState;
}

interface Entry {
  ctHash: string;
  kind: 'bid' | 'vote' | 'text';
  name: string;
  amt?: number;
  choice?: string;
  text?: string;
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

/** Recipient-side link: countdown first, content after the cue. */
function sealLink(run: { conditionId: string; ctHash: string }): string {
  return `${location.origin}${location.pathname}#/s/${encodeURIComponent(run.conditionId)}/${run.ctHash}`;
}

/** Parse a revealed slot into a playground entry (bids/votes are JSON). */
function parseEntry(ctHash: string, text: string): Entry {
  try {
    const p = JSON.parse(text);
    if (p && p.k === 'bid' && typeof p.amt === 'number') {
      return { ctHash, kind: 'bid', name: String(p.name || 'anon'), amt: p.amt };
    }
    if (p && p.k === 'vote' && typeof p.choice === 'string') {
      return { ctHash, kind: 'vote', name: String(p.name || 'anon'), choice: p.choice };
    }
  } catch {
    // plain text payload
  }
  return { ctHash, kind: 'text', name: 'anon', text };
}

export function renderPlayground(host: HTMLElement): () => void {
  const client = new BteClient({ url: API_BASE });
  let scenario: Scenario = 'bid';
  let run: PlaygroundRun | null = null;
  let pollTimer: number | undefined;
  let tickTimer: number | undefined;
  let condition: ConditionDetail | null = null;
  let done = false;
  let steps: TraceStep[] = [];
  let lastRest = '';

  host.innerHTML = `
    <div class="playground card" id="pg">
      <form id="pg-form" autocomplete="off">
        <div class="chips" role="group" aria-label="pick a scenario">
          <button type="button" class="chip-btn" data-scenario="bid" aria-pressed="true">sealed bid</button>
          <button type="button" class="chip-btn" data-scenario="vote" aria-pressed="false">hidden vote</button>
          <button type="button" class="chip-btn" data-scenario="note" aria-pressed="false">time capsule</button>
        </div>
        <div id="pg-fields"></div>
        <p class="field-hint" id="pg-hint"></p>
        <p class="field-hint" id="pg-round"></p>
        <p class="error" id="pg-error" hidden></p>
      </form>
      <div id="pg-live" hidden></div>
    </div>
  `;

  const form = host.querySelector<HTMLFormElement>('#pg-form')!;
  const fieldsEl = host.querySelector<HTMLElement>('#pg-fields')!;
  const hintEl = host.querySelector<HTMLElement>('#pg-hint')!;
  const roundEl = host.querySelector<HTMLElement>('#pg-round')!;
  const errorEl = host.querySelector<HTMLElement>('#pg-error')!;
  const liveEl = host.querySelector<HTMLElement>('#pg-live')!;

  function renderFields(): void {
    if (scenario === 'bid') {
      fieldsEl.innerHTML = `
        <div class="pg-row">
          <input id="pg-name" name="name" type="text" maxlength="24" placeholder="your name" aria-label="your name" />
          <input id="pg-amount" name="amount" type="number" min="1" max="1000000" required
                 placeholder="your bid" aria-label="your bid" />
          <button type="submit" class="btn btn-primary" id="pg-seal">seal my bid</button>
        </div>`;
      hintEl.textContent =
        'nobody sees any bid until the round reveals. then every bid opens at once and the highest wins.';
    } else if (scenario === 'vote') {
      fieldsEl.innerHTML = `
        <div class="pg-row">
          <input id="pg-name" name="name" type="text" maxlength="24" placeholder="your name" aria-label="your name" />
          <select id="pg-choice" aria-label="your vote">
            <option value="yes">vote yes</option>
            <option value="no">vote no</option>
          </select>
          <button type="submit" class="btn btn-primary" id="pg-seal">seal my vote</button>
        </div>`;
      hintEl.textContent =
        'no running tallies, no bandwagons. every vote stays dark until the round reveals them together.';
    } else {
      fieldsEl.innerHTML = `
        <div class="pg-row">
          <input id="pg-secret" name="secret" type="text" maxlength="200" required
                 placeholder="a prediction, a confession, a launch date…" aria-label="your secret" />
          <select id="pg-delay" aria-label="reveal delay">
            <option value="30">reveal in 30s</option>
            <option value="60" selected>reveal in 60s</option>
            <option value="120">reveal in 2m</option>
            <option value="600">reveal in 10m</option>
            <option value="3600">reveal in 1h</option>
            <option value="custom">pick a date…</option>
          </select>
          <button type="submit" class="btn btn-primary" id="pg-seal">seal it</button>
        </div>
        <div class="pg-row pg-until-row" id="pg-until-row" hidden>
          <label class="field-label" for="pg-until" style="margin:8px 0 0">sealed until</label>
          <input id="pg-until" type="datetime-local" aria-label="sealed until" />
        </div>`;
      hintEl.textContent =
        'encrypted in this tab with wasm. nobody can read it early, us included. everyone can read it after.';
      const delaySel = fieldsEl.querySelector<HTMLSelectElement>('#pg-delay')!;
      const untilRow = fieldsEl.querySelector<HTMLElement>('#pg-until-row')!;
      const untilInput = fieldsEl.querySelector<HTMLInputElement>('#pg-until')!;
      const toLocal = (d: Date) => {
        const pad = (v: number) => String(v).padStart(2, '0');
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
      };
      const soon = new Date(Date.now() + 2 * 60_000);
      untilInput.min = toLocal(soon);
      untilInput.value = toLocal(new Date(Date.now() + 60 * 60_000));
      delaySel.addEventListener('change', () => {
        untilRow.hidden = delaySel.value !== 'custom';
      });
    }
    void updateRoundNote();
  }

  /** Newest pending round with enough time left to join safely. */
  async function findOpenRound(): Promise<{ id: string; secs: number } | null> {
    try {
      const conditions = await listConditions();
      const now = Math.floor(Date.now() / 1000);
      const open = conditions.find(
        (c) =>
          c.status === 'pending' && c.kind === 'at_time' && c.fires_at != null &&
          c.fires_at - now >= MIN_JOIN_SECS,
      );
      return open ? { id: open.id, secs: open.fires_at! - now } : null;
    } catch {
      return null;
    }
  }

  async function updateRoundNote(): Promise<void> {
    if (scenario === 'note') {
      roundEl.textContent = '';
      return;
    }
    const open = await findOpenRound();
    roundEl.textContent = open
      ? `joins the open round, reveals in ${open.secs}s. open this page in another tab to compete.`
      : `starts a new ${ROUND_SECS}s round. open this page in another tab to compete.`;
  }

  host.querySelectorAll<HTMLButtonElement>('.chip-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      scenario = btn.dataset.scenario as Scenario;
      host.querySelectorAll<HTMLButtonElement>('.chip-btn').forEach((b) => {
        b.setAttribute('aria-pressed', String(b === btn));
      });
      errorEl.hidden = true;
      renderFields();
    });
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    void seal();
  });

  renderFields();
  const roundTimer = window.setInterval(() => {
    if (!run) void updateRoundNote();
  }, 5000);

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

  /** Build (payload, summary) from the active scenario's fields. */
  function readFields(): { payload: string; summary: string } | null {
    const val = (sel: string) => host.querySelector<HTMLInputElement>(sel)?.value.trim() ?? '';
    if (scenario === 'bid') {
      const name = val('#pg-name') || 'anon';
      const amt = Number(val('#pg-amount'));
      if (!Number.isFinite(amt) || amt <= 0) return null;
      return { payload: JSON.stringify({ k: 'bid', name, amt }), summary: `${name} bid ${amt}` };
    }
    if (scenario === 'vote') {
      const name = val('#pg-name') || 'anon';
      const choice = host.querySelector<HTMLSelectElement>('#pg-choice')?.value ?? 'yes';
      return {
        payload: JSON.stringify({ k: 'vote', name, choice }),
        summary: `${name} voted ${choice}`,
      };
    }
    const text = val('#pg-secret');
    if (!text) return null;
    return { payload: text, summary: text };
  }

  async function seal(): Promise<void> {
    const fields = readFields();
    if (!fields) return;
    const sealBtn = host.querySelector<HTMLButtonElement>('#pg-seal')!;
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

      // Bids and votes join the open shared round; capsules get their own.
      let conditionId: string;
      if (scenario === 'note') {
        const delayVal = host.querySelector<HTMLSelectElement>('#pg-delay')?.value ?? '60';
        if (delayVal === 'custom') {
          const untilVal = host.querySelector<HTMLInputElement>('#pg-until')?.value ?? '';
          const until = new Date(untilVal);
          if (!untilVal || Number.isNaN(until.getTime()) || until.getTime() < Date.now() + 60_000) {
            throw new Error('pick a date at least a minute in the future');
          }
          conditionId = await client.condition({ at: until });
        } else {
          conditionId = await client.condition({ in: Number(delayVal) });
        }
      } else {
        const open = await findOpenRound();
        conditionId = open ? open.id : await client.condition({ in: ROUND_SECS });
      }
      setStep(0, 'done',
        `digest ${committee.digest.slice(0, 12)}…, n=${committee.n} t=${committee.t} B=${committee.b}, re-checked against the wasm parse`);

      setStep(1, 'active');
      let sealed: { ctHash: string; sealedB64: string };
      try {
        sealed = await client.seal(fields.payload, conditionId);
      } catch (e) {
        // The round froze while we were sealing: start a fresh one.
        if (String(e).includes('closed') && scenario !== 'note') {
          conditionId = await client.condition({ in: ROUND_SECS });
          sealed = await client.seal(fields.payload, conditionId);
        } else {
          throw e;
        }
      }
      const wire = b64Bytes(sealed.sealedB64);
      const ct0hex = hex(wire.slice(5, 53));
      run = {
        conditionId,
        ctHash: sealed.ctHash,
        scenario,
        summary: fields.summary,
        n: committee.n,
        t: committee.t,
        b: committee.b,
      };
      done = false;
      condition = null;
      form.hidden = true;
      renderLive();

      // Perceivable pacing only; every value shown is real.
      await sleep(500);
      setStep(1, 'done',
        `KEM header [k]₁ = ${ct0hex.slice(0, 20)}… (48 bytes), key mask 16 bytes, body ${wire.length - 73} bytes of keystream`);
      renderLive();
      await sleep(500);
      setStep(2, 'done', `ct_hash = sha256(wire) = ${sealed.ctHash.slice(0, 20)}…`);
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
        renderRevealed(reveal);
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
    const others = Math.max(0, (condition?.real_count ?? 1) - 1);

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
            <button type="button" class="btn" data-copy="${esc(sealLink(run))}">copy share link</button>
            <a class="link" href="#/condition/${encodeURIComponent(run.conditionId)}">watch it in the explorer</a>
          </p>
          <p class="field-hint">send the link to anyone. they get the countdown, then the content, on the same cue.</p>
        </div>
      `;
      wireCopy(liveEl);
      lastRest = '';
    }

    const company =
      run.scenario !== 'note' && others > 0
        ? ` <span class="muted">(${others} other sealed ${others === 1 ? 'entry' : 'entries'} in this round)</span>`
        : '';
    let stage: string;
    if (status === 'stalled') {
      stage = `<span class="error">stalled. fewer than ${run.t} shares arrived in time. it recovers if late shares show up.</span>`;
    } else if (status === 'frozen') {
      stage = `batch frozen. operators are posting shares: <strong class="num">${verified}</strong> verified, <strong class="num">${run.t}</strong> needed`;
    } else if (secs != null && secs > 0) {
      stage = `sealed. reveals in <strong class="num accent">${esc(fmtCountdown(secs))}</strong>${company}`;
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

  /** Scenario-aware results: leaderboard for bids, tally for votes, the
   * plain secret for capsules. Everything comes from the actual reveal. */
  function resultsHtml(reveal: Reveal): string {
    if (!run) return '';
    const entries: Entry[] = reveal.slots
      .filter((s) => !s.is_dummy && s.valid)
      .map((s) => parseEntry(s.ct_hash, decodePayload(s.payload_b64).text));
    const mine = reveal.slots.find((s) => s.ct_hash === run!.ctHash);
    if (mine && !mine.valid) {
      return `<p class="pg-secret-out"><span class="error">your slot was flagged corrupt</span></p>`;
    }

    const you = (e: Entry) =>
      e.ctHash === run!.ctHash ? ' <span class="you-tag">you</span>' : '';
    const parts: string[] = [];

    const bids = entries
      .filter((e) => e.kind === 'bid')
      .sort((a, b) => (b.amt ?? 0) - (a.amt ?? 0));
    if (bids.length > 0) {
      const winner = bids[0];
      parts.push(`<p class="pg-secret-out">winner: ${esc(winner.name)} with ${winner.amt}${you(winner)}</p>`);
      parts.push(`<ol class="result-list">${bids
        .map((b) => `<li><span>${esc(b.name)}${you(b)}</span><span class="num">${b.amt}</span></li>`)
        .join('')}</ol>`);
    }

    const votes = entries.filter((e) => e.kind === 'vote');
    if (votes.length > 0) {
      const yes = votes.filter((v) => v.choice === 'yes').length;
      const no = votes.length - yes;
      const max = Math.max(yes, no, 1);
      const verdict = yes === no ? 'tied' : yes > no ? 'yes wins' : 'no wins';
      parts.push(`<p class="pg-secret-out">${verdict}: ${yes} yes, ${no} no</p>`);
      parts.push(`
        <div class="tally">
          <div class="tally-row"><span class="tally-label">yes</span>
            <div class="timing-track"><div class="timing-bar timing-bar-fin" style="width:${(yes / max) * 100}%"></div></div>
            <span class="num timing-ms">${yes}</span></div>
          <div class="tally-row"><span class="tally-label">no</span>
            <div class="timing-track"><div class="timing-bar timing-bar-pre" style="width:${(no / max) * 100}%"></div></div>
            <span class="num timing-ms">${no}</span></div>
        </div>`);
      const yours = votes.find((v) => v.ctHash === run!.ctHash);
      if (yours) parts.push(`<p class="muted">you voted ${esc(yours.choice ?? '')}.</p>`);
    }

    const texts = entries.filter((e) => e.kind === 'text');
    if (texts.length > 0 && (bids.length > 0 || votes.length > 0 || texts.length > 1)) {
      parts.push(`<ul class="result-list">${texts
        .map((t) => `<li><span>${esc(t.text ?? '')}${you(t)}</span></li>`)
        .join('')}</ul>`);
    } else if (texts.length === 1 && bids.length === 0 && votes.length === 0) {
      parts.push(`<p class="pg-secret-out">${esc(texts[0].text ?? '')}</p>`);
    }

    if (parts.length === 0) {
      parts.push(`<p class="pg-secret-out">${esc(run.summary)}</p>`);
    }
    return parts.join('');
  }

  function renderRevealed(reveal: Reveal): void {
    if (!run) return;
    liveEl.innerHTML = `
      <div class="pg-stage pg-revealed reveal-in">
        <div class="pg-sealed-row">
          <span class="sealed-label sealed-label-open">revealed</span>
          <span class="mono muted">${esc(truncMiddle(run.ctHash, 14, 10))}</span>
        </div>
        ${resultsHtml(reveal)}
        <p class="muted">everyone can read this now. before the cue, nobody could, operators included.</p>
        ${traceHtml()}
        <p class="pg-links">
          <button type="button" class="btn" data-copy="${esc(sealLink(run))}">copy share link</button>
          <a class="link" href="#/condition/${encodeURIComponent(run.conditionId)}">see the full reveal, shares and timings</a>
          <button type="button" class="btn" id="pg-again">seal another</button>
        </p>
      </div>
    `;
    lastRest = '';
    wireCopy(liveEl);
    liveEl.querySelector<HTMLButtonElement>('#pg-again')?.addEventListener('click', () => {
      run = null;
      liveEl.hidden = true;
      liveEl.innerHTML = '';
      form.hidden = false;
      renderFields();
    });
  }

  return () => {
    stopPolling();
    clearInterval(roundTimer);
  };
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
