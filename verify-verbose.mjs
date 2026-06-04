// Fork.ai Verbose Mode Verification Script
// Strategy:
//   - TEST 1: Verbose mode — mock the /sessions/stream endpoint to return
//     pre-canned verbose SSE events (avoids 2.5min wait, tests full UI flow)
//   - TEST 2: Sectioned mode — real API call (works in ~30s)
//   - Both tests verify: Tweaks panel, toggle UI, result rendering

import { chromium } from 'playwright';
import { mkdirSync } from 'fs';

const SCREENSHOT_DIR = '/tmp/fork-verify4';
mkdirSync(SCREENSHOT_DIR, { recursive: true });

let screenshotIdx = 0;
async function shot(page, name) {
  screenshotIdx++;
  const p = `${SCREENSHOT_DIR}/${String(screenshotIdx).padStart(2,'0')}-${name}.png`;
  await page.screenshot({ path: p, fullPage: false });
  console.log(`[screenshot] ${p}`);
}
async function shotFull(page, name) {
  const p = `${SCREENSHOT_DIR}/${name}.png`;
  await page.screenshot({ path: p, fullPage: true });
  console.log(`[screenshot-full] ${p}`);
}

// Pre-canned verbose SSE response — mirrors ACTUAL backend protocol:
// - meta event (title, emoji, lede)
// - section events (id, heading, body) — verbose uses same section schema, just more/longer sections
// - done event (sessionId, nodeId)
const VERBOSE_SSE_SECTIONS = [
  {
    id: 'sec-01',
    heading: 'What is Quantum Entanglement?',
    body: 'Quantum entanglement is one of the most remarkable and counterintuitive phenomena in all of physics. It occurs when two or more particles become **correlated** in such a way that the quantum state of each particle cannot be described independently of the others, even when separated by large distances.\n\nWhen two particles are entangled, measuring a property of one **instantaneously determines** the corresponding property of the other, regardless of separation. This happens not because of any hidden signal but because their quantum states are genuinely non-separable — described by a single joint wave function.',
  },
  {
    id: 'sec-02',
    heading: 'Historical Background: The EPR Paradox',
    body: 'In 1935, Einstein, Podolsky, and Rosen published a famous paper arguing that quantum mechanics must be **incomplete**. They showed that if QM was correct, measuring one particle of an entangled pair would instantaneously affect the other — a "spooky action at a distance" Einstein found deeply troubling.\n\nEinstein believed this implied **hidden variables** — pre-determined properties particles carry from the start. If hidden variables existed, QM would merely be a statistical description of a deeper deterministic theory rather than the final word.',
  },
  {
    id: 'sec-03',
    heading: "Bell's Theorem and Experimental Tests",
    body: "In 1964, John Bell derived inequalities that any local hidden variable theory must satisfy. Quantum mechanics predicts **violations** of these inequalities.\n\nExperiments by Alain Aspect (1982) and many subsequent teams have conclusively violated Bell inequalities, ruling out local hidden variable theories. This means:\n\n- Quantum entanglement is **real** and cannot be explained by particles secretly carrying predetermined values\n- The correlations are **non-local** in a precise mathematical sense\n- No information travels between particles faster than light (no FTL signaling)",
  },
  {
    id: 'sec-04',
    heading: 'Applications in Quantum Technology',
    body: 'Entanglement is the resource underlying many quantum technologies:\n\n| Technology | Role of Entanglement |\n|---|---|\n| Quantum cryptography (QKD) | Guarantees eavesdropping detection |\n| Quantum teleportation | Transfers quantum states faithfully |\n| Quantum computing | Enables exponential speedup via superposition + entanglement |\n| Quantum sensing | Surpasses classical measurement precision limits |\n\nQuantum entanglement is not just a fascinating phenomenon — it is the **foundational resource** of the quantum information revolution now underway.',
  },
  {
    id: 'sec-05',
    heading: 'Open Questions and Interpretations',
    body: "Different interpretations of quantum mechanics handle entanglement differently:\n\n- **Copenhagen**: wave function collapses non-locally on measurement (a convenient formalism, not a physical mechanism)\n- **Many Worlds**: measurement splits the universal wave function — no collapse, no spooky action\n- **Pilot Wave (de Broglie–Bohm)**: non-local hidden variable theory that is explicitly non-local (consistent with Bell's results)\n- **Relational QM**: quantum states are relational — there is no observer-independent description\n\nNone of these interpretations allow faster-than-light communication, but they differ profoundly on what 'really happens.'",
  },
];

const VERBOSE_SSE_EVENTS = [
  `data: {"type":"meta","title":"Quantum Entanglement Explained","emoji":"⚛️","lede":"Quantum entanglement links particles so their fates are intertwined regardless of distance."}\n\n`,
  ...VERBOSE_SSE_SECTIONS.map(s =>
    `data: ${JSON.stringify({ type: 'section', ...s })}\n\n`
  ),
  `data: {"type":"done","sessionId":"test-session-123","nodeId":"test-node-456"}\n\n`,
].join('');

const consoleErrors = [];

async function createPage(browser, outputMode, mockVerboseAPI = false) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });

  // Mock next-auth session
  await context.route('**/api/auth/session', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ user: { email: 'dev@localhost' }, expires: '2099-01-01', idToken: 'dev-bypass' }),
    });
  });
  await context.route('**/api/auth/csrf', async (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{"csrfToken":"x"}' }));
  await context.route('**/api/auth/providers', async (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));

  if (mockVerboseAPI) {
    // Mock the verbose streaming endpoint to return pre-canned events
    await context.route('**/sessions/stream', async (route) => {
      const body = route.request().postDataJSON();
      if (body?.outputMode === 'verbose') {
        await route.fulfill({
          status: 201,
          headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
          },
          body: VERBOSE_SSE_EVENTS,
        });
      } else {
        await route.continue();
      }
    });
  }

  await context.addInitScript((mode) => {
    sessionStorage.setItem('fork.ai.visited', '1');
    localStorage.removeItem('fork.ai.session');
    localStorage.removeItem('fork.ai.node');
    localStorage.setItem('fork.ai.tweaks', JSON.stringify({
      theme: 'light', accent: '#525252', density: 'comfortable',
      mapLayout: 'vertical', fontPair: 'newsreader-geist', outputMode: mode,
    }));
  }, outputMode);

  const page = await context.newPage();
  page.on('console', msg => {
    if (msg.type() === 'error') {
      const txt = msg.text();
      if (txt.includes('ERR_FAILED') || txt.includes('favicon') || txt.includes('net::')) return;
      consoleErrors.push(txt);
      console.log(`[console ERROR] ${txt}`);
    }
  });
  page.on('pageerror', err => {
    consoleErrors.push(err.message);
    console.log(`[page ERROR] ${err.message}`);
  });
  return { context, page };
}

const R = {}; // Results

(async () => {
  const browser = await chromium.launch({ headless: true });

  // ════════════════════════════════════════════════════════════
  // TEST 1: VERBOSE MODE (mocked SSE to avoid 2.5min wait)
  // ════════════════════════════════════════════════════════════
  console.log('\n══ TEST 1: VERBOSE MODE (mock SSE) ══════════════════');
  const { context: c1, page: p1 } = await createPage(browser, 'verbose', true);

  // Step 1: Open app
  console.log('\n[Step 1] Open app');
  await p1.goto('http://localhost:3001', { waitUntil: 'networkidle' });
  await p1.waitForTimeout(1000);
  await shot(p1, '01-landing-verbose');

  R.loginBypassed = !(await p1.locator('button[aria-label="Continue"]').isVisible({ timeout: 2000 }).catch(() => false));
  R.noInitErrors = consoleErrors.length === 0;
  console.log(`[${R.loginBypassed ? 'PASS' : 'FAIL'}] Login bypassed (main app shows landing page)`);
  console.log(`[${R.noInitErrors ? 'PASS' : 'FAIL'}] No console errors on load`);

  // Step 2: Console errors check
  console.log('\n[Step 2] Console errors on initial load:', consoleErrors.length === 0 ? 'NONE' : consoleErrors);

  // Step 3: Open Tweaks panel — but it's only available in workspace
  // Submit a query first (uses mocked SSE for verbose)
  console.log('\n[Step 3] Submit verbose query "What is quantum entanglement?" (mocked SSE)');
  const input1 = p1.locator('input[type="text"]').first();
  await input1.fill('What is quantum entanglement?');
  await shot(p1, '02-query-typed-verbose');
  await p1.locator('button.submit').first().click();
  console.log('[info] Query submitted');

  // Wait for workspace and content (verbose uses section rendering — wait for .section-num)
  try {
    await p1.waitForSelector('.section-num', { timeout: 30000, state: 'visible' });
    console.log('[info] Workspace appeared with sections');
    // Wait for all 5 mocked sections to appear
    await p1.waitForFunction(() => document.querySelectorAll('.section-num').length >= 5, { timeout: 10000 });
    console.log('[info] All 5 mocked verbose sections rendered');
  } catch {
    console.log('[warn] Sections did not appear within timeout');
  }
  await p1.waitForTimeout(1000);
  await shot(p1, '03-verbose-result');
  await shotFull(p1, 'verbose-result-full');

  // Step 3b: Inspect verbose result
  // NOTE: Verbose mode uses the SAME section schema as sectioned (same rendering),
  // just with a different prompt: no section count cap, no length limit per section.
  // So we expect: .section-num, h2[data-section-heading], .deeper-btn — same as sectioned.
  // The pill shows "N sections" (not a special "Verbose" label).
  console.log('\n[Step 3b] Inspecting verbose result (uses same section rendering as sectioned mode)');
  const pills = await p1.locator('.pill').allTextContents();
  const deeperBtns = await p1.locator('.deeper-btn').count();
  const sectionNums = await p1.locator('.section-num').count();
  const sectionHeadings = await p1.locator('h2[data-section-heading]').count();
  const sectionHeadingTexts = await p1.locator('h2[data-section-heading]').allTextContents();
  const loading = await p1.locator('.thinking').isVisible({ timeout: 1000 }).catch(() => false);
  const verboseBodyCount = await p1.locator('.verbose-body').count(); // should be 0 (uses section rendering)

  console.log(`[info] .pill contents: ${JSON.stringify(pills)}`);
  console.log(`[info] .section-num count: ${sectionNums}`);
  console.log(`[info] h2[data-section-heading] count: ${sectionHeadings}`);
  console.log(`[info] section headings: ${JSON.stringify(sectionHeadingTexts)}`);
  console.log(`[info] .deeper-btn count: ${deeperBtns}`);
  console.log(`[info] .verbose-body count (should be 0 — verbose uses section rendering): ${verboseBodyCount}`);
  console.log(`[info] Still loading: ${loading}`);

  // Verbose uses the same section rendering — check for sections, not a prose body
  R.verboseHasSections = sectionNums >= 5 && sectionHeadings >= 5;
  R.verboseHasDeeperBtns = deeperBtns >= 5;
  R.verbosePillShowsCount = pills.some(t => /\d+\s*sections?/i.test(t));
  R.verboseNoVerboseBodyDiv = verboseBodyCount === 0; // confirmed: verbose uses section rendering
  R.verboseNotLoading = !loading;

  console.log(`[${R.verboseHasSections ? 'PASS' : 'FAIL'}] Verbose result renders numbered sections (found ${sectionNums} .section-num, ${sectionHeadings} h2[data-section-heading])`);
  console.log(`[${R.verboseHasDeeperBtns ? 'PASS' : 'FAIL'}] Verbose result has Go Deeper buttons (found ${deeperBtns})`);
  console.log(`[${R.verbosePillShowsCount ? 'PASS' : 'INFO'}] Section count pill (pills: ${JSON.stringify(pills)})`);
  console.log(`[${R.verboseNoVerboseBodyDiv ? 'PASS' : 'FAIL'}] Verbose uses section rendering (no .verbose-body div, as expected)`);
  console.log(`[${R.verboseNotLoading ? 'PASS' : 'FAIL'}] Not still loading`);

  // Step 4: Open Tweaks panel in workspace
  console.log('\n[Step 4] Open Tweaks panel in workspace');
  const gear1 = p1.locator('button.twk-trigger, button[aria-label="Open tweaks panel"]').first();
  R.gearVisible = await gear1.isVisible({ timeout: 5000 }).catch(() => false);
  console.log(`[${R.gearVisible ? 'PASS' : 'FAIL'}] Gear button (⚙) visible in workspace`);

  if (R.gearVisible) {
    await gear1.click();
    await p1.waitForTimeout(700);
    await shot(p1, '04-tweaks-open-verbose');

    const panelVisible = await p1.locator('.twk-panel').isVisible({ timeout: 2000 }).catch(() => false);
    const sectLabels = await p1.evaluate(() =>
      [...document.querySelectorAll('.twk-sect')].map(e => e.textContent?.trim())
    );
    const verboseBtn = p1.locator('button[role="radio"]:has-text("Verbose")').first();
    const sectionedBtn = p1.locator('button[role="radio"]:has-text("Sectioned")').first();
    const verboseChecked = await verboseBtn.getAttribute('aria-checked').catch(() => null);
    const sectionedChecked = await sectionedBtn.getAttribute('aria-checked').catch(() => null);

    R.tweaksPanelOpens = panelVisible;
    R.outputSectionPresent = sectLabels.includes('Output');
    R.verboseRadioPresent = await verboseBtn.isVisible({ timeout: 2000 }).catch(() => false);
    R.sectionedRadioPresent = await sectionedBtn.isVisible({ timeout: 2000 }).catch(() => false);
    R.verboseSelectedInPanel = verboseChecked === 'true';
    R.sectionedNotSelectedInPanel = sectionedChecked === 'false';

    console.log(`[${R.tweaksPanelOpens ? 'PASS' : 'FAIL'}] Tweaks panel opens`);
    console.log(`[info] twk-sect labels: ${JSON.stringify(sectLabels)}`);
    console.log(`[${R.outputSectionPresent ? 'PASS' : 'FAIL'}] "Output" section present in Tweaks panel`);
    console.log(`[${R.verboseRadioPresent ? 'PASS' : 'FAIL'}] "Verbose" radio button present`);
    console.log(`[${R.sectionedRadioPresent ? 'PASS' : 'FAIL'}] "Sectioned" radio button present`);
    console.log(`[${R.verboseSelectedInPanel ? 'PASS' : 'FAIL'}] "Verbose" currently selected (aria-checked="${verboseChecked}")`);

    await shot(p1, '05-tweaks-verbose-confirmed');

    // Step 5: Toggle to Sectioned
    console.log('\n[Step 5] Toggle to "Sectioned"');
    await sectionedBtn.click();
    await p1.waitForTimeout(500);
    const newSectionedChecked = await sectionedBtn.getAttribute('aria-checked').catch(() => null);
    const newVerboseChecked = await verboseBtn.getAttribute('aria-checked').catch(() => null);
    R.sectionedToggleWorks = newSectionedChecked === 'true';
    R.verboseUncheckedAfterToggle = newVerboseChecked === 'false';
    console.log(`[${R.sectionedToggleWorks ? 'PASS' : 'FAIL'}] Toggle to Sectioned works (aria-checked="${newSectionedChecked}")`);
    console.log(`[${R.verboseUncheckedAfterToggle ? 'PASS' : 'FAIL'}] Verbose unchecked (aria-checked="${newVerboseChecked}")`);
    await shot(p1, '06-tweaks-sectioned-toggled');

    const closeBtn = p1.locator('button[aria-label="Close tweaks"], button.twk-x').first();
    if (await closeBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
      await closeBtn.click();
      await p1.waitForTimeout(400);
    }
  }

  await c1.close();

  // ════════════════════════════════════════════════════════════
  // TEST 2: SECTIONED MODE (real API call)
  // ════════════════════════════════════════════════════════════
  console.log('\n══ TEST 2: SECTIONED MODE (real API) ════════════════');
  const errsBefore = consoleErrors.length;
  const { context: c2, page: p2 } = await createPage(browser, 'sectioned', false);

  console.log('\n[Step 6] Submit sectioned query "How does TCP work?"');
  await p2.goto('http://localhost:3001', { waitUntil: 'networkidle' });
  await p2.waitForTimeout(1000);
  await p2.locator('input[type="text"]').first().fill('How does TCP work?');
  await shot(p2, '07-query-typed-sectioned');
  await p2.locator('button.submit').first().click();
  await p2.waitForSelector('.app', { timeout: 10000 }).catch(() => {});
  await shot(p2, '08-sectioned-loading');

  console.log('[info] Waiting up to 90s for 5 sections to load...');
  const sectStart = Date.now();
  try {
    await p2.waitForSelector('.section-num', { timeout: 90000, state: 'visible' });
    console.log(`[info] First section after ${((Date.now()-sectStart)/1000).toFixed(1)}s`);
    // Wait for all 5 to stream in
    await p2.waitForFunction(() => document.querySelectorAll('.section-num').length >= 5, { timeout: 60000 });
    console.log('[info] All 5 sections loaded');
  } catch {
    console.log('[warn] Timed out waiting for all 5 sections');
  }
  await p2.waitForTimeout(2000);
  await shot(p2, '09-sectioned-result');
  await shotFull(p2, 'sectioned-result-full');

  // Step 6b: Inspect sectioned result
  console.log('\n[Step 6b] Inspecting sectioned result');
  const s2Nums = await p2.locator('.section-num').count();
  const s2Headings = await p2.locator('h2[data-section-heading]').count();
  const s2Deeper = await p2.locator('.deeper-btn').count();
  const s2Pills = await p2.locator('.pill').allTextContents();
  const s2HeadingTexts = await p2.locator('h2[data-section-heading]').allTextContents();
  const s2VerboseBody = await p2.locator('.verbose-body').count();
  const s2Errs = consoleErrors.slice(errsBefore);

  console.log(`[info] .section-num: ${s2Nums}, h2[data-section-heading]: ${s2Headings}`);
  console.log(`[info] .deeper-btn: ${s2Deeper}`);
  console.log(`[info] .pill: ${JSON.stringify(s2Pills)}`);
  console.log(`[info] Section headings: ${JSON.stringify(s2HeadingTexts)}`);
  console.log(`[info] .verbose-body count (should be 0): ${s2VerboseBody}`);

  R.sectHasSections = s2Nums >= 5 || s2Headings >= 5;
  R.sectHasDeeperBtns = s2Deeper >= 5;
  R.sectPillShowsCount = s2Pills.some(t => /\d+\s*section/i.test(t));
  R.sectNoVerboseBody = s2VerboseBody === 0;
  R.sectNoNewErrors = s2Errs.length === 0;

  console.log(`[${R.sectHasSections ? 'PASS' : 'WARN'}] 5 sections loaded (found ${Math.max(s2Nums, s2Headings)})`);
  console.log(`[${R.sectHasDeeperBtns ? 'PASS' : 'WARN'}] Go Deeper button per section (found ${s2Deeper})`);
  console.log(`[${R.sectPillShowsCount ? 'PASS' : 'WARN'}] Section count pill in header (${JSON.stringify(s2Pills)})`);
  console.log(`[${R.sectNoVerboseBody ? 'PASS' : 'FAIL'}] Sectioned uses section rendering (no verbose-body div)`);
  console.log(`[${R.sectNoNewErrors ? 'PASS' : 'FAIL'}] No console errors in sectioned mode (${s2Errs.length} new errors)`);

  // Open tweaks in sectioned to confirm Sectioned is active
  const gear2 = p2.locator('button.twk-trigger, button[aria-label="Open tweaks panel"]').first();
  if (await gear2.isVisible({ timeout: 3000 }).catch(() => false)) {
    await gear2.click();
    await p2.waitForTimeout(600);
    await shot(p2, '10-tweaks-sectioned-mode');
    const sectBtnChecked = await p2.locator('button[role="radio"]:has-text("Sectioned")').getAttribute('aria-checked').catch(() => null);
    R.sectionedActiveInSectionedMode = sectBtnChecked === 'true';
    console.log(`[${R.sectionedActiveInSectionedMode ? 'PASS' : 'FAIL'}] "Sectioned" radio is active in sectioned mode`);
  }

  await c2.close();

  // ════════════════════════════════════════════════════════════
  // FINAL VERDICT
  // ════════════════════════════════════════════════════════════
  console.log('\n╔══════════════════════════════════════════════════════╗');
  console.log('║  FINAL VERDICT                                       ║');
  console.log('╚══════════════════════════════════════════════════════╝');

  // Note: Verbose mode uses the SAME section rendering as sectioned mode.
  // The difference is in the prompt: verbose has no section count cap and no length limit.
  // Both modes render .section-num, h2[data-section-heading], .deeper-btn, and a "N sections" pill.
  const checks = [
    ['(a) Login bypass — landing page shows without auth wall', R.loginBypassed],
    ['(a) No console errors on initial load', R.noInitErrors],
    ['(b) Gear/Tweaks button is visible in workspace', R.gearVisible],
    ['(b) Tweaks panel opens when gear is clicked', R.tweaksPanelOpens],
    ['(b) "Output" section present in Tweaks panel', R.outputSectionPresent],
    ['(b) "Sectioned" radio button present', R.sectionedRadioPresent],
    ['(b) "Verbose" radio button present', R.verboseRadioPresent],
    ['(c) Verbose is selected when outputMode=verbose pre-set', R.verboseSelectedInPanel],
    ['(d) Verbose result renders numbered sections (same as sectioned — correct)', R.verboseHasSections],
    ['(d) Verbose result has Go Deeper buttons per section', R.verboseHasDeeperBtns],
    ['(d) Verbose result is not stuck in loading state', R.verboseNotLoading],
    ['(d) Verbose uses section rendering (no .verbose-body div)', R.verboseNoVerboseBodyDiv],
    ['(e) Toggle to Sectioned changes aria-checked', R.sectionedToggleWorks],
    ['(e) Verbose becomes unchecked after toggle', R.verboseUncheckedAfterToggle],
    ['(f) Sectioned result renders numbered sections (.section-num)', R.sectHasSections],
    ['(f) Sectioned result has Go Deeper buttons (.deeper-btn)', R.sectHasDeeperBtns],
    ['(f) Section count pill in header (e.g. "5 sections")', R.sectPillShowsCount],
    ['(f) Sectioned mode does NOT render verbose-body div', R.sectNoVerboseBody],
    ['(f) No console errors during sectioned query', R.sectNoNewErrors],
    ['(f) "Sectioned" is active in Tweaks when in sectioned mode', R.sectionedActiveInSectionedMode],
  ];

  let passCount = 0, failCount = 0;
  for (const [label, pass] of checks) {
    const icon = pass === true ? 'PASS' : pass === false ? 'FAIL' : 'SKIP';
    if (pass === true) passCount++;
    else if (pass === false) failCount++;
    console.log(`[${icon}] ${label}`);
  }

  console.log(`\nTotal: ${passCount} PASS, ${failCount} FAIL`);
  console.log(`All console errors: ${consoleErrors.length}`);
  consoleErrors.forEach(e => console.log('  ERROR:', e));
  console.log(`Screenshots: ${SCREENSHOT_DIR}`);
  console.log(`\nOverall: ${failCount === 0 ? 'PASS' : 'PARTIAL PASS — see failures above'}`);

  await browser.close();
})().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
