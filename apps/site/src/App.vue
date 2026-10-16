<script setup lang="ts">
import { onMounted, ref, watch } from "vue";
import ArchitectureDiagram from "./components/ArchitectureDiagram.vue";
import CodeBlock from "./components/CodeBlock.vue";
import HeroReplay from "./components/HeroReplay.vue";
import { capabilities, faq, links, pilot, steps } from "./content";

type Theme = "auto" | "light" | "dark";
const theme = ref<Theme>("auto");

onMounted(() => {
  try {
    const saved = localStorage.getItem("klymbak:theme");
    if (saved === "light" || saved === "dark") theme.value = saved;
  } catch {
    // Storage blocked; follow the system theme.
  }
});

watch(theme, (value) => {
  if (value === "auto") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = value;
  try {
    localStorage.setItem("klymbak:theme", value);
  } catch {
    // Not persisted; that's fine.
  }
});

function cycleTheme() {
  theme.value = theme.value === "auto" ? "dark" : theme.value === "dark" ? "light" : "auto";
}

const legacyScreens = ["Dashboard", "Orders", "Customers", "Refunds", "Returns", "Shipments", "Inventory", "Purchase orders", "Discounts", "Tickets", "Reports", "Exports", "Users & roles", "Audit log"];
const copiedEmail = ref(false);

async function copyEmail() {
  try {
    await navigator.clipboard.writeText(links.email);
    copiedEmail.value = true;
    setTimeout(() => (copiedEmail.value = false), 1500);
  } catch {
    // Clipboard refused; the address is selectable text.
  }
}
</script>

<template>
  <header class="top">
    <div class="wrap top__inner">
      <a class="brand" href="#top" aria-label="Klymbak home">
        <svg viewBox="0 0 32 32" width="28" height="28" aria-hidden="true">
          <rect width="32" height="32" rx="7" fill="var(--signal)" />
          <path d="M8 10h16M8 16h16M8 22h9l4 4v-4h3" stroke="var(--signal-ink)" stroke-width="2.4" fill="none" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
        <span>klymbak</span>
      </a>
      <nav class="top__nav" aria-label="Sections">
        <a href="#steps">Six steps</a>
        <a href="#inside">What's inside</a>
        <a href="#pilot">Pilot</a>
        <a href="#faq">FAQ</a>
      </nav>
      <button type="button" class="top__theme" :aria-label="`Theme: ${theme}. Change theme`" :title="`Theme: ${theme}`" @click="cycleTheme">
        <svg v-if="theme === 'dark'" viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" /></svg>
        <svg v-else-if="theme === 'light'" viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4.5" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>
        <svg v-else viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="12" cy="12" r="8.5" /><path d="M12 3.5v17a8.5 8.5 0 0 0 0-17z" fill="currentColor" /></svg>
      </button>
      <a class="btn btn--primary top__cta" :href="links.hire" target="_blank" rel="noopener">Hire me</a>
    </div>
  </header>

  <main id="top">
    <!-- Hero ------------------------------------------------------------------>
    <section class="hero wrap">
      <div class="hero__copy">
        <p class="label">For teams who live in admin screens</p>
        <h1>Your admin panel, as a <mark>conversation</mark>.</h1>
        <p class="hero__lede">
          I replace the screens your team clicks through every day with an AI agent they can talk to. It looks things up in your systems,
          shows results as tables and charts, and asks before it changes anything.
        </p>
        <div class="hero__ctas">
          <a class="btn btn--primary" :href="links.demo" target="_blank" rel="noopener">Open the live demo</a>
          <a class="btn btn--ghost" href="#steps">See the six steps</a>
        </div>
        <ul class="hero__facts">
          <li><strong>Pilot</strong> in three weeks, on one real workflow</li>
          <li><strong>Any model</strong>: Claude, GPT, Gemini or your own hardware</li>
          <li><strong>Open stack</strong>: Vue 3 + Node, on the MIT-licensed pi agent harness</li>
        </ul>
      </div>
      <div class="hero__demo">
        <HeroReplay :theme="theme" />
      </div>
    </section>

    <!-- Before / after ----------------------------------------------------------->
    <section class="section wrap" aria-labelledby="change-title">
      <div class="section__head">
        <p class="label">What changes</p>
        <div>
          <h2 id="change-title">Fourteen screens become one sentence.</h2>
          <p class="section__lede">Handling one damaged-item complaint used to mean six screens and a carrier website. Now it's a request, a check, and one approval.</p>
        </div>
      </div>
      <div class="ba">
        <div class="ba__side ba__side--before">
          <p class="label">Before · about 4 minutes</p>
          <div class="legacy" aria-hidden="true">
            <ul class="legacy__menu">
              <li v-for="(screen, i) in legacyScreens" :key="screen" :class="{ on: [1, 2, 3, 5, 9].includes(i) }">{{ screen }}</li>
            </ul>
            <div class="legacy__page">
              <div class="legacy__filters"><span /><span /><span /><span /></div>
              <div v-for="n in 7" :key="n" class="legacy__row"><span /><span /><span /><span /></div>
            </div>
          </div>
          <ol class="ba__list">
            <li>Search the customer, open the order</li>
            <li>Check the carrier's site for the parcel</li>
            <li>Issue the refund in the payments screen</li>
            <li>Create a return label, copy it into an email</li>
            <li>Reply on the ticket and close it</li>
          </ol>
        </div>
        <div class="ba__side ba__side--after">
          <p class="label">After · about 20 seconds</p>
          <div class="ask">
            <span class="ask__who">Ops lead</span>
            <p>“Jane's tent arrived torn. Refund the tent, send her a return label, and reply on her ticket.”</p>
          </div>
          <div class="stamp-row">
            <span class="stamp">Approved</span>
            <span>Refund $329.00 to Jane Cooper · <span class="faint">by Olivia Hart</span></span>
          </div>
          <ul class="ba__checks">
            <li>Customer, order and shipment looked up in parallel</li>
            <li>Refund and label created after one approval</li>
            <li>Reply drafted in your tone, logged in the audit trail</li>
          </ul>
        </div>
      </div>
    </section>

    <!-- Steps ---------------------------------------------------------------------->
    <section id="steps" class="section wrap" aria-labelledby="steps-title">
      <div class="section__head">
        <p class="label">The process</p>
        <div>
          <h2 id="steps-title">Six steps to bring an agent into your product.</h2>
          <p class="section__lede">You keep your systems, your login and your data. The agent goes on top of what you already run, one workflow at a time.</p>
        </div>
      </div>
      <ol class="steps">
        <li v-for="(step, i) in steps" :id="`step-${step.id}`" :key="step.id" class="ledger step">
          <div class="ledger__margin step__margin">
            <span class="step__num">{{ String(i + 1).padStart(2, "0") }}</span>
            <span class="label">{{ step.time }}</span>
          </div>
          <div class="ledger__body step__body" :class="{ 'step__body--code': step.code }">
            <div class="step__text">
              <h3>{{ step.title }}</h3>
              <p>{{ step.body }}</p>
              <ul class="step__points">
                <li v-for="point in step.points" :key="point">{{ point }}</li>
              </ul>
              <p class="step__deliverable"><span class="label">You get</span> {{ step.deliverable }}</p>
            </div>
            <CodeBlock v-if="step.code" :source="step.code.source" :file="step.code.file" />
          </div>
        </li>
      </ol>
    </section>

    <!-- Architecture ------------------------------------------------------------------->
    <section class="section wrap" aria-labelledby="arch-heading">
      <div class="section__head">
        <p class="label">Architecture</p>
        <div>
          <h2 id="arch-heading">Plain web tech, in your infrastructure.</h2>
          <p class="section__lede">
            The chat is a Vue component. The agent is a Node service you mount next to your API. They talk over HTTPS and server-sent events,
            behind the login you already have.
          </p>
        </div>
      </div>
      <ArchitectureDiagram />
    </section>

    <!-- Capabilities --------------------------------------------------------------------->
    <section id="inside" class="section wrap" aria-labelledby="inside-title">
      <div class="section__head">
        <p class="label">What's inside</p>
        <div>
          <h2 id="inside-title">Built for work that has consequences.</h2>
          <p class="section__lede">Everything an admin panel enforced through screens and permissions, enforced in code around the model.</p>
        </div>
      </div>
      <div class="caps">
        <table>
          <thead>
            <tr>
              <th scope="col">Capability</th>
              <th scope="col">What it means for your team</th>
              <th scope="col">In the code</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="cap in capabilities" :key="cap.name">
              <th scope="row">{{ cap.name }}</th>
              <td>{{ cap.what }}</td>
              <td><code>{{ cap.code }}</code></td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="wont">
        <h3>What it won't do</h3>
        <dl>
          <div><dt>Act as someone else</dt><dd>Tools run with the signed-in person's roles, so the agent can't do anything they couldn't.</dd></div>
          <div><dt>Change data quietly</dt><dd>Writes wait for an approval that shows exactly what will happen. Denials are recorded too.</dd></div>
          <div><dt>Talk its way past policy</dt><dd>Limits live in hooks that run before every call, whatever the prompt says.</dd></div>
          <div><dt>Show what it shouldn't</dt><dd>Contact details are masked by role, and ad-hoc SQL runs on a read-only connection.</dd></div>
          <div><dt>Send data where you didn't choose</dt><dd>Run local models, or your own Azure or Bedrock account.</dd></div>
        </dl>
      </div>
    </section>

    <!-- Pilot ------------------------------------------------------------------------>
    <section id="pilot" class="section wrap" aria-labelledby="pilot-title">
      <div class="section__head">
        <p class="label">Working together</p>
        <div>
          <h2 id="pilot-title">A three-week pilot on one real workflow.</h2>
          <p class="section__lede">Pick the workflow that wastes the most time. By the end of week three, a handful of your people use the agent for it, and you have the numbers to decide what's next.</p>
        </div>
      </div>
      <ol class="pilot">
        <li v-for="week in pilot" :key="week.week">
          <span class="label">{{ week.week }}</span>
          <h3>{{ week.title }}</h3>
          <p>{{ week.text }}</p>
        </li>
      </ol>
    </section>

    <!-- FAQ --------------------------------------------------------------------------->
    <section id="faq" class="section wrap" aria-labelledby="faq-title">
      <div class="section__head">
        <p class="label">Questions</p>
        <h2 id="faq-title">What teams ask first.</h2>
      </div>
      <div class="faq">
        <details v-for="item in faq" :key="item.q">
          <summary>{{ item.q }}</summary>
          <p>{{ item.a }}</p>
        </details>
      </div>
    </section>

    <!-- CTA ----------------------------------------------------------------------------->
    <section class="cta">
      <div class="wrap cta__inner">
        <h2>Bring one workflow. Leave with a working agent.</h2>
        <p>Tell me which screens your team lives in. I'll show you what the first three weeks would look like.</p>
        <div class="hero__ctas">
          <a class="btn btn--primary" :href="links.hire" target="_blank" rel="noopener">Talk about your admin panel</a>
          <a class="btn btn--ghost cta__ghost" :href="links.demo" target="_blank" rel="noopener">Open the live demo</a>
        </div>
        <p class="cta__email">
          Or email <span class="cta__address">{{ links.email }}</span>
          <button type="button" @click="copyEmail">{{ copiedEmail ? "Copied" : "Copy" }}</button>
        </p>
      </div>
    </section>
  </main>

  <footer class="foot wrap">
    <span>klymbak · MIT licensed</span>
    <span>Built on the <a href="https://github.com/earendil-works/pi" target="_blank" rel="noopener">pi agent harness</a></span>
    <a :href="links.repo" target="_blank" rel="noopener">Source code</a>
  </footer>
</template>

<style>
/* Header ---------------------------------------------------------------------- */
.top {
  position: sticky;
  top: env(safe-area-inset-top, 0px);
  z-index: 20;
  background: color-mix(in srgb, var(--paper) 92%, transparent);
  backdrop-filter: blur(8px);
  border-bottom: 1px solid var(--rule);
}
.top__inner {
  display: flex;
  align-items: center;
  gap: 1.4rem;
  height: 62px;
}
.brand {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  text-decoration: none;
  font-family: var(--font-display);
  font-stretch: 125%;
  font-weight: 800;
  font-size: 1.15rem;
  letter-spacing: -0.02em;
}
.top__nav {
  display: flex;
  gap: 1.3rem;
  margin-left: auto;
  font-size: 0.92rem;
}
.top__nav a {
  text-decoration: none;
  color: var(--ink-soft);
}
.top__nav a:hover {
  color: var(--ink);
  text-decoration: underline;
}
.top__theme {
  display: grid;
  place-items: center;
  width: 38px;
  height: 38px;
  border: 1px solid var(--rule-strong);
  border-radius: 8px;
  background: transparent;
  color: var(--ink);
  cursor: pointer;
}
.top__cta {
  height: 38px;
  padding: 0 0.95rem;
  font-size: 0.9rem;
}

/* Hero ------------------------------------------------------------------------- */
.hero {
  display: grid;
  grid-template-columns: minmax(0, 1.08fr) minmax(0, 1fr);
  gap: clamp(2rem, 5vw, 4.5rem);
  align-items: center;
  padding-block: clamp(2.5rem, 6vw, 5rem);
}
.hero__copy {
  display: grid;
  gap: 1.4rem;
  align-content: center;
}
.hero h1 {
  font-size: clamp(2.4rem, 1.3rem + 3.6vw, 4.2rem);
  font-stretch: 112%;
  font-weight: 800;
  line-height: 0.98;
  letter-spacing: -0.025em;
}
.hero__lede {
  max-width: 34rem;
  font-size: 1.15rem;
  color: var(--ink-soft);
}
.hero__ctas {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
}
.hero__facts {
  display: grid;
  gap: 0.35rem;
  margin: 0.4rem 0 0;
  padding: 1rem 0 0;
  list-style: none;
  border-top: 1px solid var(--rule);
  font-size: 0.92rem;
  color: var(--ink-soft);
}
.hero__facts strong {
  color: var(--ink);
  font-weight: 600;
}
.hero__demo {
  min-width: 0;
}

/* Before / after ------------------------------------------------------------------ */
.ba {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  border: 1.5px solid var(--ink);
  border-radius: 12px;
  overflow: hidden;
}
.ba__side {
  display: grid;
  gap: 1.1rem;
  align-content: start;
  padding: clamp(1.2rem, 3vw, 2rem);
  min-width: 0;
}
.ba__side--before {
  border-right: 1.5px solid var(--ink);
}
.ba__side--after {
  background: var(--paper-raised);
}
.legacy {
  display: grid;
  grid-template-columns: 9.5rem minmax(0, 1fr);
  height: 200px;
  border: 1px solid var(--rule-strong);
  border-radius: 8px;
  background: var(--paper-raised);
  overflow: hidden;
  font-size: 0.72rem;
}
.legacy__menu {
  margin: 0;
  padding: 0.5rem 0.4rem;
  list-style: none;
  border-right: 1px solid var(--rule);
  color: var(--ink-faint);
  line-height: 1.55;
  overflow: hidden;
}
.legacy__menu li {
  padding: 0 0.4rem;
  border-radius: 4px;
}
.legacy__menu li.on {
  background: var(--highlighter);
  color: var(--highlighter-ink);
}
.legacy__page {
  display: grid;
  gap: 7px;
  align-content: start;
  padding: 0.7rem;
}
.legacy__filters,
.legacy__row {
  display: grid;
  grid-template-columns: 2fr 1fr 1fr 1fr;
  gap: 6px;
}
.legacy__filters span,
.legacy__row span {
  height: 10px;
  border-radius: 3px;
  background: var(--rule);
}
.legacy__filters span {
  height: 16px;
  background: transparent;
  border: 1px solid var(--rule-strong);
}
.ba__list,
.ba__checks {
  margin: 0;
  padding-left: 1.2rem;
  display: grid;
  gap: 0.3rem;
  font-size: 0.95rem;
  color: var(--ink-soft);
}
/* Ruled like ledger paper: each step sits on its own line. */
.ba__list {
  gap: 0;
  line-height: 2rem;
  background: repeating-linear-gradient(180deg, transparent 0 calc(2rem - 1px), var(--rule) calc(2rem - 1px) 2rem);
}
.ba__checks {
  list-style: none;
  padding: 0;
}
.ba__checks li::before {
  content: "✓";
  margin-right: 0.55rem;
  color: var(--stamp-green);
  font-weight: 700;
}
.ask {
  padding: 1rem 1.1rem;
  border-radius: 14px 14px 4px 14px;
  background: var(--signal-soft);
  font-size: 1.05rem;
}
.ask__who {
  display: block;
  margin-bottom: 0.25rem;
  font-family: var(--font-mono);
  font-size: 0.72rem;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--ink-faint);
}
.stamp-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.9rem;
  font-size: 0.95rem;
}
.stamp {
  padding: 0.15rem 0.6rem;
  border: 2.5px solid var(--stamp-green);
  border-radius: 5px;
  color: var(--stamp-green);
  font-family: var(--font-mono);
  font-weight: 700;
  font-size: 0.8rem;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  transform: rotate(-5deg);
}
.faint {
  color: var(--ink-faint);
}

/* Steps ------------------------------------------------------------------------- */
.steps {
  margin: 0;
  padding: 0;
  list-style: none;
  border-bottom: 1px solid var(--rule);
}
.step__margin {
  display: grid;
  align-content: start;
  gap: 0.4rem;
}
.step__num {
  font-family: var(--font-display);
  font-stretch: 125%;
  font-weight: 800;
  font-size: 2.6rem;
  line-height: 1;
  color: var(--signal);
}
.step__body {
  display: grid;
  gap: 1.6rem;
}
.step__body--code {
  grid-template-columns: minmax(0, 0.85fr) minmax(0, 1.25fr);
  align-items: start;
}
.step__text {
  display: grid;
  gap: 0.75rem;
  align-content: start;
}
.step__text h3 {
  font-size: var(--step-2);
  max-width: 24ch;
}
.step__text > p {
  max-width: 60ch;
  color: var(--ink-soft);
}
.step__points {
  margin: 0;
  padding-left: 1.15rem;
  display: grid;
  gap: 0.2rem;
  font-size: 0.96rem;
}
.step__deliverable {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0.6rem;
  margin-top: 0.3rem;
  padding-top: 0.75rem;
  border-top: 1px dashed var(--rule-strong);
  font-weight: 600;
}

/* Capabilities ------------------------------------------------------------------------ */
.caps {
  overflow-x: auto;
  border: 1.5px solid var(--ink);
  border-radius: 12px;
  background: var(--paper-raised);
}
.caps table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.96rem;
}
.caps th,
.caps td {
  padding: 0.85rem 1.1rem;
  text-align: left;
  vertical-align: top;
  border-bottom: 1px solid var(--rule);
}
.caps thead th {
  font-family: var(--font-mono);
  font-size: 0.72rem;
  font-weight: 500;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--ink-faint);
  border-bottom: 1.5px solid var(--ink);
}
.caps tbody th {
  font-weight: 600;
  white-space: nowrap;
}
.caps tbody td:first-of-type {
  color: var(--ink-soft);
}
.caps tbody tr:last-child th,
.caps tbody tr:last-child td {
  border-bottom: 0;
}
.caps code {
  white-space: nowrap;
  color: var(--signal);
}
.wont {
  display: grid;
  grid-template-columns: var(--margin-col) minmax(0, 1fr);
  margin-top: 3rem;
}
.wont h3 {
  font-size: var(--step-1);
  padding-right: 1rem;
}
.wont dl {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(15rem, 1fr));
  gap: 1.2rem 2rem;
  margin: 0;
}
.wont dt {
  font-weight: 600;
  text-decoration: line-through;
  text-decoration-color: var(--stamp-red);
  text-decoration-thickness: 2px;
}
.wont dd {
  margin: 0.25rem 0 0;
  color: var(--ink-soft);
  font-size: 0.95rem;
}

/* Pilot ---------------------------------------------------------------------------- */
.pilot {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  margin: 0;
  padding: 0;
  list-style: none;
  border-top: 3px solid var(--ink);
}
.pilot li {
  display: grid;
  gap: 0.5rem;
  align-content: start;
  padding: 1.3rem 1.5rem 0 0;
  position: relative;
}
.pilot li::before {
  content: "";
  position: absolute;
  top: -9px;
  left: 0;
  width: 15px;
  height: 15px;
  border-radius: 50%;
  background: var(--paper);
  border: 3px solid var(--ink);
}
.pilot li:last-child::before {
  background: var(--signal);
  border-color: var(--signal);
}
.pilot h3 {
  font-size: var(--step-1);
}
.pilot p {
  color: var(--ink-soft);
  font-size: 0.96rem;
  max-width: 32ch;
}

/* FAQ -------------------------------------------------------------------------------- */
.faq {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  border-top: 1px solid var(--rule);
  margin-left: var(--margin-col);
}
.faq details {
  border-bottom: 1px solid var(--rule);
}
.faq summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 1.05rem 0;
  font-weight: 600;
  font-size: 1.05rem;
  cursor: pointer;
  list-style: none;
}
.faq summary::-webkit-details-marker {
  display: none;
}
.faq summary::after {
  content: "+";
  font-family: var(--font-mono);
  font-size: 1.2rem;
  color: var(--ink-faint);
}
.faq details[open] summary::after {
  content: "–";
}
.faq details p {
  max-width: 65ch;
  padding: 0 0 1.2rem;
  color: var(--ink-soft);
}

/* CTA ------------------------------------------------------------------------------------ */
.cta {
  background: var(--ink);
  color: var(--paper);
  padding-block: clamp(3.5rem, 8vw, 6rem);
}
.cta__inner {
  display: grid;
  gap: 1.2rem;
  justify-items: start;
}
.cta h2 {
  font-size: var(--step-3);
  max-width: 20ch;
  font-stretch: 125%;
}
.cta p {
  max-width: 52ch;
  color: color-mix(in srgb, var(--paper) 78%, transparent);
}
.cta .btn--primary {
  background: var(--highlighter);
  border-color: var(--highlighter);
  color: var(--highlighter-ink);
}
.cta__ghost {
  border-color: var(--paper);
  color: var(--paper);
}
.cta__ghost:hover {
  background: var(--paper);
  color: var(--ink);
}
.cta__email {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.95rem;
}
.cta__address {
  font-family: var(--font-mono);
  user-select: all;
  color: var(--paper);
}
.cta__email button {
  padding: 2px 10px;
  border: 1px solid color-mix(in srgb, var(--paper) 45%, transparent);
  border-radius: 6px;
  background: transparent;
  color: var(--paper);
  font: inherit;
  font-size: 0.82rem;
  cursor: pointer;
}

.foot {
  display: flex;
  flex-wrap: wrap;
  gap: 0.6rem 2rem;
  padding-block: 1.6rem calc(1.6rem + env(safe-area-inset-bottom, 0px));
  font-size: 0.86rem;
  color: var(--ink-faint);
}
.foot a {
  color: var(--ink-soft);
}

/* Responsive --------------------------------------------------------------------------- */
@media (max-width: 1020px) {
  .hero {
    grid-template-columns: minmax(0, 1fr);
  }
  .step__body--code {
    grid-template-columns: minmax(0, 1fr);
  }
}
@media (max-width: 860px) {
  .top__nav {
    display: none;
  }
  .top__theme {
    margin-left: auto;
  }
  .ba {
    grid-template-columns: minmax(0, 1fr);
  }
  .ba__side--before {
    border-right: 0;
    border-bottom: 1.5px solid var(--ink);
  }
  .wont {
    grid-template-columns: minmax(0, 1fr);
    gap: 1rem;
  }
  .pilot {
    grid-template-columns: minmax(0, 1fr);
    border-top: 0;
    border-left: 3px solid var(--ink);
    padding-left: 1.3rem;
    gap: 1.6rem;
  }
  .pilot li {
    padding: 0;
  }
  .pilot li::before {
    top: 0.3rem;
    left: calc(-1.3rem - 9px);
  }
  .faq {
    margin-left: 0;
  }
  .caps table,
  .caps thead,
  .caps tbody,
  .caps tr,
  .caps th,
  .caps td {
    display: block;
  }
  .caps thead {
    display: none;
  }
  .caps tr {
    padding: 0.9rem 1rem;
    border-bottom: 1px solid var(--rule);
  }
  .caps th,
  .caps td {
    padding: 0.15rem 0;
    border: 0;
  }
  .caps tbody th {
    white-space: normal;
  }
}
@media (max-width: 520px) {
  .legacy {
    grid-template-columns: 7rem minmax(0, 1fr);
  }
  .hero h1 {
    font-stretch: 110%;
  }
}
</style>
