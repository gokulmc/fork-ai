# forkai-code — Design audit (2026-07)

Read-only comparison of the shipped `apps/code-web` implementation against the design spec in
`_design/forkai-code/` (`foundations.html`, `tokens.css`, `landing-page.html`, `project-page.html`,
`code-workspace.html`, `map-git-graph.html`, `components.html`). No code was changed — this is a
findings document for triage.

**Scope note.** Per the audit brief, this report is *additive* to the active fix plan. It deliberately
**omits** the already-known gaps: the commit page's empty/no-run state, the misleading "done" status,
the clickable commit-pill and pushed/cost/budget chips; the projects-grid redesign (repo-aware cards /
dropping the highlights chip) and the momentum-bubble rework; the imported-commit diff; and the MindMap
imported badge. Everything below is something *else*.

**Headline.** The token layer is faithful — every `--kind-*`, `--commit-pill-*`, `--diff-*`, `--term-*`,
`--lane-line` value in `globals.css:42-128` matches `tokens.css` exactly, and the workspace/PR-pane/
composer/diff-summary/agent-log component CSS is a near-verbatim port. The real divergences are: (1) the
**Account/Billing menu is hardcoded light-theme** and breaks in dark mode; (2) **kind-label copy drift**
("Learn"→"Deep dive/Follow-up", "Code"→"Commit") across map + pane; (3) the **map's depth-based grey
card fill** fights the git-graph's kind-color language; (4) the **map legend is missing**; (5) the
**mixer's "Create implementation plan" checkbox** was replaced by a separate mode; and (6) the
**Landing illustration + features section** from the marketing mock aren't on the product landing.
Severity uses High/Med/Low; effort S/M/L.

Legend: **finding — design ref — current (file:line) — severity — effort**

---

## Landing (`landing-page.html` vs `Landing.tsx` / `globals.css`)

The product Landing swaps the mock's static hero-CTA for a live query box (confirmed intentional — the
`qbox-demo` in `components.html:272-314` is the sanctioned pattern). The illustration/features below are
present instead on a separate `/welcome` story route, so treat these as "not on the primary landing".

| Finding | Design ref | Current | Sev | Eff |
|---|---|---|---|---|
| Vertical git-graph hero illustration (`.illo-*` SVG, 8 cards) absent from the product landing | `landing-page.html:97-215` | `Landing.tsx` (no illo markup) | Med | M |
| 3-column "01 Learn / 02 Plans, not vibes / 03 One commit" features block absent | `landing-page.html:217-233` | `Landing.tsx` (none) | Med | M |
| H1 is oversized vs spec — `clamp(40px,6vw,64px)` vs design `clamp(34px,5.4vw,54px)` | `landing-page.html:36` | `globals.css:290` | Low | S |
| Hero sub copy dropped the 3rd sentence ("Fork from any commit to try a different approach…") | `landing-page.html:88-92` | `Landing.tsx:137-140` | Low | S |
| Nav: design shows a left brand mark + right "Sign in"; impl top-right buttons say "Login" (brand is a separate fixed `.app-brand`) | `landing-page.html:80-83` | `Landing.tsx:112-126`, `globals.css:851-896` | Low | S |
| Examples chip grid is an addition (not in the mock) — fine, but note it isn't spec'd | — | `Landing.tsx:229-233`, `globals.css:421-444` | Low | — |

---

## Projects / sessions grid (chrome only — card redesign is SKIPPED)

| Finding | Design ref | Current | Sev | Eff |
|---|---|---|---|---|
| Design has a bordered `.topbar` (brand + "+ New project" + account dot in-bar); impl uses a `.history-topbar` plus a separately-positioned fixed `.app-brand` and a floating gear for account | `project-page.html:22-28,79-85` | `HistoryPage.tsx:69-84`, `globals.css:859-896` | Low | M |
| `proj-modal` width 460px, tabs, switch, repo-list all match spec well (New/Attach tabs are an intended addition) | `project-page.html:127-188` | `globals.css:2601-2648`, `NewProjectModal.tsx` | Low (good) | — |

---

## Commit pane (`code-workspace.html` vs `AgentLogPane.tsx`)

Layout, `term-panel`, `log-line--*` variants, `diff-summary`, `gh-btn`, `mock-tag` are a near-exact port.

| Finding | Design ref | Current | Sev | Eff |
|---|---|---|---|---|
| CODE kind pill reads **"Commit"**, design reads **"Code"** (deliberate per `kindLabels.ts` comment, but diverges from spec) | `code-workspace.html:79`, `components.html:202` | `kindLabels.ts` (`CODE:'Commit'`), `AgentLogPane.tsx:189` | Low | S |
| `.ws-meta .pill` font-weight 500; design `.pill-kind` is 600 | `code-workspace.html:28` | `globals.css:1489` | Low | S |
| "Ask about this commit…" input row (`.agent-ask-row`) is an addition — not in the workspace mock; visually fine but unspecified | — | `AgentLogPane.tsx:289-312`, `globals.css:2720-2734` | Low | — |

---

## Git-graph map (`map-git-graph.html` vs `MindMap.tsx` / `globals.css`) — beyond the imported badge

| Finding | Design ref | Current | Sev | Eff |
|---|---|---|---|---|
| **Depth-based greyscale card fills** (`#fafafa → #c6c6c6` light, `#1c1c1c → #4a4a4a` dark) inherited from the research map — the git-graph design uses uniform `--paper` cards distinguished *only* by kind-tinted border + kicker + lane. The grey gradient dilutes the kind-color signal that is the git-graph's whole identity. | `map-git-graph.html:32-38` (paper cards) | `globals.css:1296-1310` | Med | M |
| **Map legend missing.** Design has a prominent bottom-left legend explaining all 6 node kinds + 4 edge treatments (lane/learn/fork/merge). Impl renders no legend at all — the new git-graph vocabulary (fork/merge arrows, collapsed segments, lane rails) ships with no key. | `map-git-graph.html:101-113` | no `.map-legend` in `MindMap.tsx` or `globals.css` | Med | M |
| Learn-node kicker reads **"Deep dive" / "Follow-up"**; design map (and legend) label both DEEPER and ASK as **"Learn"** | `map-git-graph.html:417`, legend `:102` | `kindLabels.ts`, `MindMap.tsx:473` | Med | S |
| BRANCH commit-pill reads `⎇ branch · fork @sha`; design shows plain `⎇ branch · sha` | `map-git-graph.html:134,198` | `MindMap.tsx:489,566` | Low | S |
| Learn cards get no dedicated off-white tint — design gives learn cards `#fafafa`/`#1c1c1c` distinct from rail cards; impl leans on the depth fill only | `map-git-graph.html:33` | `globals.css:1296-1310` (depth-only) | Low | S |

---

## Login (`LoginPage.tsx`)

No forkai-code design file exists for Login (inherits the fork.ai graph-login). Audited against the
foundations token rules only.

| Finding | Design ref | Current | Sev | Eff |
|---|---|---|---|---|
| Mostly token-driven (`var(--ink*)`) so it is theme-aware; one hardcoded error color `#c0392b` | foundations (desaturated palette) | `LoginPage.tsx:940` | Low | S |
| No code-product-specific login art/copy — the graph-login is generic; acceptable but unspec'd | — | `LoginPage.tsx` | Low | — |

---

## Account / Billing menu (`AccountButton.tsx`) — biggest offender

No design spec exists, but this screen violates the foundations "theme-aware / tokenized" contract wholesale.

| Finding | Design ref | Current | Sev | Eff |
|---|---|---|---|---|
| **Entire popover hardcoded light theme** — `background:'#ffffff'`, `color:'#0a0a0a'`, `border:'rgba(10,10,10,0.15)'`, backdrop/gear too. In dark mode this is a white card with near-black text floating over the dark app. | foundations `[data-theme="dark"]` contract | `AccountButton.tsx:348,367,373,414,474,532` (+throughout) | **High** | M |
| Whole menu uses `--mono` (`ui-monospace,'JetBrains Mono'…`) for chrome; foundations reserves mono for commit pills / code / log, sans for UI | foundations Type | `AccountButton.tsx:371` | Med | S |
| Uses zero design tokens (`--paper/--ink/--sans/--line`); the only screen fully off the token system | `tokens.css` | `AccountButton.tsx` (all inline hex) | Med | M |
| Saturated success/error colors `#27ae60` / `#c0392b` (billing rows, sign-out, out-of-credit) — not the desaturated palette | foundations "desaturated" | `AccountButton.tsx:378,396,425,567,687` | Low | S |

---

## New Project modal (`project-page.html` modal vs `NewProjectModal.tsx`)

Strong, faithful port — `proj-modal` 460px, `proj-field-*`, `proj-repo-*`, `proj-switch`, plugin rows all
match `tokens.css`. Two tabs ("New repo" / "Attach existing") are an intended extension of the single-form
mock. No material divergences found. (Good.)

---

## Tweaks panel (`TweaksPanel.tsx`)

No design spec. Uses `var(--ink*)` tokens throughout, so it is theme-aware.

| Finding | Design ref | Current | Sev | Eff |
|---|---|---|---|---|
| Success confirmation color hardcoded `#27ae60` (saturated, off-palette) | foundations | `TweaksPanel.tsx:525` | Low | S |

---

## PR pane (`components.html` PR pane vs `PrPane.tsx`)

Near-exact match — `pr-status-pill`, `pr-branches-row`, violet `pr-merge-btn`, `pr-merged-row`/`badge`/`link`
all match tokens.

| Finding | Design ref | Current | Sev | Eff |
|---|---|---|---|---|
| `.pr-branches-row` margin-bottom 28px vs design 20px | `components.html:92` | `globals.css:2748` | Low | S |

---

## Mixer (`components.html` mixer vs `App.tsx` / `globals.css`)

| Finding | Design ref | Current | Sev | Eff |
|---|---|---|---|---|
| **"Create implementation plan" checkbox removed.** Design puts an inline `.mixer-plan-row` checkbox in the mixer that relabels spawn to "Plan & Spawn". Impl instead makes Plan a *separate map-toolbar mode* (`mixer-overlay--plan`, `.mm-plan-btn`) — the inline checkbox affordance doesn't exist. | `components.html:367-384` | `App.tsx:2735-2789`, `globals.css:2340-2355,2420-2427` | Med | M |
| Question placeholder differs — design "Ask a question about these nodes…"; impl "What should I synthesize?" / "What should the plan achieve?" | `components.html:380` | `App.tsx:2766` | Low | S |
| Neutral spawn button reads "Mix & Spawn" (design only shows the "Plan & Spawn" checked state) | `components.html:381` | `App.tsx:2786` | Low | S |
| `.mixer-chip` max-width 160px vs design 200px | `components.html:103` | `globals.css:2460` | Low | S |

---

## Code composer (`components.html` composer vs `CodeComposer.tsx`)

Faithful port — `code-composer-inner`, `-chips`, `-row`, 30px round attach/send buttons, textarea all match
`components.html:76-83`. Placeholder is "Describe what the agent should build…" vs the mock's example
sentence — fine. No material divergences. (Good.)

---

## Section rendering (`Section.tsx`)

Inherited fork.ai markdown renderer (marked + hljs + KaTeX); no code-product design spec. Renders the body
of LEARN and PLAN nodes. Consistent with tokens.

| Finding | Design ref | Current | Sev | Eff |
|---|---|---|---|---|
| PLAN nodes open into a generic markdown Section view; the design only ever depicts a PLAN as a *map card* — the plan reading/editing surface is unspecified and just reuses research styling | — | `Section.tsx`, `App.tsx` (PLAN routing) | Low | — |
| Code fences use hardcoded `#fafafa`/`#1c1c1c` backgrounds rather than `--panel` | foundations | `globals.css:1578-1579` | Low | S |

---

## Cross-cutting

| Finding | Detail | Current | Sev | Eff |
|---|---|---|---|---|
| **Error/success colors are un-tokenized and inconsistent.** Five different reds coexist — `#c0392b`, `#c4452e`, `#b53939`, `#e03e3e`, `rgba(224,62,62,…)` — plus greens `#27ae60`, `#22c55e`. None are tokens; the desaturated foundations palette (e.g. `--diff-del #a34438`) is ignored for status. Introduce `--danger`/`--success` tokens. | across app | `globals.css:599,1464,1831,1846,2622,2760`; `AccountButton/Landing/Login/TweaksPanel` inline | Med | M |
| **Mixer selection ring uses saturated `#22c55e`** — clashes with the desaturated `--kind-branch #4d8a63`; the git-graph deliberately avoids saturated green | selection feedback | `globals.css:2393` | Low-Med | S |
| **Kind-label copy drift spans map + pane.** Design's unified "Learn" (DEEPER+ASK) and "Code" (CODE) became "Deep dive"/"Follow-up"/"Commit". Deliberate per `kindLabels.ts`, but it means the shipped copy no longer matches any design file. Decide which wins and align the spec or the code. | copy | `kindLabels.ts`; `MindMap.tsx:473`, `AgentLogPane.tsx:189` | Med | S |
| **Dark mode is solid everywhere except AccountButton** (see Account section) — Landing, workspace, map (depth-fill overrides), PR pane, composer, tweaks, mixer all carry `[data-theme="dark"]` handling. AccountButton is the lone regression. | dark mode | `AccountButton.tsx` | High | M |
| **Mono creep in chrome.** Foundations scopes mono to commit pills / code / agent-log. AccountButton renders its whole menu in mono; the landing footer tagline is mono (intended). Keep mono to code-ish surfaces. | type scale | `AccountButton.tsx:371` | Low-Med | S |
| Mobile safe-area offsets are handled for `.landing-nav`, `.landing-inner`, `.app-brand`, `.code-composer`, mixer overlay (`globals.css:2157-2280`). The **fixed AccountButton gear** (`bottom:24;left:24`, inline in `AccountButton.tsx:346`) has no `env(safe-area-inset-bottom)` offset and can collide with the composer / home indicator on device. | responsive | `AccountButton.tsx:346` | Low | S |

---

## Top 10 to fix first

1. **AccountButton dark mode** — retheme the whole popover/gear/billing panel onto `--paper/--ink/--line/--sans` so it stops rendering a white card in dark mode. (High / M) — `AccountButton.tsx`
2. **Add the map legend** — port the 6-kind + 4-edge legend from `map-git-graph.html:101-113`; the new git-graph vocabulary ships with no key. (Med / M)
3. **Reconcile kind-label copy** — "Learn" vs "Deep dive/Follow-up" and "Code" vs "Commit"; pick a winner and align spec or `kindLabels.ts`. (Med / S)
4. **Map card fill** — drop (or heavily flatten) the depth-based greyscale so kind-tinted borders read as intended paper cards. (Med / M) — `globals.css:1296-1310`
5. **Tokenize status colors** — introduce `--danger`/`--success`, replace the five ad-hoc reds + two greens. (Med / M)
6. **Mixer "Create implementation plan" affordance** — either restore the inline checkbox from `components.html:375-378` or update the spec to the map-toolbar-mode reality. (Med / M)
7. **Landing marketing pieces** — decide whether the hero illustration + features belong on the product landing or stay solely on `/welcome`; if the latter, mark `landing-page.html` as marketing-only. (Med / M)
8. **AccountButton off the token system + mono chrome** — same pass as #1: switch to `--sans` and design tokens. (Med / S–M)
9. **Landing H1 + hero copy** — bring `clamp(40px,6vw,64px)` back toward the spec's `clamp(34px,5.4vw,54px)` and restore the dropped "Fork from any commit…" sentence. (Low / S)
10. **AccountButton gear safe-area** — add `env(safe-area-inset-bottom)` so it clears the composer/home indicator on mobile. (Low / S)
