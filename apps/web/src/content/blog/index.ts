import type { ComponentType } from 'react';

export interface PostMeta {
  slug: string;
  emoji: string;
  title: string;
  description: string;
  keywords: string[];
  date: string; // ISO published date
  updated?: string; // ISO modified date
  readingMinutes: number;
  // Optional Q&A pairs — when present, the post page emits FAQPage structured
  // data so the questions are eligible for "People also ask" rich results.
  faq?: { q: string; a: string }[];
}

export interface BlogPost {
  meta: PostMeta;
  load: () => Promise<{ default: ComponentType }>;
}

// Single source of truth: metadata in TS (typed, drives the index / sitemap /
// per-post <head>), article bodies in the paired .mdx files. Each post pairs a
// slug with a lazy importer so routes pull only the body they render.
export const POSTS: Record<string, BlogPost> = {
  'ai-research-workflow': {
    meta: {
      slug: 'ai-research-workflow',
      emoji: '🗺️',
      title: 'From Prompt to Knowledge Map: A Workflow for Deep Research with AI',
      description:
        'A practical workflow for deep research with AI — turn a single prompt into a structured, branching knowledge map instead of a wall of chat.',
      keywords: ['ai research', 'research ai', 'deep research', 'ai research workflow'],
      date: '2026-05-12',
      readingMinutes: 8,
    },
    load: () => import('./ai-research-workflow.mdx'),
  },
  'llm-research': {
    meta: {
      slug: 'llm-research',
      emoji: '🔬',
      title: 'LLM Research Done Right: Turning One Question Into a Map of Answers',
      description:
        'How to do LLM research without losing the thread — branch a single question into many answers and keep the structure you build along the way.',
      keywords: ['llm research', 'research with llms', 'large language model research'],
      date: '2026-05-15',
      readingMinutes: 7,
    },
    load: () => import('./llm-research.mdx'),
  },
  'ai-research-assistant': {
    meta: {
      slug: 'ai-research-assistant',
      emoji: '🤖',
      title: "The AI Research Assistant That Doesn't Lose the Thread",
      description:
        'Most AI research assistants forget where you were. Here is what a research assistant that keeps the whole map of your inquiry looks like.',
      keywords: ['ai research assistant', 'research assistant ai', 'ai research tool'],
      date: '2026-05-28',
      readingMinutes: 7,
    },
    load: () => import('./ai-research-assistant.mdx'),
  },
  'ai-literature-review': {
    meta: {
      slug: 'ai-literature-review',
      emoji: '📚',
      title: 'How to Run a Literature Review With AI (Without Drowning)',
      description:
        'A step-by-step approach to running a literature review with AI: map the field first, branch into sub-topics, and keep every source in context.',
      keywords: ['ai literature review', 'literature review ai', 'literature review with ai'],
      date: '2026-06-04',
      readingMinutes: 8,
    },
    load: () => import('./ai-literature-review.mdx'),
  },
  'mind-map-research': {
    meta: {
      slug: 'mind-map-research',
      emoji: '🌳',
      title: 'Mind Map Research: Why Linear Notes Fail and Branching Wins',
      description:
        'Linear notes flatten research into a list. Mind map research keeps the shape of your thinking — here is why branching beats bullet points.',
      keywords: ['mind map research', 'research mind map', 'mind mapping research'],
      date: '2026-05-19',
      readingMinutes: 7,
    },
    load: () => import('./mind-map-research.mdx'),
  },
  'mind-map-llm': {
    meta: {
      slug: 'mind-map-llm',
      emoji: '🧩',
      title: 'Mind Maps Meet LLMs: Visual Thinking for AI-Assisted Learning',
      description:
        'What happens when you put a mind map and an LLM in the same workspace? Visual, AI-assisted learning where every answer becomes a node you can explore.',
      keywords: ['mind map llm', 'ai mind map', 'llm mind map'],
      date: '2026-05-22',
      readingMinutes: 6,
    },
    load: () => import('./mind-map-llm.mdx'),
  },
  'concept-map-ai': {
    meta: {
      slug: 'concept-map-ai',
      emoji: '🕸️',
      title: 'Concept Maps, Generated: Using AI to Connect Ideas',
      description:
        'A concept map shows how ideas relate. Using AI to generate and extend one lets you see the connections in a topic as fast as you can ask about them.',
      keywords: ['concept map ai', 'ai concept map', 'concept mapping ai'],
      date: '2026-06-03',
      readingMinutes: 6,
    },
    load: () => import('./concept-map-ai.mdx'),
  },
  'knowledge-map': {
    meta: {
      slug: 'knowledge-map',
      emoji: '🧭',
      title: 'Knowledge Maps vs Linear Notes: Organizing What You Learn',
      description:
        'A knowledge map organizes what you learn by structure, not by order. Here is how knowledge mapping beats linear notes for anything you want to keep.',
      keywords: ['knowledge map', 'knowledge mapping', 'knowledge map tool'],
      date: '2026-06-02',
      readingMinutes: 7,
    },
    load: () => import('./knowledge-map.mdx'),
  },
  'memory-map': {
    meta: {
      slug: 'memory-map',
      emoji: '📍',
      title: 'Build a Memory Map: Remember What You Research with Spatial Recall',
      description:
        'A memory map turns research into something you can remember by location. Here is how spatial recall and memory mapping help knowledge actually stick.',
      keywords: ['memory map', 'memory mapping', 'spatial recall'],
      date: '2026-05-26',
      readingMinutes: 6,
    },
    load: () => import('./memory-map.mdx'),
  },
  'ai-study-tool': {
    meta: {
      slug: 'ai-study-tool',
      emoji: '🎓',
      title: 'Studying With AI: Turn Any Subject Into a Branching Study Map',
      description:
        'An AI study tool should do more than answer questions. Learn how to study with AI by turning any subject into a branching, reviewable study map.',
      keywords: ['ai study tool', 'study with ai', 'ai for students'],
      date: '2026-06-01',
      readingMinutes: 7,
    },
    load: () => import('./ai-study-tool.mdx'),
  },
  'second-brain-ai': {
    meta: {
      slug: 'second-brain-ai',
      emoji: '🧠',
      title: 'Build an AI Second Brain From Your Research',
      description:
        'A second brain is only useful if you can find what is in it. Here is how to build an AI second brain that grows a structured map of what you know.',
      keywords: ['ai second brain', 'second brain ai', 'second brain'],
      date: '2026-06-05',
      readingMinutes: 7,
    },
    load: () => import('./second-brain-ai.mdx'),
  },
  'branching-ai-chat': {
    meta: {
      slug: 'branching-ai-chat',
      emoji: '🌿',
      title: 'Beyond Linear Chat: Why Branching AI Conversations Win',
      description:
        'A linear chat log throws away the structure of your thinking. Branching AI conversations keep every tangent as its own thread you can return to.',
      keywords: ['branching ai chat', 'non-linear ai chat', 'branching conversations'],
      date: '2026-06-06',
      readingMinutes: 6,
    },
    load: () => import('./branching-ai-chat.mdx'),
  },
  'context-is-all-that-matters': {
    meta: {
      slug: 'context-is-all-that-matters',
      emoji: '🎯',
      title: 'Context Is All That Matters',
      description:
        'Models are converging; context is the differentiator. Why context engineering beats prompt engineering, and why context should be a structure, not a transcript.',
      keywords: ['context engineering', 'llm context', 'prompt engineering', 'ai context'],
      date: '2026-06-08',
      readingMinutes: 6,
    },
    load: () => import('./context-is-all-that-matters.mdx'),
  },
  'how-much-context-is-too-much': {
    meta: {
      slug: 'how-much-context-is-too-much',
      emoji: '⚖️',
      title: 'How Much Context Is Too Much?',
      description:
        'Million-token windows do not mean million-token attention. Lost-in-the-middle, context rot, and why curating context beats maximizing it.',
      keywords: ['context window', 'context rot', 'long context llm', 'lost in the middle'],
      date: '2026-06-09',
      readingMinutes: 6,
    },
    load: () => import('./how-much-context-is-too-much.mdx'),
  },
  'gui-for-llms': {
    meta: {
      slug: 'gui-for-llms',
      emoji: '🖥️',
      title: 'What Does the GUI for LLMs Look Like?',
      description:
        'Chat is the command line of AI. What happens when visible state, direct manipulation, and spatial persistence — the principles of the GUI — meet large language models?',
      keywords: ['gui for llms', 'llm interface', 'ai user interface', 'beyond chat'],
      date: '2026-06-10',
      readingMinutes: 7,
    },
    load: () => import('./gui-for-llms.mdx'),
  },
  'xerox-of-the-gpt-world': {
    meta: {
      slug: 'xerox-of-the-gpt-world',
      emoji: '🖨️',
      title: 'Who Is the Xerox of the GPT World?',
      description:
        'Xerox PARC invented personal computing and let someone else ship it. Google, OpenAI, and why fork.ai is claiming the PARC role — inventing the AI interface paradigm — with a different ending.',
      keywords: ['xerox parc', 'openai vs google', 'ai interface paradigm', 'fork.ai'],
      date: '2026-06-11',
      readingMinutes: 7,
    },
    load: () => import('./xerox-of-the-gpt-world.mdx'),
  },
  'notion-ai-research': {
    meta: {
      slug: 'notion-ai-research',
      emoji: '📝',
      title: 'From Research Map to Notion: Exporting AI Research You Can Keep',
      description:
        'AI research is only useful if it outlives the session. Here is how to export a branching research map to Notion as a structured, durable page.',
      keywords: ['notion ai research', 'ai research to notion', 'export ai research'],
      date: '2026-06-07',
      readingMinutes: 6,
    },
    load: () => import('./notion-ai-research.mdx'),
  },

  // ── Comparison ("vs") pages — high-intent, low-competition search terms ──────
  'fork-ai-vs-mindmap-io': {
    meta: {
      slug: 'fork-ai-vs-mindmap-io',
      emoji: '🗺️',
      title: 'fork ai vs mindmap.io: AI Research Map vs Static Mind Map',
      description:
        'fork ai vs mindmap.io — an AI that generates and fills a branching map from your questions vs a blank canvas you arrange yourself. What each does best.',
      keywords: ['fork ai vs mindmap', 'mindmap alternative', 'ai mind map tool', 'mindmap io alternative'],
      date: '2026-06-16',
      readingMinutes: 5,
      faq: [
        {
          q: 'Is fork ai a mindmap.io alternative?',
          a: 'For AI-powered research and exploration, yes. For manual visual diagramming and team whiteboarding, mindmap.io is purpose-built for that and remains the better choice.',
        },
        {
          q: 'Does fork ai generate real mind maps?',
          a: "Every fork ai session builds a live branching map automatically from your questions and the AI's answers. Unlike a traditional mind map, every node contains generated content — not just a label you placed.",
        },
        {
          q: 'Can I control the layout in fork ai?',
          a: 'The layout is generated from the branching structure of your inquiry. For presentations requiring precise visual control, export your session to Notion and use a dedicated diagram tool for the final layout.',
        },
        {
          q: 'What AI does fork ai use?',
          a: 'Your choice of Claude, Gemini, DeepSeek, or GLM per branch, with Claude Sonnet for the root question.',
        },
      ],
    },
    load: () => import('./fork-ai-vs-mindmap-io.mdx'),
  },
  'fork-ai-vs-claude': {
    meta: {
      slug: 'fork-ai-vs-claude',
      emoji: '🤝',
      title: 'fork ai vs Claude: Why Use fork ai When Claude Exists?',
      description:
        'fork ai runs on Claude — so why use it instead of Claude.ai directly? The difference is structure: branching threads, a live mind map, and sessions that outlast the chat window.',
      keywords: ['fork ai vs claude', 'claude alternative', 'claude for research', 'claude ai research tool'],
      date: '2026-06-17',
      readingMinutes: 5,
      faq: [
        {
          q: 'Does fork ai use Claude?',
          a: 'Yes — the root question always runs on Claude Sonnet. Branch questions can run on Claude, Gemini, DeepSeek, or GLM depending on what you select.',
        },
        {
          q: 'Is fork ai better than Claude for research?',
          a: 'For multi-branch research sessions you want to keep as a structured map, yes. For general-purpose tasks — writing, code, document analysis — Claude.ai is the right tool.',
        },
        {
          q: 'Can I use fork ai and Claude together?',
          a: 'Yes — many people use fork ai for the exploration phase and Claude.ai for writing up the results. They complement each other well.',
        },
        {
          q: 'Is fork ai free?',
          a: 'Fork ai has a free tier. See the pricing page for credit details on heavier research sessions.',
        },
      ],
    },
    load: () => import('./fork-ai-vs-claude.mdx'),
  },
  'fork-ai-vs-gemini': {
    meta: {
      slug: 'fork-ai-vs-gemini',
      emoji: '🔷',
      title: 'fork ai vs Gemini: Interactive Map vs Deep Research Report',
      description:
        'fork ai vs Gemini Deep Research compared — an automated one-shot report vs a branching research map you steer in real time. When to use which.',
      keywords: ['fork ai vs gemini', 'gemini alternative', 'gemini deep research alternative', 'google gemini vs fork ai'],
      date: '2026-06-18',
      readingMinutes: 5,
      faq: [
        {
          q: 'Is fork ai a Gemini alternative?',
          a: 'For interactive, steerable research you want to keep as a structured map, yes. For automated, comprehensive deep research reports generated with minimal input, Gemini Deep Research is excellent and both tools are complementary.',
        },
        {
          q: 'Does fork ai use Gemini?',
          a: 'Yes — you can select Gemini Flash or Gemini Pro as the model for branch questions inside fork ai.',
        },
        {
          q: 'Can I get cited sources in fork ai?',
          a: 'When web search is enabled on a branch, answers include source footnotes. Web search can be toggled per branch in the tweaks panel.',
        },
        {
          q: "What is fork ai's equivalent of Gemini Deep Research?",
          a: 'The closest equivalent is a root query followed by multiple "Go deeper" branches — but the shape is a navigable map you steer rather than an automated report.',
        },
      ],
    },
    load: () => import('./fork-ai-vs-gemini.mdx'),
  },
  'fork-ai-vs-chatgpt': {
    meta: {
      slug: 'fork-ai-vs-chatgpt',
      emoji: '⚔️',
      title: 'fork ai vs ChatGPT: Which Is Better for Research?',
      description:
        'An honest comparison of fork ai and ChatGPT for research — linear chat vs a branching mind map you can keep. When to use which, and what each does best.',
      keywords: ['fork ai vs chatgpt', 'chatgpt alternative', 'chatgpt for research', 'branching chatgpt'],
      date: '2026-06-13',
      readingMinutes: 6,
      faq: [
        {
          q: 'Is fork ai a ChatGPT alternative?',
          a: "For research and learning, yes — it's built for branching exploration you keep. For general chat, coding, and drafting, ChatGPT remains excellent and the two complement each other.",
        },
        {
          q: 'Does fork ai use GPT?',
          a: 'fork ai runs branch answers on your choice of Claude, Gemini, DeepSeek, or GLM, with Claude Sonnet for the root question. You pick the model per branch.',
        },
        {
          q: 'Can I export my research out of fork ai?',
          a: 'Yes — any session exports to Notion as a structured page or to PDF, with the branching structure preserved.',
        },
        {
          q: "What does fork ai do that ChatGPT can't?",
          a: 'Branch any answer into its own context-isolated thread, see the whole inquiry as a live mind map, and keep that map as a durable, navigable artifact.',
        },
      ],
    },
    load: () => import('./fork-ai-vs-chatgpt.mdx'),
  },
  'fork-ai-vs-perplexity': {
    meta: {
      slug: 'fork-ai-vs-perplexity',
      emoji: '🔎',
      title: 'fork ai vs Perplexity: Answer Engine or Research Workspace?',
      description:
        'fork ai vs Perplexity compared — a fast cited answer engine vs a branching research workspace you can keep. Where each wins and when to use which.',
      keywords: ['fork ai vs perplexity', 'perplexity alternative', 'perplexity for research', 'ai answer engine alternative'],
      date: '2026-06-14',
      readingMinutes: 6,
      faq: [
        {
          q: 'Is fork ai a Perplexity alternative?',
          a: 'For open-ended research you want to keep and structure, yes. For quick web-sourced answers, Perplexity is excellent — many people use both.',
        },
        {
          q: 'Does fork ai cite its sources?',
          a: 'When web search is enabled on a branch, answers come back with sources/footnotes. Web search is optional per branch.',
        },
        {
          q: "What does fork ai do that Perplexity doesn't?",
          a: 'It branches each answer into its own thread, shows your whole inquiry as a live mind map, and keeps that map as a durable artifact you can export.',
        },
        {
          q: 'Can I switch models in fork ai?',
          a: 'Yes — pick Claude, Gemini, DeepSeek, or GLM per branch; the root question runs on Claude Sonnet.',
        },
      ],
    },
    load: () => import('./fork-ai-vs-perplexity.mdx'),
  },
  'fork-ai-vs-notebooklm': {
    meta: {
      slug: 'fork-ai-vs-notebooklm',
      emoji: '📓',
      title: 'fork ai vs NotebookLM: Document Q&A vs a Branching Map',
      description:
        'fork ai vs NotebookLM compared — grounded Q&A over your documents vs a branching research map you build from any question. What each does best.',
      keywords: ['fork ai vs notebooklm', 'notebooklm alternative', 'notebooklm for research', 'ai research workspace'],
      date: '2026-06-15',
      readingMinutes: 6,
      faq: [
        {
          q: 'Is fork ai a NotebookLM alternative?',
          a: 'For open-ended exploration you want to map and keep, yes. For grounded Q&A over documents you already have, NotebookLM is excellent — the two are complementary.',
        },
        {
          q: 'Does fork ai work with my own documents?',
          a: 'fork ai is built around exploring questions into a branching map rather than querying an uploaded corpus; for source-grounded document Q&A, NotebookLM is the better fit.',
        },
        {
          q: "What does fork ai do that NotebookLM doesn't?",
          a: 'It branches each answer into its own context-isolated thread and renders the whole inquiry as a live, keepable mind map you can export.',
        },
        {
          q: 'Which models does fork ai use?',
          a: 'Your choice of Claude, Gemini, DeepSeek, or GLM per branch, with Claude Sonnet for the root question.',
        },
      ],
    },
    load: () => import('./fork-ai-vs-notebooklm.mdx'),
  },
};

// Newest first — drives the blog index ordering.
export const POST_LIST: PostMeta[] = Object.values(POSTS)
  .map((p) => p.meta)
  .sort((a, b) => (a.date < b.date ? 1 : -1));
