const sections = [
  ['overview', 'overview'],
  ['use-cases', 'use cases'],
  ['lifecycle', 'lifecycle'],
  ['cryptography', 'cryptography'],
  ['architecture', 'architecture'],
  ['production', 'production'],
  ['integration', 'integration'],
  ['trust', 'trust model'],
] as const;

export function renderProtocol(root: HTMLElement): () => void {
  root.innerHTML = `
    <article class="protocol-page">
      <header class="protocol-hero" id="overview">
        <p class="protocol-kicker">OPEN protocol reference <span>v0</span></p>
        <h1>one seal. one cue.<br>one public reveal.</h1>
        <p class="protocol-lede">OPEN is a programmable encryption network for information that
        must stay unreadable until a shared condition fires. A browser seals the payload once.
        A threshold committee later opens the complete batch. The user never returns for a
        second reveal transaction.</p>
        <div class="protocol-facts" aria-label="Protocol defaults">
          <div><span class="protocol-fact-label">confidential below</span><strong class="mono">t = 3</strong></div>
          <div><span class="protocol-fact-label">committee</span><strong class="mono">n = 5</strong></div>
          <div><span class="protocol-fact-label">fixed batch</span><strong class="mono">B = 64</strong></div>
          <div><span class="protocol-fact-label">cryptographic overhead</span><strong class="mono">64 bytes</strong></div>
        </div>
      </header>

      <nav class="protocol-index" aria-label="Protocol sections">
        ${sections.map(([id, label]) => `<button type="button" data-section="${id}">${label}</button>`).join('')}
      </nav>

      <section class="protocol-section protocol-principle">
        <p class="section-number">00</p>
        <div>
          <h2>the guarantee</h2>
          <p class="protocol-statement">Before the cue, fewer than <span class="mono">t</span>
          operators cannot recover a payload. After the cue, any <span class="mono">t</span>
          valid committee shares recover every slot in the frozen batch.</p>
          <div class="guarantee-line" role="img" aria-label="Sealed before the cue, publicly revealed after the cue">
            <div><span class="state-dot state-dot-sealed"></span><strong>before</strong><small>ciphertext only</small></div>
            <span class="guarantee-rule"><i></i><b>cue</b></span>
            <div><span class="state-dot state-dot-open"></span><strong>after</strong><small>public plaintext</small></div>
          </div>
        </div>
      </section>

      <section class="protocol-section" id="use-cases">
        <p class="section-number">01</p>
        <div>
          <p class="section-kicker">what OPEN unlocks</p>
          <h2>three products that need guaranteed reveal</h2>
          <p class="section-intro">OPEN is most valuable when revealing is not optional. If a user
          can walk away when the result no longer suits them, ordinary commit-reveal breaks. These
          are the three strongest places to start once the network is production-ready.</p>

          <div class="use-case-list">
            <article class="use-case">
              <div class="use-case-number"><span>01</span><small>proof of alpha</small></div>
              <div class="use-case-body">
                <p class="use-case-eyebrow">verified records for agents and forecasters</p>
                <h3>prove the complete record, not just the winning screenshots</h3>
                <p class="use-case-lede">An agent seals every prediction before the event. When the
                deadline arrives, OPEN reveals all of them, including the bad calls. The result is a
                track record that cannot be edited after the fact.</p>
                <div class="plain-flow" aria-label="Agent prediction use case flow">
                  <span>agent seals a call</span><b>→</b><span>event reaches its deadline</span><b>→</b><span>every call opens</span><b>→</b><span>score becomes permanent</span>
                </div>
                <div class="use-case-details">
                  <div><strong>why OPEN matters</strong><p>With normal commit-reveal, the agent can
                  hide a losing prediction by never revealing it. Guaranteed reveal removes that
                  choice, so the history is complete by construction.</p></div>
                  <div><strong>who uses it</strong><p>Agent platforms, prediction markets, research
                  communities, signal buyers, and capital allocators comparing automated strategies.</p></div>
                  <div><strong>fully ready when</strong><p>Agent identities resist sybil farming,
                  resolution data comes from reliable oracles, scoring rules are public, and sealed
                  records remain available independently of one coordinator.</p></div>
                </div>
                <p class="use-case-example"><span>Example</span> An ETH forecasting agent seals
                “ETH closes above $4,200 on Friday.” On Friday, the call opens whether it won or lost.</p>
              </div>
            </article>

            <article class="use-case">
              <div class="use-case-number"><span>02</span><small>sealed markets</small></div>
              <div class="use-case-body">
                <p class="use-case-eyebrow">fair auctions, launches, procurement, and treasury trades</p>
                <h3>hide the order book until everyone has committed</h3>
                <p class="use-case-lede">Every participant submits one sealed bid. Nobody can see
                the live book and react to someone else's price. At close, OPEN reveals the complete
                batch at once, the market computes one result, and settlement can verify it.</p>
                <div class="plain-flow" aria-label="Sealed market use case flow">
                  <span>bidders seal prices</span><b>→</b><span>market closes</span><b>→</b><span>whole book opens</span><b>→</b><span>clear and settle</span>
                </div>
                <div class="use-case-details">
                  <div><strong>why OPEN matters</strong><p>Open auctions invite sniping and copycat
                  bids. Commit-reveal lets an unhappy bidder abandon the reveal. OPEN removes both
                  advantages because bids stay hidden and the committee reveals them automatically.</p></div>
                  <div><strong>where it fits</strong><p>Uniform-price token launches, second-price
                  auctions, NFT or domain sales, private procurement, liquidation auctions, and DAO
                  treasury block trades with competing market makers.</p></div>
                  <div><strong>fully ready when</strong><p>DKG removes the trusted dealer, independent
                  operators meet a published availability target, contracts verify the committed
                  result, and the settlement path has been audited.</p></div>
                </div>
                <p class="use-case-example"><span>Example</span> Five market makers privately bid on
                a DAO's $2 million treasury sale. The prices open together, governance sees the full
                audit trail, and the best valid bid settles without leaking intent early.</p>
              </div>
            </article>

            <article class="use-case">
              <div class="use-case-number"><span>03</span><small>reveal layer</small></div>
              <div class="use-case-body">
                <p class="use-case-eyebrow">shared infrastructure for applications</p>
                <h3>give any app a future public reveal without a second transaction</h3>
                <p class="use-case-lede">A developer sends ciphertext and a condition to OPEN. The
                network handles committee coordination, batching, threshold shares, verification,
                and publication. The application consumes the result instead of operating its own
                cryptographic committee.</p>
                <div class="plain-flow" aria-label="Reveal infrastructure use case flow">
                  <span>app calls seal</span><b>→</b><span>OPEN holds ciphertext</span><b>→</b><span>cue fires</span><b>→</b><span>app reads verified reveal</span>
                </div>
                <div class="use-case-details">
                  <div><strong>what builders gain</strong><p>One SDK, one condition API, public proof
                  of every operator share, clear failure states, and no need to ask users to return
                  later and reveal their own commitments.</p></div>
                  <div><strong>where it fits</strong><p>Hidden votes, prediction-market resolution,
                  game moves, raffle seeds, allowlist allocation, sealed surveys, timed disclosures,
                  and any workflow where data should become public on a known cue.</p></div>
                  <div><strong>fully ready when</strong><p>The service supports isolated or dedicated
                  committees, parameter pinning, durable ciphertext availability, webhooks, quotas,
                  billing, SLAs, operator rotation, and independently verifiable uptime.</p></div>
                </div>
                <p class="use-case-example"><span>Example</span> An onchain strategy game seals every
                player's move during the round. At the block-height cue, all moves open together and
                the game contract checks the anchored result.</p>
              </div>
            </article>
          </div>

          <p class="use-case-conclusion"><strong>The common thread:</strong> OPEN does not merely
          hide information. It guarantees the moment when hidden information becomes shared truth.
          That is the primitive these products cannot safely reproduce with a user-operated reveal.</p>
        </div>
      </section>

      <section class="protocol-section" id="lifecycle">
        <p class="section-number">02</p>
        <div>
          <p class="section-kicker">end-to-end lifecycle</p>
          <h2>what happens to one payload</h2>
          <p class="section-intro">The coordinator controls scheduling and ordering. It never
          receives plaintext before the cue. Operators hold secret shares, not a usable
          decryption key.</p>
          <ol class="protocol-steps">
            <li>
              <span class="step-index">01</span>
              <div><h3>fetch committee parameters</h3><p>The SDK downloads the public parameters,
              checks their SHA-256 digest, and caches them. The parameter set fixes
              <span class="mono">n</span>, <span class="mono">t</span>, and
              <span class="mono">B</span> for the committee lifetime.</p></div>
              <code>GET /v0/committees/:id</code>
            </li>
            <li>
              <span class="step-index">02</span>
              <div><h3>seal inside the browser</h3><p>Wasm runs the Fujisaki-Okamoto byte-message
              transform locally. The body becomes a keystream-masked payload. Only the sealed
              wire bytes leave the device.</p></div>
              <code>seal(payload, condition)</code>
            </li>
            <li>
              <span class="step-index">03</span>
              <div><h3>content-address the ciphertext</h3><p>The coordinator parses the wire format,
              enforces the payload cap, computes <span class="mono">ct_hash = sha256(wire)</span>,
              and stores it under the condition. Submission order does not choose the slot.</p></div>
              <code>POST /v0/ciphertexts</code>
            </li>
            <li>
              <span class="step-index">04</span>
              <div><h3>fire the cue and freeze the batch</h3><p>A wall-clock or block-height condition
              fires. The coordinator pads to 64, sorts every ciphertext hash, assigns positions,
              and makes the batch immutable. FFT pre-decryption starts immediately.</p></div>
              <code>pending → frozen</code>
            </li>
            <li>
              <span class="step-index">05</span>
              <div><h3>collect one share per operator</h3><p>Each outbound-only node polls for work
              and computes one 48-byte G1 partial for the entire batch. Share size stays constant
              whether the batch contains one real seal or sixty-four.</p></div>
              <code>POST /v0/shares</code>
            </li>
            <li>
              <span class="step-index">06</span>
              <div><h3>verify, combine, and recover</h3><p>Every share must pass the public pairing
              equation. Any <span class="mono">t</span> valid shares are Lagrange-combined. Finalize
              recovers all payloads, while the FO check isolates any corrupt ciphertext to its slot.</p></div>
              <code>frozen → revealed</code>
            </li>
            <li>
              <span class="step-index">07</span>
              <div><h3>publish an auditable result</h3><p>The reveal contains every slot, validity
              bit, operator share log, timings, and a Merkle root over position plus payload.
              Clients can recompute the root and compare it with the optional onchain anchor.</p></div>
              <code>GET /v0/reveals/:id</code>
            </li>
          </ol>
        </div>
      </section>

      <section class="protocol-section" id="cryptography">
        <p class="section-number">03</p>
        <div>
          <p class="section-kicker">cryptographic construction</p>
          <h2>the wire carries no early plaintext</h2>
          <p class="section-intro">OPEN uses Commonware's batched threshold encryption and its
          Fujisaki-Okamoto byte-message transform. The protocol wrapper keeps the scheme intact
          and adds conditions, persistence, operator transport, verification, and public records.</p>

          <div class="wire-map" aria-label="Sealed ciphertext wire format">
            <div class="wire-head"><span>magic</span><strong class="mono">BTE0</strong><small>4 bytes</small></div>
            <div class="wire-type"><span>type</span><strong class="mono">0x01</strong><small>1 byte</small></div>
            <div class="wire-kem"><span>KEM header</span><strong class="mono">[k]₁</strong><small>48 bytes</small></div>
            <div class="wire-mask"><span>key mask</span><strong class="mono">ct₁</strong><small>16 bytes</small></div>
            <div class="wire-len"><span>length</span><strong class="mono">u32</strong><small>4 bytes</small></div>
            <div class="wire-body"><span>body</span><strong class="mono">ct₂</strong><small>payload bytes</small></div>
          </div>

          <div class="equations">
            <div><span class="equation-label">header</span><code>ct₀ = [k]₁</code></div>
            <div><span class="equation-label">masked key</span><code>ct₁ = Hₖ([k · τᴮ⁺¹]ₜ) xor K</code></div>
            <div><span class="equation-label">masked body</span><code>ct₂ = Hₘ(K) xor payload</code></div>
            <div><span class="equation-label">integrity</span><code>k = Hᵣ(K, payload), verify [k]₁ = ct₀</code></div>
          </div>

          <div class="protocol-columns">
            <div>
              <h3>one partial for a whole batch</h3>
              <p class="formula mono">pdⱼ = Σᵢ σⱼⁱ · ctᵢ,₀</p>
              <p>Operator <span class="mono">j</span> performs a multi-scalar multiplication over
              the frozen headers. The result is one compressed G1 point, exactly 48 bytes.</p>
            </div>
            <div>
              <h3>public share verification</h3>
              <p class="formula mono">e(pdⱼ, g₂) = ∏ᵢ e(ctᵢ,₀, vⱼⁱ)</p>
              <p>The coordinator checks each partial against public verification keys. A forged
              share is attributable, recorded as rejected, and never counts toward threshold.</p>
            </div>
          </div>

          <div class="batch-explainer">
            <div class="batch-labels"><span>real seals</span><span>deterministic padding</span></div>
            <div class="mini-slots" aria-label="A fixed batch containing real and padding slots">
              ${Array.from({ length: 64 }, (_, i) => `<i class="${i < 7 ? 'mini-real' : ''}"></i>`).join('')}
            </div>
            <p>All 64 positions are committed. Real and dummy ciphertexts are sorted by hash,
            so position assignment is reproducible. The Merkle root covers the complete batch,
            including padding.</p>
          </div>
        </div>
      </section>

      <section class="protocol-section" id="architecture">
        <p class="section-number">04</p>
        <div>
          <p class="section-kicker">system architecture</p>
          <h2>separate the public edge from secret-bearing operators</h2>
          <p class="section-intro">The browser and explorer are public. The coordinator is a
          state machine and aggregator. Operator nodes accept no inbound traffic and never expose
          their keystores to the coordinator.</p>

          <div class="architecture-map" role="img" aria-label="OPEN production architecture">
            <div class="arch-node arch-client"><small>public</small><strong>dapp + SDK</strong><span>wasm sealing</span></div>
            <span class="arch-arrow arch-a1">ciphertext</span>
            <div class="arch-node arch-edge"><small>public edge</small><strong>TLS + explorer</strong><span>rate limit, proxy</span></div>
            <span class="arch-arrow arch-a2">/v0</span>
            <div class="arch-node arch-coordinator"><small>private service</small><strong>coordinator</strong><span>conditions, freeze, verify, recover</span></div>
            <span class="arch-arrow arch-a3">state</span>
            <div class="arch-node arch-store"><small>durable</small><strong>database</strong><span>ciphertexts + reveals</span></div>
            <span class="arch-arrow arch-a4">work out, shares back</span>
            <div class="arch-operators">
              ${Array.from({ length: 5 }, (_, i) => `<div class="arch-node"><small>operator ${i + 1}</small><strong>node ${i + 1}</strong><span>encrypted keystore</span></div>`).join('')}
            </div>
            <span class="arch-arrow arch-a5">root</span>
            <div class="arch-node arch-anchor"><small>optional</small><strong>onchain anchor</strong><span>condition commits + reveal root</span></div>
          </div>

          <div class="component-list">
            <div><code>bte-sdk</code><p>Fetches parameters, seals in wasm, submits ciphertexts,
            waits for reveals, and optionally verifies the anchored root.</p></div>
            <div><code>bte-coordinator</code><p>Runs the condition engine, SQLite state machine,
            deterministic freeze, pipelined pre-decrypt, pairing checks, and REST API.</p></div>
            <div><code>bte-node</code><p>Polls outbound for frozen work, decrypts its local keystore,
            computes one partial, and posts it. Nodes are otherwise stateless.</p></div>
            <div><code>BteAnchor.sol</code><p>Commits ciphertext hashes to conditions and records the
            final Merkle root from an authorized publisher.</p></div>
          </div>

          <h3 class="subsection-title">condition state machine</h3>
          <div class="state-machine" aria-label="Condition states">
            <div><strong>pending</strong><span>accept seals</span></div><b>cue</b>
            <div><strong>frozen</strong><span>collect shares</span></div><b>t valid</b>
            <div><strong>revealed</strong><span>immutable result</span></div>
            <span class="stall-path">timeout without t → <strong>stalled</strong> → late valid share resumes recovery</span>
          </div>
        </div>
      </section>

      <section class="protocol-section" id="production">
        <p class="section-number">05</p>
        <div>
          <p class="section-kicker">production posture</p>
          <h2>what runs today, and what must change for real value</h2>
          <p class="section-intro">The current stack is suitable for a transparent public devnet.
          It has a real threshold committee, public share verification, persistence, recovery after
          restart, TLS termination, rate limiting, and visible stall states. Its ceremony still has
          a single trusted dealer, which is the decisive production blocker.</p>

          <div class="readiness-table table-wrap">
            <table>
              <thead><tr><th>layer</th><th>v0 today</th><th>production target</th><th>why it matters</th></tr></thead>
              <tbody>
                <tr><td>key generation</td><td>offline trusted dealer</td><td>audited DKG</td><td>no machine ever knows the complete trapdoor</td></tr>
                <tr><td>operator lifecycle</td><td>new ceremony to replace one</td><td>proactive resharing and rotation</td><td>rotate membership without changing the public key</td></tr>
                <tr><td>availability</td><td>coordinator database</td><td>replicated store plus blobs or calldata</td><td>ciphertexts survive one service or provider failure</td></tr>
                <tr><td>accountability</td><td>invalid shares are attributable</td><td>stake, slashing, signed work receipts</td><td>make corruption and withholding economically costly</td></tr>
                <tr><td>verification</td><td>offchain pairing check, anchored root</td><td>EIP-2537 onchain verification</td><td>contracts verify shares and combination directly</td></tr>
                <tr><td>operations</td><td>health endpoint and structured logs</td><td>SLOs, metrics, paging, tracing, backups</td><td>detect threshold loss before a condition fires</td></tr>
                <tr><td>security</td><td>unaudited prototype</td><td>independent audits and ceremony review</td><td>cryptographic code and deployment assumptions need review</td></tr>
              </tbody>
            </table>
          </div>

          <div class="deployment-stack">
            <div class="deployment-row"><span>edge</span><strong>CDN / WAF / TLS</strong><p>Serve the explorer, enforce request limits, and proxy only <span class="mono">/v0</span>.</p></div>
            <div class="deployment-row"><span>control</span><strong>coordinator replicas</strong><p>One active writer with failover, durable database, idempotent engine ticks, and backed-up state.</p></div>
            <div class="deployment-row"><span>committee</span><strong>independent operators</strong><p>Separate clouds, regions, owners, keys, and alerting. Outbound network access only.</p></div>
            <div class="deployment-row"><span>availability</span><strong>content-addressed ciphertext layer</strong><p>Replicate sealed blobs by hash and pin final batch artifacts outside the coordinator.</p></div>
            <div class="deployment-row"><span>settlement</span><strong>chain anchor or verifier</strong><p>Bind condition commits and final roots to a contract-consumable record.</p></div>
          </div>

          <h3 class="subsection-title">minimum production signals</h3>
          <ul class="signal-list">
            <li><span class="mono">committee_live_operators</span><p>Page before the live set drops below threshold.</p></li>
            <li><span class="mono">condition_freeze_lag_seconds</span><p>Measure cue-to-freeze scheduling delay.</p></li>
            <li><span class="mono">verified_share_latency_ms</span><p>Track every operator from freeze to accepted partial.</p></li>
            <li><span class="mono">reveal_finalize_ms</span><p>Separate pipelined pre-decrypt from user-visible finalize.</p></li>
            <li><span class="mono">rejected_shares_total</span><p>Alert on pairing failures by operator identity.</p></li>
            <li><span class="mono">stalled_conditions_total</span><p>Page immediately. A late share can still complete recovery.</p></li>
          </ul>
        </div>
      </section>

      <section class="protocol-section" id="integration">
        <p class="section-number">06</p>
        <div>
          <p class="section-kicker">dapp integration</p>
          <h2>the product path is four calls</h2>
          <p class="section-intro">A dapp creates a condition, seals locally, stores the returned
          hash, and waits for a public reveal. Include application context inside the payload so a
          copied ciphertext cannot be replayed into a different condition without detection.</p>
          <div class="code-block">
            <div class="code-title"><span>TypeScript</span><small>bte-sdk</small></div>
            <pre><code>import { BteClient } from 'bte-sdk';

const open = new BteClient({ url: 'https://open.example' });

const conditionId = await open.condition({ in: 60 });
const sealed = await open.seal(JSON.stringify({
  app: 'auction-v1',
  conditionId,
  lotId: 'lot-42',
  bid: 815,
  nonce: crypto.randomUUID()
}), conditionId);

const reveal = await open.waitForReveal(conditionId);
const slot = reveal.slots.find((item) => item.ctHash === sealed.ctHash);

if (!slot?.valid) throw new Error('sealed bid did not recover');
console.log(slot.text);</code></pre>
          </div>

          <div class="integration-notes">
            <div><span>01</span><h3>pin the committee digest</h3><p>Ship the expected public-parameter
            digest with the app. Do not silently accept a coordinator-selected committee.</p></div>
            <div><span>02</span><h3>bind the payload</h3><p>Include the condition id, app domain,
            action type, and a nonce in the encrypted bytes. Validate them after reveal.</p></div>
            <div><span>03</span><h3>persist the ciphertext hash</h3><p>The hash is the stable handle for
            the commitment. Store it in your database or anchor it onchain before the cue.</p></div>
            <div><span>04</span><h3>treat reveal as asynchronous</h3><p>Use polling, webhooks, or an
            indexer. Handle pending, frozen, stalled, revealed, and per-slot corrupt states.</p></div>
          </div>

          <h3 class="subsection-title">failure behavior is explicit</h3>
          <div class="failure-list">
            <div><strong>one node offline</strong><span>reveal continues with any 3 of 5</span></div>
            <div><strong>one forged share</strong><span>pairing check rejects it, identity remains visible</span></div>
            <div><strong>one mauled ciphertext</strong><span>that slot is corrupt, the other 63 still recover</span></div>
            <div><strong>coordinator restart</strong><span>state reloads, pre-decrypt recomputes, nodes repoll</span></div>
            <div><strong>fewer than t shares</strong><span>condition becomes stalled, never falsely revealed</span></div>
            <div><strong>late valid share</strong><span>a stalled condition completes automatically</span></div>
          </div>
        </div>
      </section>

      <section class="protocol-section protocol-trust" id="trust">
        <p class="section-number">07</p>
        <div>
          <p class="section-kicker">trust model</p>
          <h2>the boundary, stated precisely</h2>
          <div class="trust-grid">
            <div><h3>you do not trust</h3><ul>
              <li>the coordinator with pre-cue plaintext</li>
              <li>any coalition smaller than threshold</li>
              <li>an operator's claim that its share is valid</li>
              <li>the explorer to calculate the Merkle root correctly</li>
            </ul></div>
            <div><h3>v0 still requires trust</h3><ul>
              <li>the dealer did not retain or leak tau</li>
              <li>at least t operators answer after the cue</li>
              <li>the coordinator includes submitted ciphertexts</li>
              <li>the deployment preserves ciphertext availability</li>
            </ul></div>
          </div>
          <p class="trust-warning"><strong>v0 is dealer-trusted and unaudited.</strong> Use it for
          testnets, demos, and integration work. Do not use it to protect real value. DKG and an
          independent audit are prerequisites for that claim.</p>
          <div class="protocol-links">
            <a href="https://eprint.iacr.org/2026/760" target="_blank" rel="noopener">read the paper</a>
            <a href="https://github.com/commonwarexyz/simple-bte" target="_blank" rel="noopener">inspect simple-bte</a>
            <a href="https://github.com/Adityaakr/batched-threshold-encryption" target="_blank" rel="noopener">inspect OPEN</a>
          </div>
        </div>
      </section>
    </article>
  `;

  const scrollToSection = (event: Event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-section]');
    if (!button) return;
    const section = document.getElementById(button.dataset.section ?? '');
    section?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  };

  const index = root.querySelector<HTMLElement>('.protocol-index');
  index?.addEventListener('click', scrollToSection);

  return () => index?.removeEventListener('click', scrollToSection);
}
