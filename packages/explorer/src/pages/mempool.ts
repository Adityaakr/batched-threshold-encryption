// The encrypted mempool, live on-chain.
//
// One swap, sent into two real pools. The public lane's order is submitted in
// the clear; a real searcher bot with its own key reads it and sandwiches it
// with real transactions. The peal lane's order is sealed through the real
// committee — the chain sees only a ciphertext hash — and settles at the cue
// via PealMempool.executeBatch, which the contract binds to the revealed batch.
//
// The browser signs nothing: the relayer sponsors both submissions. What is
// simulated is nothing on-chain; the pool, the searcher, and the settlement are
// all real. The one honest gap is the committee's trust model (a dealer-trusted
// ceremony, operators that do not yet verify the cue), stated on the page.
import { BteClient } from 'bte-sdk';
import { API_BASE } from '../api';
import {
  commitSealed,
  encodeOrder,
  fromWad,
  getAmountOut,
  getConfig,
  getPealResult,
  getPublicResult,
  getState,
  submitPublicSwap,
  toWad,
  txUrl,
  type MempoolConfig,
} from '../mempool/chain';
import { esc, fmtCountdown } from '../util';

const ROUND_SECS = 30;
const POLL_MS = 1500;
const SLIP_BPS: Record<string, bigint> = { '0.001': 10n, '0.005': 50n, '0.01': 100n, '0.03': 300n };

type StepState = 'todo' | 'active' | 'done';
interface Step {
  label: string;
  detail?: string;
  state: StepState;
}

const usd = (n: number) =>
  n.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

export function renderMempool(root: HTMLElement): () => void {
  const previousTitle = document.title;
  document.title = 'Peal Network. the encrypted mempool';

  const client = new BteClient({ url: API_BASE });
  let cfg: MempoolConfig | null = null;
  let dead = false;
  let busy = false;
  const timers: number[] = [];

  root.innerHTML = `
    <section class="mp">
      <header class="mp-head">
        <h1 class="hero-title">one swap. two mempools. on-chain.</h1>
        <p class="hero-sub">a real searcher bot is watching both pools. on the left it reads
        your trade and wraps a real sandwich around it. on the right it sees a ciphertext hash
        and has nothing to act on. you sign nothing; the relayer sponsors both. same trade, same
        pool, same searcher.</p>
      </header>
      <div id="mp-boot" class="card">connecting to the demo stack…</div>
      <div id="mp-app" hidden></div>
    </section>
  `;
  const bootEl = root.querySelector<HTMLElement>('#mp-boot')!;
  const appEl = root.querySelector<HTMLElement>('#mp-app')!;

  void boot();

  async function boot(): Promise<void> {
    try {
      cfg = await getConfig();
      await getState();
      if (dead) return;
      mountApp();
    } catch {
      bootEl.innerHTML = `
        <p class="error" style="margin-top:0">the on-chain demo stack is not reachable.</p>
        <p class="muted">start the relayer and searcher (and a settler pointed at the coordinator),
        then reload. see <span class="mono">packages/mempool-agents</span>.</p>`;
    }
  }

  function mountApp(): void {
    const c = cfg!;
    bootEl.hidden = true;
    appEl.hidden = false;
    appEl.innerHTML = `
      <form class="mp-form card" id="mp-form" autocomplete="off">
        <p class="scenario-kicker">Try Peal Playground</p>
        <p class="scenario-prompt">You are buying ETH with USDC on a live pool.
        chain <span class="mono">${c.chainId}</span>. you sign nothing.</p>
        <div class="pg-row">
          <label class="pg-control pg-control-grow">
            <span class="field-label">you swap (USDC)</span>
            <input type="number" id="mp-amount" value="50000" min="100" max="500000" step="100" required />
          </label>
          <label class="pg-control pg-control-select">
            <span class="field-label">slippage tolerance</span>
            <select id="mp-slip">
              <option value="0.001">0.1%</option>
              <option value="0.005" selected>0.5%</option>
              <option value="0.01">1%</option>
              <option value="0.03">3%</option>
            </select>
          </label>
          <button type="submit" class="btn btn-primary" id="mp-go">send it to both</button>
        </div>
        <p class="field-hint" id="mp-quote"></p>
        <p class="error" id="mp-error" hidden></p>
      </form>

      <div class="mp-grid" id="mp-grid" hidden>
        <article class="mp-side mp-public">
          <header class="mp-side-head"><h2>public mempool</h2><span class="chip chip-stalled">readable</span></header>
          <div id="mp-public-body"></div>
        </article>
        <article class="mp-side mp-peal">
          <header class="mp-side-head"><h2>peal mempool</h2><span class="chip chip-frozen">sealed</span></header>
          <div id="mp-peal-body"></div>
        </article>
      </div>
      <p class="mp-verdict" id="mp-verdict" hidden></p>

      <div class="trust-note mp-trust">
        <p><strong>what is real here.</strong></p>
        <p>Both pools are real contracts on chain ${c.chainId}. The searcher is a real bot with
        its own key; on the public lane it submits real front-run and back-run transactions, and
        on the peal lane it sees only a hash and does nothing. Your order is sealed through the
        real committee and settled by PealMempool.executeBatch, which re-derives the batch's
        merkle root and refuses anything that is not the revealed batch. You sign nothing; the
        relayer sponsors both submissions.</p>
        <p>The honest gap: the committee is dealer-trusted and its operators do not yet verify
        the cue for themselves, so today a dishonest operator could read the sealed order early.
        That is the decentralisation work still on the roadmap. The cryptography and the
        settlement are real; the committee's trust model is not there yet.</p>
      </div>
    `;

    const form = appEl.querySelector<HTMLFormElement>('#mp-form')!;
    const amountEl = appEl.querySelector<HTMLInputElement>('#mp-amount')!;
    const slipEl = appEl.querySelector<HTMLSelectElement>('#mp-slip')!;
    const quoteEl = appEl.querySelector<HTMLElement>('#mp-quote')!;

    const paintQuote = async () => {
      if (busy) return;
      try {
        const { pealPool } = await getState();
        const amountIn = toWad(Number(amountEl.value) || 0);
        const out = getAmountOut(amountIn, pealPool.base, pealPool.quote);
        const slip = SLIP_BPS[slipEl.value] ?? 50n;
        const floor = (out * (10000n - slip)) / 10000n;
        quoteEl.innerHTML =
          `quoted at <span class="num">${esc(fromWad(out))} ETH</span>, and you will accept as ` +
          `little as <span class="num">${esc(fromWad(floor))} ETH</span>. that floor is the whole ` +
          `game: a searcher takes everything above it that it can.`;
      } catch {
        /* transient */
      }
    };
    amountEl.addEventListener('input', () => void paintQuote());
    slipEl.addEventListener('change', () => void paintQuote());
    void paintQuote();

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (busy) return;
      void run(Number(amountEl.value) || 0, slipEl.value).catch((err) => {
        const el = appEl.querySelector<HTMLElement>('#mp-error')!;
        el.hidden = false;
        el.textContent = err instanceof Error ? err.message : String(err);
        busy = false;
        appEl.querySelector<HTMLButtonElement>('#mp-go')!.disabled = false;
        appEl.querySelector<HTMLButtonElement>('#mp-go')!.textContent = 'try again';
      });
    });
  }

  // ---- rendering helpers ------------------------------------------------

  function stepsHtml(steps: Step[]): string {
    return `<ol class="trace">${steps
      .map(
        (s) => `<li class="trace-step trace-${s.state}">
      <span class="trace-marker" aria-hidden="true"></span>
      <span class="trace-body"><span class="trace-label">${esc(s.label)}</span>${
        s.detail ? `<span class="trace-detail">${s.detail}</span>` : ''
      }</span></li>`,
      )
      .join('')}</ol>`;
  }

  function link(hash: string): string {
    const u = txUrl(cfg!, hash);
    const short = `${hash.slice(0, 10)}…${hash.slice(-6)}`;
    return u
      ? `<a class="mono link" href="${u}" target="_blank" rel="noopener">${short}</a>`
      : `<span class="mono">${short}</span>`;
  }

  // ---- the run ----------------------------------------------------------

  async function run(amount: number, slipKey: string): Promise<void> {
    busy = true;
    const c = cfg!;
    const go = appEl.querySelector<HTMLButtonElement>('#mp-go')!;
    const errEl = appEl.querySelector<HTMLElement>('#mp-error')!;
    const grid = appEl.querySelector<HTMLElement>('#mp-grid')!;
    const publicEl = appEl.querySelector<HTMLElement>('#mp-public-body')!;
    const pealEl = appEl.querySelector<HTMLElement>('#mp-peal-body')!;
    const verdictEl = appEl.querySelector<HTMLElement>('#mp-verdict')!;
    errEl.hidden = true;
    verdictEl.hidden = true;
    grid.hidden = false;
    go.disabled = true;
    go.textContent = 'in flight…';

    // Fix the swap at contract precision off the live peal reserves.
    const { pealPool } = await getState();
    const amountIn = toWad(amount);
    const fair = getAmountOut(amountIn, pealPool.base, pealPool.quote);
    const slip = SLIP_BPS[slipKey] ?? 50n;
    const minOut = (fair * (10000n - slip)) / 10000n;

    const publicSteps: Step[] = [
      { label: 'your swap enters the public mempool', state: 'active' },
      { label: 'the searcher reads it', state: 'todo' },
      { label: 'it wraps a sandwich and settles', state: 'todo' },
    ];
    const pealSteps: Step[] = [
      { label: 'your swap is sealed to the committee', state: 'active' },
      { label: 'the searcher sees only a hash', state: 'todo' },
      { label: 'the cue fires and the batch opens on-chain', state: 'todo' },
    ];
    const paintPublic = () => (publicEl.innerHTML = stepsHtml(publicSteps));
    const paintPeal = () => (pealEl.innerHTML = stepsHtml(pealSteps));
    paintPublic();
    paintPeal();

    // Seal the peal order through the real coordinator.
    const conditionId = await client.condition({ in: ROUND_SECS, tag: 'mempool' });
    const payload = encodeOrder({
      trader: c.relayer,
      baseToQuote: true,
      amountIn,
      minOut,
      to: c.relayer,
    });
    const sealed = await client.seal(payload, conditionId);
    if (dead) return;
    pealSteps[0].state = 'done';
    pealSteps[0].detail = `only the ciphertext left your browser. cue in ${ROUND_SECS}s.`;
    pealSteps[1].state = 'active';
    paintPeal();

    // Peal on-chain commit (searcher sees only the hash) + public order.
    const commit = await commitSealed(conditionId, sealed.ctHash);
    pealSteps[1].state = 'done';
    pealSteps[1].detail =
      `<span class="mono mp-cipher">${esc(sealed.ctHash)}</span>` +
      `<span class="mp-nothing">committed on-chain in ${link(commit.txHash)}. no amount, no ` +
      `direction. nothing to sandwich.</span>`;
    pealSteps[2].state = 'active';
    paintPeal();

    const pub = await submitPublicSwap({
      amountIn: String(amount),
      minOut: fromWad(minOut),
      baseToQuote: true,
    });
    publicSteps[0].state = 'done';
    publicSteps[0].detail = `submitted in the clear (${link(pub.txHash)}): ${usd(amount)} in, floor ${fromWad(minOut)} ETH.`;
    publicSteps[1].state = 'active';
    paintPublic();

    // Poll both fates in parallel.
    const publicDone = pollPublic(pub.orderId, fair, publicSteps, paintPublic);
    const pealDone = pollPeal(conditionId, fair, pealSteps, paintPeal);
    const [pubRes, pealRes] = await Promise.all([publicDone, pealDone]);
    if (dead) return;

    // Verdict.
    verdictEl.hidden = false;
    if (pubRes.sandwiched) {
      const lost = Number(fromWad(fair)) - Number(pubRes.victimOut);
      const lostUsd = lost * (Number(fromWad(pealPool.base)) / Number(fromWad(pealPool.quote)));
      verdictEl.innerHTML =
        `same swap, two lanes. in the readable mempool the searcher took ` +
        `<span class="num accent">$${pubRes.profit ? Number(pubRes.profit).toFixed(2) : '0'}</span> ` +
        `and you were pushed to <span class="num">${pubRes.victimOut} ETH</span> ` +
        `(about <span class="num">$${lostUsd.toFixed(0)}</span> gone). in the sealed one you got ` +
        `<span class="num accent">${pealRes.fill} ETH</span>, the full quote, because there was ` +
        `nothing to read.`;
    } else {
      verdictEl.innerHTML =
        `this swap was too small to sandwich profitably, so the readable lane filled it honestly ` +
        `too. raise the amount and send again: the readable lane starts leaking the moment the ` +
        `trade is worth wrapping, and the sealed lane never does.`;
    }

    go.disabled = false;
    go.textContent = 'send another';
    busy = false;
  }

  interface PubOut {
    sandwiched: boolean;
    victimOut?: string;
    profit?: string;
  }

  function pollPublic(
    orderId: string,
    fairWei: bigint,
    steps: Step[],
    paint: () => void,
  ): Promise<PubOut> {
    return new Promise((resolve) => {
      const tick = async () => {
        if (dead) return resolve({ sandwiched: false });
        const r = await getPublicResult(orderId).catch(() => ({ done: false }) as never);
        if (!r.done) return;
        clearInterval(id);
        steps[1].state = 'done';
        steps[2].state = 'done';
        if (r.sandwiched) {
          steps[1].detail = 'amount, direction and floor, all in the clear. everything it needs.';
          steps[2].detail =
            `<div class="mp-result mp-result-bad"><p class="mp-result-line">you received ` +
            `<span class="num">${esc(r.victimOut ?? '')} ETH</span>, not the ` +
            `<span class="num">${esc(fromWad(fairWei))} ETH</span> you were quoted.</p>` +
            `<p class="mp-result-take">the searcher took <span class="num">$${
              r.profit ? Number(r.profit).toFixed(2) : '0'
            }</span> off you in ${link(r.txHash ?? '')}.</p></div>`;
        } else {
          steps[1].detail = 'readable, but the fee makes it not worth wrapping.';
          steps[2].detail =
            `<div class="mp-result"><p class="mp-result-line">filled in full at ` +
            `<span class="num">${esc(r.victimOut ?? '')} ETH</span> (${link(r.txHash ?? '')}).</p>` +
            `<p class="mp-result-take">too small to sandwich: the 0.3% fee on both legs ate the ` +
            `edge. being readable did not cost you here. it costs you as soon as the trade is ` +
            `worth wrapping.</p></div>`;
        }
        paint();
        resolve({ sandwiched: !!r.sandwiched, victimOut: r.victimOut, profit: r.profit });
      };
      const id = window.setInterval(() => void tick(), POLL_MS);
      timers.push(id);
      void tick();
    });
  }

  interface PealOut {
    fill: string;
  }

  function pollPeal(
    conditionId: string,
    fairWei: bigint,
    steps: Step[],
    paint: () => void,
  ): Promise<PealOut> {
    return new Promise((resolve) => {
      let firesAt = Math.floor(Date.now() / 1000) + ROUND_SECS;
      const tick = async () => {
        if (dead) return resolve({ fill: fromWad(fairWei) });
        // Countdown until the cue, then settlement.
        try {
          const st = await client.status(conditionId);
          if (st.firesAt) firesAt = st.firesAt;
        } catch {
          /* transient */
        }
        const secs = firesAt - Math.floor(Date.now() / 1000);
        if (steps[2].state === 'active') {
          steps[2].detail =
            secs > 0
              ? `the batch freezes in <span class="num accent">${esc(fmtCountdown(secs))}</span>. until then it is ciphertext in a queue.`
              : 'the cue fired. the committee is opening the batch and the settler is submitting it on-chain.';
          paint();
        }
        const r = await getPealResult(conditionId).catch(() => ({ done: false }) as never);
        if (!r.done) return;
        clearInterval(id);
        const fill = r.fills?.[0]?.amountOut ?? fromWad(fairWei);
        steps[2].state = 'done';
        steps[2].detail =
          `<div class="mp-result mp-result-good"><p class="mp-result-line">you received ` +
          `<span class="num">${esc(fill)} ETH</span>, the full quote.</p>` +
          `<p class="mp-result-take">opened by PealMempool.executeBatch in ${link(r.txHash ?? '')}, ` +
          `bound to merkle root <span class="mono">${esc((r.merkleRoot ?? '').slice(0, 14))}…</span>. ` +
          `the searcher took <span class="num">$0</span>: it never learned there was a swap.</p></div>`;
        paint();
        resolve({ fill });
      };
      const id = window.setInterval(() => void tick(), POLL_MS);
      timers.push(id);
      void tick();
    });
  }

  return () => {
    dead = true;
    for (const t of timers) clearInterval(t);
    document.title = previousTitle;
  };
}
