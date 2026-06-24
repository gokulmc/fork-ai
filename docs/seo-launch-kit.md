# fork ai — SEO & Launch Kit

Everything here is copy-paste ready. The goal of this kit is the one thing code can't do for you: **earn backlinks and referral traffic** so Google starts trusting `forkai.in` and crawling the blog. As of the baseline (June 2026): ~262 pageviews/90d, ~100% homepage, ~8 organic search clicks, **zero referral/backlink traffic**. Every item below is aimed at changing that.

> ⚠️ **Authenticity rule:** HN, Reddit, and Product Hunt punish anything that smells like marketing automation or astroturfing. Post from your real account, in your own voice, and be present to answer comments for the first few hours. Use the copy below as a strong first draft, then make it sound like *you*.

---

## 0. Do these first (this week, ~1 hour)

1. **Google Search Console** — add `forkai.in` as a *Domain* property (DNS verification via Route 53). Submit `https://forkai.in/sitemap.xml`. Then URL-Inspect → **Request indexing** for the homepage and the 3 new `/vs` pages. → *Give me the TXT token and I'll add the Route 53 record + verification tag.*
2. **Bing Webmaster Tools** — add the site, import from GSC (one click), submit the sitemap. Bing feeds ChatGPT/Copilot search.
3. **Claim brand profiles** (these double as your first backlinks): Product Hunt, Crunchbase, LinkedIn company page, X/Twitter, a GitHub org. This also helps you win the crowded "fork ai" brand SERP against forkai.tech / Fork.ai (the B2B tool).

---

## 1. Show HN (Hacker News)

**Title** (≤ 80 chars, no "Show HN:" hype — HN hates adjectives):
```
Show HN: fork.ai – branch any AI answer into a mind map instead of a chat log
```

**URL:** `https://forkai.in`

**First comment** (post immediately after submitting — this is where you tell the story):
```
I kept finishing long ChatGPT/Claude sessions having learned a lot but unable to
find any of it later. The linear chat format was the problem: tangents bury your
place, and the model blends your careful deep-dive with an unrelated detour from
ten messages ago.

fork.ai answers a question as structured sections instead of one blob. From any
section you can "go deeper" into a child node, or highlight a sentence and branch
a follow-up anchored to exactly that text. Every branch becomes a node on a live
mind map, and each branch only inherits its own context lineage — so answers stay
sharp as you go deeper instead of degrading.

Stack: Next.js 15 + NestJS, DynamoDB single-table, streaming SSE for the root
answer. Branch calls run on a model you pick (Claude / Gemini / DeepSeek / GLM);
root is Claude Sonnet. You can export a session to Notion or PDF.

It's free to try (no signup needed for a first session). I'd genuinely love
feedback on the branching UX and where it breaks down. Happy to answer anything
about the architecture.
```

**Timing:** weekday, ~8–10am US Eastern. Don't ask anyone to upvote (fast way to get flagged). Reply to every comment.

---

## 2. Product Hunt

**Name:** fork ai
**Tagline** (≤ 60 chars):
```
Branch any AI answer into a mind map you can keep
```
**Alternatives to try:** `Ask once, branch forever — AI research as a mind map` · `The branching research workspace for AI`

**Description:**
```
fork ai turns one question into a branching map instead of a chat log.

Ask anything and get a structured answer split into sections. Go deeper on any
section into a child node, or highlight a passage and ask a follow-up branched
from that exact text. Every branch becomes a node on a live mind map — so a
research session becomes something navigable you can revisit, extend, and keep.

• Branching, not linear chat — tangents become their own threads
• Cleaner context per branch = sharper answers as you go deeper
• Pick your model per branch: Claude, Gemini, DeepSeek, GLM
• Optional web search with sources
• Export any session to Notion or PDF

Free to start. Built for anyone who researches, studies, or learns with AI.
```

**First comment (maker):** reuse the HN first-comment story, slightly warmer.

**Gallery:** 1) the mind map mid-session (hero), 2) highlight → "Ask AI" branching, 3) a section answer, 4) Notion export, 5) the comparison diagram from the blog. **Launch Tue–Thu**, have a thumbnail + a 30–60s screen-recording.

---

## 3. Reddit

Read each sub's rules first; several require self-promo to stay under ~10% of your activity. Lead with the *idea*, not the pitch. One post per sub, spaced out over days.

**r/ArtificialIntelligence / r/artificial** — angle: the format critique
```
Title: Linear chat is the wrong shape for research — I built a branching alternative

Body: Every AI chat is one column: oldest at top, newest at bottom. Fine for
"fix this email," terrible for research, where one question spawns five. Tangents
bury your place and the model blends unrelated context together.

I built fork.ai to test a different shape: answers split into sections, any
section branches into its own node with its own context, and the whole thing is a
live mind map. Curious what this sub thinks of branching vs linear as a paradigm —
and where it would annoy you. Link in comments to avoid the auto-filter.
```

**r/PKM, r/ObsidianMD, r/Zettelkasten** — angle: durable knowledge
```
Title: Turning AI research sessions into a knowledge map you actually keep

Body: The PKM problem with AI chat is that the session is disposable — you never
reopen a transcript. I've been building a tool where each AI answer is a node on a
branching map you can export to Notion/Markdown, so the research becomes part of
your second brain instead of vanishing. Would love feedback from people who
actually maintain a system.
```

**r/Notion** — angle: the Notion export specifically.
**r/ChatGPT / r/ClaudeAI** — angle: "I got tired of losing the thread in long chats."
**r/InternetIsBeautiful** — angle: pure "look at this" demo (this sub is link-first, low-pitch).

**Rule of thumb:** put the link in a comment, not the post body, on subs with aggressive spam filters.

---

## 4. Indie Hackers / communities

**IH post title:** `I built a branching research workspace because linear AI chat kept losing my thread`
Body: the build story + the baseline numbers (transparency does well on IH) + ask for feedback. Cross-post the same to **Lobsters** (if on-topic), **dev.to**, and relevant **Discord/Slack** communities (PKM, AI tools).

---

## 5. Directory submissions (do-follow-ish links + their own traffic)

Submit to each — I can pre-fill every field; you paste + solve the captcha. Use the standard blurb below.

| Directory | URL | Notes |
|---|---|---|
| There's An AI For That | theresanaiforthat.com/submit | Highest-traffic AI directory; prioritize |
| Futurepedia | futurepedia.io/submit-tool | Large AI tool index |
| Toolify | toolify.ai/submit | AI tool index, decent traffic |
| AlternativeTo | alternativeto.net | List fork ai as an alternative to ChatGPT / Perplexity / NotebookLM / mindmap.io |
| SaaSHub | saashub.com/submit | SaaS directory, do-follow |
| AppSumo / Uneed / TinyLaunch | — | Indie launch directories |
| AI Tool Hunt / Insidr / aitools.fyi | — | Long-tail AI directories |
| BetaList | betalist.com | If you position as still-early |

**Standard 60-word blurb:**
```
fork ai is a branching AI research workspace. Ask a question, get a structured
answer split into sections, then branch any section into a child node — or
highlight a passage and ask a follow-up. Every branch becomes a node on a live
mind map you can revisit, export to Notion or PDF, and keep. Pick your model:
Claude, Gemini, DeepSeek, or GLM.
```
**Short tagline:** `Branch any AI answer into a mind map you can keep.`
**Categories/tags:** AI, Research, Productivity, Mind Mapping, Knowledge Management, Note-taking, Study, LLM.

---

## 6. Get into the "best AI mind map tools" roundups (highest-value links)

These listicles already rank for the head terms you can't win directly — getting *listed* in them borrows their authority and sends qualified traffic. Email each author a short, specific pitch (not a press release):

- thedigitalprojectmanager.com — "15 Best AI Mind Mapping Tools"
- storyflow.so/blog — "Best AI Mind Map Generators 2026"
- allaboutai.com — "Best AI Mind Mapping Tools"
- guideflow.com/blog — "20 best mind mapping software tools"
- affine.pro/blog, airmore.ai, chatterlane.com — similar roundups

**Pitch template:**
```
Subject: A branching one for your AI mind-map roundup

Hi [name] — really useful list. One you might not have seen: fork.ai
(forkai.in). It's different from the generators — instead of turning a prompt
into a static diagram, every AI answer becomes a branchable node on a live map,
so the map grows as you research and exports to Notion. Happy to give you a free
account if you want to try it for the next update. Either way, thanks for the list.
```

---

## 7. Ongoing backlink habits (15 min/day)

- Answer real questions on Reddit/Quora where fork ai is genuinely relevant; link only when it adds value.
- Sign up for **Connectively (HARO)** and answer 1–2 journalist queries/week in the AI/productivity space.
- Build 2–3 more `/vs` and `/alternative` pages (mindmap.io, Claude, Gemini, Notion AI) — I can generate these.
- Watch GSC monthly: any query where you rank #8–20 with impressions is a page to strengthen.

---

## Measuring success (vs. the June 2026 baseline)

| Metric | Baseline | 30-day target | 90-day target |
|---|---|---|---|
| Pages indexed (GSC) | ~1 (homepage) | all 20+ | all + new pages |
| Organic search clicks | ~8 / 90d | 50 / mo | 300 / mo |
| Referring domains | ~0 | 10+ | 30+ |
| Blog pageviews | ~0 | 200 / mo | 1,000 / mo |

Track in GSC (Performance report) and PostHog (`$pageview` by `$pathname` and `$referring_domain`). I can pull a monthly diff against this baseline any time.
