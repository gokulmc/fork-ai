/**
 * Tests for four features introduced on the `tweaks` branch:
 *   1. Delete session from History
 *   2. PDF export pill in workspace ws-meta row
 *   3. "Branched from" / "Expanded from" callout navigates to parent node
 *   4. TweaksPanel collapsible Appearance accordion
 */
import { test, expect } from '@playwright/test';
import { mockAuth } from '../fixtures/auth';
import { primeStorage, baseApi, gotoWorkspace } from '../fixtures/app';
import {
  fullSession,
  sessionSummary,
  rootNode,
  SID,
  ROOT_ID,
  ROOT_TITLE,
  CHILD_ID,
  ASK_ID,
  deeperNode,
  askNode,
} from '../fixtures/data';

// ── 1. Delete session ────────────────────────────────────────────────────────

test.describe('Delete session', () => {
  test('delete button is invisible by default and visible on card hover', async ({ page }) => {
    const api = baseApi().on('GET /sessions', [sessionSummary()]);
    await mockAuth(page);
    await primeStorage(page);
    await api.install(page);

    await page.goto('/');
    await page.locator('.landing-nav button', { hasText: 'History' }).click();
    await expect(page.locator('.session-card-title', { hasText: ROOT_TITLE })).toBeVisible();

    const deleteBtn = page.locator('.session-card-delete').first();
    // button is present in DOM but invisible (opacity:0) before hover
    await expect(deleteBtn).toBeAttached();
    await expect(deleteBtn).not.toBeVisible();

    await page.locator('.session-card').first().hover();
    await expect(deleteBtn).toBeVisible();
  });

  test('clicking delete removes the card from the list', async ({ page }) => {
    const api = baseApi()
      .on('GET /sessions', [sessionSummary()])
      .on(`DELETE /sessions/${SID}`, 204);
    await mockAuth(page);
    await primeStorage(page);
    await api.install(page);

    await page.goto('/');
    await page.locator('.landing-nav button', { hasText: 'History' }).click();
    await expect(page.locator('.session-card', { hasText: ROOT_TITLE })).toBeVisible();

    await page.locator('.session-card').first().hover();
    await page.locator('.session-card-delete').first().click();

    await expect(page.locator('.session-card', { hasText: ROOT_TITLE })).not.toBeAttached();
    expect(api.callsTo(`DELETE /sessions/${SID}`)).toHaveLength(1);
  });

  test('deleting a session via the History page removes it from the list', async ({ page }) => {
    const other = sessionSummary({
      sessionId: 'ses-other', title: 'Roman Republic Collapse', emoji: '🏛️',
      lede: 'Why the Republic fell.', updatedAt: '2026-05-20T09:00:00.000Z', createdAt: '2026-05-20T09:00:00.000Z',
    });
    const api = baseApi()
      .on('GET /sessions', [sessionSummary(), other])
      .on(`DELETE /sessions/${SID}`, 204)
      .on(`DELETE /sessions/ses-other`, 204);
    await mockAuth(page);
    await primeStorage(page);
    await api.install(page);

    await page.goto('/');
    await page.locator('.landing-nav button', { hasText: 'History' }).click();
    await expect(page.locator('.session-card', { hasText: ROOT_TITLE })).toBeVisible();
    await expect(page.locator('.session-card', { hasText: 'Roman Republic Collapse' })).toBeVisible();

    // Delete the first session
    await page.locator('.session-card', { hasText: ROOT_TITLE }).hover();
    await page.locator('.session-card', { hasText: ROOT_TITLE }).locator('.session-card-delete').click();

    // That card disappears; the other remains
    await expect(page.locator('.session-card', { hasText: ROOT_TITLE })).not.toBeAttached();
    await expect(page.locator('.session-card', { hasText: 'Roman Republic Collapse' })).toBeVisible();
  });
});

// ── 2. PDF export pill ───────────────────────────────────────────────────────

test.describe('PDF export pill', () => {
  test('PDF pill appears on ws-title hover and has PDF text', async ({ page }) => {
    await gotoWorkspace(page, baseApi());
    // PDF pill is hidden until the user hovers the title area (same as Ask AI pill)
    const pill = page.locator('.ws-meta .pill-pdf');
    await expect(pill).not.toBeAttached();

    await page.locator('.ws-title').hover();
    await expect(pill).toBeVisible();
    await expect(pill).toHaveText(/PDF/);
  });

  test('PDF pill is enabled after hover and re-enables after export click', async ({ page }) => {
    await gotoWorkspace(page, baseApi());
    await page.locator('.ws-title').hover();
    const pill = page.locator('.ws-meta .pill-pdf');
    await expect(pill).toBeEnabled();

    // html2canvas captures the DOM and jsPDF triggers a download.
    // In headless Chromium the download is intercepted. We just verify
    // the pill goes enabled again once the async export settles.
    await pill.click();
    await expect(pill).toBeEnabled({ timeout: 15_000 });
  });
});

// ── 3. Branched-from / Expanded-from navigation ──────────────────────────────

test.describe('Branched-from navigation', () => {
  test('Expanded from callout is shown on a DEEPER node and navigates to parent on click', async ({ page }) => {
    // Pass session via opts.session so gotoWorkspace doesn't override with its default fullSession()
    const session = fullSession({ nodes: [rootNode(), deeperNode()] });
    const api = baseApi();
    await gotoWorkspace(page, api, { session, nodeId: CHILD_ID });

    // fork.ai.node is CHILD_ID so the restored active node is the DEEPER child
    await expect(page.locator('.ws-title')).toHaveText('Thylakoid Electron Transport');

    // Callout should say "Expanded from" for DEEPER
    const callout = page.locator('.inline-callout--nav');
    await expect(callout).toBeVisible();
    await expect(callout.locator('.kicker')).toHaveText('Expanded from');

    // Click the callout — should navigate to root
    await callout.click();
    await expect(page.locator('.ws-title')).toHaveText(ROOT_TITLE);
  });

  test('Branched from callout shows correct label for ASK node and navigates to parent', async ({ page }) => {
    const session = fullSession({ nodes: [rootNode(), askNode()] });
    const api = baseApi();
    await gotoWorkspace(page, api, { session, nodeId: ASK_ID });

    await expect(page.locator('.ws-title')).toHaveText('Pigments Beyond Chlorophyll');

    const callout = page.locator('.inline-callout--nav');
    await expect(callout.locator('.kicker')).toHaveText('Branched from');

    await callout.click();
    await expect(page.locator('.ws-title')).toHaveText(ROOT_TITLE);
  });
});

// ── 4. Tweaks panel Appearance accordion ────────────────────────────────────

test.describe('TweaksPanel Appearance accordion', () => {
  test('Appearance accordion is closed by default and opens on click', async ({ page }) => {
    await gotoWorkspace(page, baseApi());
    await page.locator('.twk-trigger').click();

    const accordionHd = page.locator('.twk-accordion-hd', { hasText: 'Appearance' });
    await expect(accordionHd).toBeVisible();
    // Starts closed
    await expect(accordionHd).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByRole('radio', { name: 'Light' })).not.toBeVisible();

    // Click to open
    await accordionHd.click();
    await expect(accordionHd).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByRole('radio', { name: 'Light' })).toBeVisible();
    await expect(page.getByRole('radio', { name: 'Dark' })).toBeVisible();
    await expect(page.getByRole('radio', { name: 'Cozy' })).toBeVisible();
  });

  test('clicking the Appearance header again collapses its content', async ({ page }) => {
    await gotoWorkspace(page, baseApi());
    await page.locator('.twk-trigger').click();

    const accordionHd = page.locator('.twk-accordion-hd', { hasText: 'Appearance' });
    await accordionHd.click(); // open
    await accordionHd.click(); // collapse

    await expect(accordionHd).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByRole('radio', { name: 'Light' })).not.toBeVisible();
  });

  test('clicking the Appearance header a third time re-expands it', async ({ page }) => {
    await gotoWorkspace(page, baseApi());
    await page.locator('.twk-trigger').click();

    const accordionHd = page.locator('.twk-accordion-hd', { hasText: 'Appearance' });
    await accordionHd.click(); // open
    await accordionHd.click(); // collapse
    await accordionHd.click(); // re-expand

    await expect(accordionHd).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByRole('radio', { name: 'Light' })).toBeVisible();
  });

  test('Typography and Mind Map subsections are visible after opening the accordion', async ({ page }) => {
    await gotoWorkspace(page, baseApi());
    await page.locator('.twk-trigger').click();

    const accordionHd = page.locator('.twk-accordion-hd', { hasText: 'Appearance' });
    await accordionHd.click(); // open

    await expect(page.locator('.twk-subsect', { hasText: 'Typography' })).toBeVisible();
    await expect(page.locator('.twk-subsect', { hasText: 'Mind Map' })).toBeVisible();
    // Font pairing select (first twk-field) is inside the accordion body
    await expect(page.locator('select.twk-field').first()).toBeVisible();
  });

  test('Content section is still flat (not inside accordion)', async ({ page }) => {
    await gotoWorkspace(page, baseApi());
    await page.locator('.twk-trigger').click();

    // Content section header is a .twk-sect (flat), not an accordion
    await expect(page.locator('.twk-sect', { hasText: 'Content' })).toBeVisible();
  });
});
