import TurndownService from 'turndown';

// Converts the HTML of a selected DOM range back to markdown. The highlight
// menu's `start`/`end` offsets index the *rendered* text, not the markdown
// source, so we can't slice `section.body` — we round-trip the rendered HTML.
let service: TurndownService | null = null;

function htmlToMarkdown(html: string): string {
  if (!html.trim()) return '';
  service ??= new TurndownService({
    headingStyle: 'atx',
    bulletListMarker: '-',
    codeBlockStyle: 'fenced',
  });
  return service.turndown(html).trim();
}

export function rangeToMarkdown(range: Range): string {
  const div = document.createElement('div');
  div.appendChild(range.cloneContents());
  return htmlToMarkdown(div.innerHTML);
}
