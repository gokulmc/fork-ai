# @fork-ai/mobile — Capacitor native shell

iOS + Android wrapper for fork.ai. It is a **thin webview** that loads the live
site (`server.url = https://forkai.in` in `capacitor.config.ts`), so **any web
deploy updates the app automatically** — no app-store resubmit for content or
feature changes. See [`docs/adr/0008-mobile-via-remote-capacitor-webview.md`](../../docs/adr/0008-mobile-via-remote-capacitor-webview.md).

The mobile-specific UI (hidden mind map behind a floating pill, icon-only nav)
lives in `apps/web` behind a `@media (max-width: 768px)` block + the
`useIsNarrow` hook — it is **not** in this package. So most of the mobile UX is
testable in a desktop browser's responsive mode or a phone browser, with no
native toolchain.

## First-time setup (generates the native projects)

```bash
# from repo root — installs workspace deps
npm install

cd apps/mobile
npx cap add ios        # requires Xcode + CocoaPods
npx cap add android    # requires Android Studio + JDK
npx cap sync
```

## Run

```bash
cd apps/mobile
npm run run:ios        # or: npm run open:ios   → run from Xcode
npm run run:android    # or: npm run open:android → run from Android Studio
```

`ios/` and `android/` are generated native projects. Re-run `npx cap sync` after
changing `capacitor.config.ts` or adding Capacitor plugins.
