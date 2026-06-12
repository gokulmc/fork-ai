# Mobile apps via a remote Capacitor webview, not a bundled build

The iOS/Android apps (`apps/mobile`) are a thin Capacitor shell whose `server.url`
points at the live SSR site (`https://forkai.in`) rather than bundling a static
export of the frontend. We chose this because (a) the web app is pure Next.js SSR
(next-auth API routes, build-time-baked Cognito secrets) — `output: 'export'`
would be a large, fragile refactor that fights the existing Amplify setup — and
(b) the hard requirement is that the app **auto-updates whenever the web app is
deployed**, with no app-store resubmit. Loading the live URL satisfies both with
zero backend/auth changes: the webview origin is `https://forkai.in`, which the
API's CORS already allows, so auth, cookies, and fetch behave exactly as in a
normal browser.

**Consequences.** The app requires a network connection at launch (no offline
mode), and any content/UI change ships instantly to all installed apps — the
store binary only needs resubmission for native-shell changes (icon, splash,
plugins, permissions). The mobile-specific UI (mind map hidden behind a floating
pill, icon-only nav) therefore lives in `apps/web` behind a
`@media (max-width: 768px)` block + a `useIsNarrow` hook, scoped so desktop
browsers at `forkai.in` are unaffected.

**Amendment (2026-06):** the service worker now caches the app shell
(immutable `/_next/static/*` cache-first; HTML network-first with cache
fallback), so where SWs run the shell can launch on bad/no network. The
freshness contract is preserved — online launches always fetch fresh HTML, so
deploys still ship instantly; API/data calls are never cached. See
`apps/web/CLAUDE.md → Performance`.
