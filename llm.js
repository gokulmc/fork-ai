// LLM bridge — calls window.claude.complete with strict JSON outputs.
// All functions return { ok, data, error }.

const SECTIONS_SCHEMA = `Return ONLY valid JSON, no prose, no markdown fences. Shape:
{
  "title": "<=5 words capturing topic",
  "emoji": "single emoji that best represents this topic (e.g. 🧠 for neuroscience, 🏛️ for history, 🌌 for cosmology, 🧬 for biology, 💻 for code). Pick something specific and visually clear.",
  "lede": "one sentence framing the answer (max 25 words)",
  "sections": [
    { "heading": "Section heading", "body": "1-2 paragraph plain-text discussion (no markdown)" }
  ]
}`;

async function callJSON(prompt, retries = 1) {
  if (!window.claude?.complete) {
    return { ok: false, error: "Claude not available in this environment." };
  }
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    try {
      const raw = await window.claude.complete(prompt);
      const cleaned = stripFence(raw);
      const data = JSON.parse(cleaned);
      return { ok: true, data };
    } catch (e) {
      lastErr = e;
    }
  }
  return { ok: false, error: lastErr?.message || "Failed to parse LLM output." };
}

function stripFence(s) {
  if (!s) return s;
  let t = s.trim();
  // remove ```json ... ``` fences
  t = t.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "");
  // grab the first { ... last }
  const a = t.indexOf("{");
  const b = t.lastIndexOf("}");
  if (a >= 0 && b > a) t = t.slice(a, b + 1);
  return t;
}

window.LLM = {
  async answerQuery(query, sectionCount = 5) {
    const prompt = `You are a research assistant. Answer this query as a structured study note with ${sectionCount} sections.

Query: "${query}"

${SECTIONS_SCHEMA}

Each section "body" should be 80-180 words. You MAY use GitHub-flavored markdown when it strengthens the explanation: paragraphs, **bold**, *italic*, \`inline code\`, fenced code blocks (\`\`\`python ... \`\`\`), tables, ordered/unordered lists, and > blockquotes. Use prose by default — only reach for code, tables, or lists when they genuinely make the content clearer. Escape any double-quotes inside JSON strings.`;
    return callJSON(prompt);
  },

  async expandSection(rootQuery, sectionHeading, sectionBody) {
    const prompt = `Continue research. The parent topic was: "${rootQuery}".
We want to go DEEPER on the section titled "${sectionHeading}".

Produce a focused deep-dive with 3-4 sections, each 80-180 words.

${SECTIONS_SCHEMA}

You MAY use GitHub-flavored markdown (code blocks, tables, lists, inline code, bold, italic, blockquotes) when it helps. The "title" should be a 5-word-max phrase capturing the deep dive (e.g. "Backpropagation in Practice"). Escape double-quotes inside JSON strings.`;
    return callJSON(prompt);
  },

  async followUpFromHighlight(rootQuery, highlight, question) {
    const prompt = `Continue research. The parent topic was: "${rootQuery}".
The user highlighted this passage: "${highlight.slice(0, 800)}"
They asked: "${question}"

Answer with 3-4 sections, each 80-180 words.

${SECTIONS_SCHEMA}

You MAY use GitHub-flavored markdown (code blocks, tables, lists, inline code, bold, italic, blockquotes) when it helps clarify. The "title" should be a 5-word-max phrase capturing the answer topic. Escape double-quotes inside JSON strings.`;
    return callJSON(prompt);
  },
};
