import type { CapacitorConfig } from '@capacitor/cli';

// The native app is a thin shell: it loads the live SSR site directly, so every
// web deploy to forkai.in updates the app with no app-store resubmit. `webDir`
// is required by the CLI even though `server.url` makes it a placeholder
// (www/index.html only shows if the remote URL is ever removed). See
// docs/adr/0008-mobile-via-remote-capacitor-webview.md.
const config: CapacitorConfig = {
  appId: 'in.forkai.app',
  appName: 'fork ai',
  webDir: 'www',
  server: {
    url: 'https://forkai.in',
    cleartext: false,
  },
};

export default config;
