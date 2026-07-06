// The recipient side of a shared seal: a dedicated page for ONE ciphertext.
// Before the cue: a countdown over unreadable ciphertext. After: the content.
// This is what a "seal link" opens.
import { getCondition, getReveal, type ConditionDetail } from '../api';
import { wireCopy } from '../playground';
import { decodePayload, esc, fmtCountdown, fmtUnix, truncMiddle } from '../util';

const POLL_MS = 2000;

export function renderSealView(root: HTMLElement, conditionId: string, ctHash: string): () => void {
  root.innerHTML = `
    <section class="seal-view">
      <p class="seal-kicker">someone sealed this for you</p>
      <div class="card seal-card">
        <div class="pg-sealed-row">
          <span class="sealed-label" id="sv-label">sealed</span>
          <span class="mono muted" title="${esc(ctHash)}">${esc(truncMiddle(ctHash, 14, 10))}</span>
        </div>
        <div id="sv-body">
          <div class="skeleton-row" style="margin-top:16px">
            <span class="skeleton" style="width:220px"></span>
          </div>
        </div>
      </div>
      <p class="seal-footnote">encrypted to a threshold committee. nobody could read it before the
      cue, the operators included. <a class="link" href="#/">seal your own</a></p>
    </section>
  `;

  const labelEl = root.querySelector<HTMLElement>('#sv-label')!;
  const bodyEl = root.querySelector<HTMLElement>('#sv-body')!;

  let condition: ConditionDetail | null = null;
  let revealed = false;
  let failed = false;
  let pollTimer: number | undefined;
  let tickTimer: number | undefined;

  const renderPending = () => {
    if (!condition || revealed || failed) return;
    if (condition.status === 'pending' && condition.fires_at != null) {
      const secs = condition.fires_at - Math.floor(Date.now() / 1000);
      bodyEl.innerHTML = `
        <p class="sv-countdown num">${esc(fmtCountdown(secs))}</p>
        <p class="muted">unlocks ${esc(fmtUnix(condition.fires_at))}. this page will open by itself.</p>`;
    } else if (condition.status === 'frozen') {
      const batch = condition.batches?.[0];
      const verified = batch?.verified_shares ?? 0;
      bodyEl.innerHTML = `
        <p class="sv-countdown num">opening…</p>
        <p class="muted">the cue fired. committee shares: ${verified} verified.</p>`;
    } else if (condition.status === 'stalled') {
      bodyEl.innerHTML = `
        <p class="error">the reveal stalled: not enough operator shares arrived yet. it completes
        automatically when they do.</p>`;
    }
  };

  const poll = async () => {
    try {
      condition = await getCondition(conditionId);
    } catch {
      failed = true;
      bodyEl.innerHTML = `<p class="error" style="margin-top:16px">this seal link does not match
        anything here. it may be for a different network, or the devnet was wiped.</p>`;
      return;
    }
    renderPending();
    if (condition.status === 'revealed' && !revealed) {
      const reveal = await getReveal(conditionId).catch(() => null);
      if (!reveal) return;
      revealed = true;
      if (pollTimer !== undefined) clearInterval(pollTimer);
      if (tickTimer !== undefined) clearInterval(tickTimer);
      const slot = reveal.slots.find((s) => s.ct_hash === ctHash);
      labelEl.textContent = 'revealed';
      labelEl.classList.add('sealed-label-open');
      if (!slot) {
        bodyEl.innerHTML = `<p class="error" style="margin-top:16px">this ciphertext is not part of
          that reveal. wrong link?</p>`;
        return;
      }
      if (!slot.valid) {
        bodyEl.innerHTML = `<p class="error" style="margin-top:16px">this slot was flagged corrupt at
          reveal time. the rest of the batch opened fine.</p>`;
        return;
      }
      const decoded = decodePayload(slot.payload_b64);
      bodyEl.innerHTML = `
        <p class="sv-content reveal-in ${decoded.isHex ? 'mono' : ''}">${esc(decoded.text)}</p>
        <p class="muted">revealed ${esc(fmtUnix(reveal.revealed_at))}, slot ${slot.position} of ${reveal.slots.length}.
          <a class="link" href="#/condition/${encodeURIComponent(conditionId)}">see the full batch,
          operator shares and timings</a></p>`;
      wireCopy(bodyEl);
    }
  };

  void poll();
  pollTimer = window.setInterval(() => void poll(), POLL_MS);
  tickTimer = window.setInterval(renderPending, 1000);
  return () => {
    if (pollTimer !== undefined) clearInterval(pollTimer);
    if (tickTimer !== undefined) clearInterval(tickTimer);
  };
}
