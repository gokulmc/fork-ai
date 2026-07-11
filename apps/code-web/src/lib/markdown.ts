import { Marked } from 'marked';

// Renders user-submitted markdown. Raw HTML is stripped (the `html` renderer
// returns ''), so inline <script>/<iframe>/etc. in a submission can't execute —
// defence-in-depth on top of the admin-approval gate. Non-http link protocols
// (javascript:/data:/vbscript:) are neutralised too. Markdown-generated
// formatting (bold, lists, links, code) is unaffected.
const md = new Marked({ gfm: true, renderer: { html: () => '' } });

export function renderUserMarkdown(body: string): string {
  const html = md.parse(body, { async: false }) as string;
  return html.replace(/(href|src)\s*=\s*(["'])\s*(?:javascript|data|vbscript):/gi, '$1=$2#');
}
