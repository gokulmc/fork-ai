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
};

// Newest first — drives the blog index ordering.
export const POST_LIST: PostMeta[] = Object.values(POSTS)
  .map((p) => p.meta)
  .sort((a, b) => (a.date < b.date ? 1 : -1));
