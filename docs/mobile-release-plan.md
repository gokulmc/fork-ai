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

- [x] Set `versionCode` / `versionName` scheme in `apps/mobile/android/app/build.gradle`
      (v1 = versionCode 1 / 1.0.0 uploaded; bumped to versionCode 2 / 1.0.1 for the
      icon-fix build).
- [x] Confirm `targetSdkVersion` meets the current Play requirement (accepted by the
      console at upload).
- [x] App icons: the Capacitor default blue-X icons were still in `mipmap-*` at v1 —
      replaced all densities (`ic_launcher`, `ic_launcher_round`, `ic_launcher_foreground`,
      mdpi→xxxhdpi) with the fork.ai icon resized from `apps/web/public/icon-512.png`;
      adaptive background `#FFFFFF`. Ships in the versionCode 2 AAB.
- [x] Generate a **release keystore** (`~/forkai-keystore/forkai-upload.jks`) + enrolled in
      **Play App Signing**. Build steps in the `project-android-build` memory.

## Phase 2 — Play Console listing

- [x] **Privacy policy URL** — live at `forkai.in/privacy-policy`; the Play data-deletion
      link points at `forkai.in/privacy-policy#data-deletion`.
- [x] Data-safety form (email/password login only; Email address is the only collected
      data type declared).
- [x] Screenshots (phone) + feature graphic 1024×500 (`apps/mobile/store-assets/`).
- [x] App title, short + full description, category, contact email. NOTE: the store
      listing "App name" field is separate from the binary's `strings.xml` — set it to
      "fork ai" in the console (it initially showed as `in.forkai.app`).
- [x] Content rating questionnaire.

## Phase 3 — Build & ship Android

- [x] Build a signed **AAB** via Gradle CLI (see `project-android-build` memory).
- [x] Upload to **Internal testing** track (v1.0.0), tester added, smoke-tested on device.
      Findings fixed: status-bar overlap on Landing/History (CSS-only — shipped via web
      deploy, no AAB needed) and default Capacitor icons (needs the versionCode 2 AAB).
- [ ] Build + upload the **versionCode 2 / 1.0.1 AAB** (carries the icon fix).
- [ ] Complete the Play Console requirements that unlock the **Production** track
      (console currently offers Closed testing only — new personal accounts must run
      a closed test with ≥12 testers for 14 days before Production access).
- [ ] Promote to **Production**.

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
