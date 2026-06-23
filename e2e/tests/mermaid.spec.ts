import { test, expect } from '@playwright/test';
import { baseApi, gotoWorkspace } from '../fixtures/app';
import { fullSession, rootNode } from '../fixtures/data';

/**
 * Mermaid fenced code blocks render as a graph (SVG) by default, with a
 * "View code" toggle to reveal the raw source — and normal code blocks are
 * left untouched (still hljs-highlighted, never turned into a diagram).
 */

const MERMAID_BODY = [
  '```mermaid',
  'graph TD',
  '  A[Start] --> B{Decision}',
  '  B -->|Yes| C[Do thing]',
  '  B -->|No| D[Stop]',
  '```',
].join('\n');

const CODE_BODY = ['```js', 'const x = 41;', 'console.log(x + 1);', '```'].join('\n');

function mermaidSession() {
  return fullSession({
    nodes: [
      rootNode({
        sections: [
          { id: 's1', heading: 'Flow diagram', body: MERMAID_BODY },
          { id: 's2', heading: 'Code sample', body: CODE_BODY },
        ],
      }),
    ],
  });
}

test('mermaid renders as a graph by default, with a View code toggle', async ({ page }) => {
  // First-time dynamic import of the ~2MB mermaid chunk can compile slowly in dev.
  test.setTimeout(120_000);

  const api = baseApi();
  await gotoWorkspace(page, api, { session: mermaidSession() });

  const s1 = page.locator('.section-body[data-section-id="s1"]');
  await s1.waitFor({ state: 'visible' });

  // Graph view is the default: the rendered SVG is shown, the raw <pre> hidden.
  const svg = s1.locator('.mermaid-block .mermaid-graph svg');
  await expect(svg).toBeVisible({ timeout: 60_000 });
  const code = s1.locator('.mermaid-block pre');
  await expect(code).toBeHidden();

  // The diagram actually contains the node labels from the source.
  await expect(svg).toContainText('Decision');

  // Toggle → code view.
  const toggle = s1.locator('.mermaid-toggle');
  await expect(toggle).toHaveText('View code');
  await toggle.click();
  await expect(code).toBeVisible();
  await expect(svg).toBeHidden();
  await expect(toggle).toHaveText('View diagram');
  await expect(code).toContainText('graph TD');

  // Toggle back → diagram view.
  await toggle.click();
  await expect(svg).toBeVisible();
  await expect(code).toBeHidden();
  await expect(toggle).toHaveText('View code');
});

// LLMs frequently emit mindmaps with unquoted parens/punctuation in node text
// (`(Early Stage)`, `...(even in concept)?`), which is a mermaid parse error.
// renderMermaidSvg rescues these with a sanitise-and-retry so they still render
// as a graph instead of dropping to the raw code view.
test('mindmap with unquoted parens/punctuation still renders as a graph', async ({ page }) => {
  test.setTimeout(120_000);

  const body = [
    '```mermaid',
    'mindmap',
    '  root((Pre-Launch Outreach))',
    '    Strategy',
    '      Define Value Proposition (Early Stage)',
    '        How is it different (even in concept)?',
    '      Networking Events (Online/Offline)',
    '        Ask for advice/feedback (not a favor)',
    '```',
  ].join('\n');

  const api = baseApi();
  await gotoWorkspace(page, api, {
    session: fullSession({ nodes: [rootNode({ sections: [{ id: 's1', heading: 'Mindmap', body }] })] }),
  });

  const s1 = page.locator('.section-body[data-section-id="s1"]');
  await s1.waitFor({ state: 'visible' });
  await expect(s1.locator('.mermaid-block .mermaid-graph svg')).toBeVisible({ timeout: 60_000 });
  // node labels survive the sanitiser
  await expect(s1.locator('.mermaid-graph svg')).toContainText('even in concept');
});

// LLMs emit flowcharts with unquoted parens in node labels (e.g.
// `J{Issue Persists (2nd Time)?}`), a mermaid parse error since `(` opens a
// shape. sanitizeFlowchart quotes the node-label interiors on a failure-gated
// retry so the graph renders instead of dropping to the code view.
test('flowchart with unquoted parens in node labels still renders as a graph', async ({ page }) => {
  test.setTimeout(120_000);

  const body = [
    '```mermaid',
    'graph TD',
    '    A[User Input] --> B(LLM - Sonnet Default)',
    '    B --> G{Issue/Bug Detected?}',
    '    G -- Yes (1st Time) --> H[LLM - Sonnet Retry]',
    '    H --> J{Issue Persists (2nd Time)?}',
    '    J --> P[Knowledge Base Update (Wiki, Graphify, Mem Palace)]',
    '```',
  ].join('\n');

  const api = baseApi();
  await gotoWorkspace(page, api, {
    session: fullSession({ nodes: [rootNode({ sections: [{ id: 's1', heading: 'Flow', body }] })] }),
  });

  const s1 = page.locator('.section-body[data-section-id="s1"]');
  await s1.waitFor({ state: 'visible' });
  await expect(s1.locator('.mermaid-block .mermaid-graph svg')).toBeVisible({ timeout: 60_000 });
  await expect(s1.locator('.mermaid-graph svg')).toContainText('2nd Time');
});

// Parens in a subgraph title (`subgraph Knowledge Base (Human & LLM)`) are the
// same class of parse error; sanitizeFlowchart quotes the title on the retry.
test('flowchart with parens in a subgraph title still renders as a graph', async ({ page }) => {
  test.setTimeout(120_000);

  const body = [
    '```mermaid',
    'graph TD',
    '    subgraph Knowledge Base Management (Human & LLM)',
    '        B --> C{Context Layer 1: Wiki (Major Context)}',
    '        C --> D[Combined Context for LLM]',
    '    end',
    '```',
  ].join('\n');

  const api = baseApi();
  await gotoWorkspace(page, api, {
    session: fullSession({ nodes: [rootNode({ sections: [{ id: 's1', heading: 'Flow', body }] })] }),
  });

  const s1 = page.locator('.section-body[data-section-id="s1"]');
  await s1.waitFor({ state: 'visible' });
  await expect(s1.locator('.mermaid-block .mermaid-graph svg')).toBeVisible({ timeout: 60_000 });
  await expect(s1.locator('.mermaid-graph svg')).toContainText('Human & LLM');
});

// LLMs sometimes leave an edge dangling/truncated — `MR --> |Label|` with no
// target node, or `MR --> |...` — which is an unrecoverable parse error.
// sanitizeFlowchart drops those lines on the retry so the rest still renders.
test('flowchart with dangling/truncated edges still renders (broken edges dropped)', async ({ page }) => {
  test.setTimeout(120_000);

  const body = [
    '```mermaid',
    'graph TD',
    '    A[Monorepo Root] --> B[Web App]',
    '    A --> |Nested Context Files|',
    '    B --> C[Backend (Service)]',
    '    A --> |...',
    '```',
  ].join('\n');

  const api = baseApi();
  await gotoWorkspace(page, api, {
    session: fullSession({ nodes: [rootNode({ sections: [{ id: 's1', heading: 'Flow', body }] })] }),
  });

  const s1 = page.locator('.section-body[data-section-id="s1"]');
  await s1.waitFor({ state: 'visible' });
  await expect(s1.locator('.mermaid-block .mermaid-graph svg')).toBeVisible({ timeout: 60_000 });
  // the valid nodes survive; the broken edge label is gone
  await expect(s1.locator('.mermaid-graph svg')).toContainText('Backend');
});

test('non-mermaid code blocks are still rendered as highlighted code', async ({ page }) => {
  const api = baseApi();
  await gotoWorkspace(page, api, { session: mermaidSession() });

  const s2 = page.locator('.section-body[data-section-id="s2"]');
  await s2.waitFor({ state: 'visible' });

  // The JS block is highlighted by hljs and NOT wrapped as a diagram.
  await expect(s2.locator('pre code.hljs')).toBeVisible();
  await expect(s2.locator('.mermaid-block')).toHaveCount(0);
});
