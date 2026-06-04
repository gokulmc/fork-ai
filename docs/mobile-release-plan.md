# Mobile release plan — shipping the Android app

Companion to [ADR-0008](adr/0008-mobile-via-remote-capacitor-webview.md). The app is a
thin Capacitor shell (`apps/mobile`, appId `in.forkai.app`) whose `server.url` points at
`https://forkai.in`. The shell, native projects, mobile UI, icons, splash, and PWA are
**already built**. This doc covers only what remains to ship.

## Scope (current)

- **Android only** via Google Play. (Google Play account: $25 one-time, already the plan.)
- **iPhone → PWA for now.** No iOS native app, no Apple Developer account, no Guideline
  4.2 risk, no Xcode toolchain. iOS users "Add to Home Screen" via Safari (the
  `InstallPrompt` already guides them).
- **Email/password login only in the native app.** Google sign-in is *not* offered inside
  the Capacitor webview — this sidesteps the embedded-webview OAuth block entirely, so
  there is no de-risk phase needed.

---

## Phase 0 — Email-only login in the native app

- [x] **Google sign-in button: already gone.** `LoginPage.tsx` is email/password-only —
      the only `signIn()` calls use the `cognito-token` credentials provider. The Google
      Cognito provider still exists in `auth.ts` but no UI triggers it, so nothing renders
      in the webview. No change needed.
- [ ] Verify email/password login + signup + verify + forgot-password all work inside the
      webview (they use our own Next.js API routes, no third-party redirect — should be
      unchanged).
- [ ] Confirm the next-auth session cookie persists across app restarts in the webview.
- [ ] (Optional cleanup) `LoginPage.tsx:346` shows "use the Google button below" on a
      federated-account reset error, but there is no Google button — dead copy to remove.

## Phase 1 — Android native shell

- [ ] Set `versionCode` / `versionName` scheme in `apps/mobile/android/app/build.gradle`.
- [ ] Confirm `targetSdkVersion` meets the current Play requirement (Play enforces a
      rolling minimum — check the console when uploading).
- [ ] Verify app icons + adaptive icon + splash render on hdpi→xxxhdpi (already added —
      eyeball on device).
- [ ] `cd apps/mobile && npm run sync` after any native change.
- [ ] Generate a **release keystore** and store it safely (lose it = can't update the app).
      Enroll in **Play App Signing**.

## Phase 2 — Play Console listing

- [x] **Privacy policy URL** (mandatory — we collect email/auth). Page created at
      `forkai.in/privacy-policy` (`apps/web/src/app/privacy-policy/page.tsx`). Goes live on
      the next web deploy. Review the copy before submitting.
- [ ] Data-safety form (what's collected: email, usage; how it's used/shared).
- [ ] Screenshots: phone (required) + 7"/10" tablet if we declare tablet support.
- [ ] App title, short + full description, category, contact email, support URL.
- [ ] Content rating questionnaire.

## Phase 3 — Build & ship Android

- [ ] Build a signed **AAB** (Android App Bundle, not APK) via Android Studio.
- [ ] Upload to **Internal testing** track → smoke test on real devices.
- [ ] Promote to **Production** (or Closed/Open testing first).

---

## Deferred — iOS native app

Not in scope. iPhone users stay on the PWA. If/when we revisit:
Apple Developer Program ($99/yr), Guideline 4.2 "web wrapper" rejection risk (would need a
native feature like push/share/haptics), plus the Google-OAuth-in-webview problem would
return if we ever enable Google login natively.

## What ships how (consequence of ADR-0008)

- **Web/UI changes** → deploy `forkai.in`, live instantly in installed apps. No resubmit.
- **Native-shell changes** (icon, splash, plugins, permissions) → require a new store
  binary + review.
