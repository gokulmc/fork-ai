import type { CapacitorConfig } from '@capacitor/cli';

// The native app is a thin shell: it loads the live SSR site directly, so every
// web deploy to code.forkai.in updates the app with no app-store resubmit. `webDir`
// is required by the CLI even though `server.url` makes it a placeholder
// (www/index.html only shows if the remote URL is ever removed). Mirrors
// apps/mobile — see docs/adr/0008-mobile-via-remote-capacitor-webview.md.
const config: CapacitorConfig = {
  appId: 'in.forkai.code',
  appName: 'forkai code',
  webDir: 'www',
  server: {
    url: 'https://code.forkai.in',
    cleartext: false,
    errorPath: 'offline.html',
  },
  ios: {
    backgroundColor: '#ffffff',
    limitsNavigationsToAppBoundDomains: true,
  },
};

export default config;
