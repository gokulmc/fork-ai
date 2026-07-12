import type { Metadata, Viewport } from 'next';
import Script from 'next/script';
import './globals.css';
import { Providers } from '@/components/Providers';
import { JsonLd } from '@/components/JsonLd';
import { CookieConsent } from '@/components/CookieConsent';

const DESCRIPTION = 'A plan-first coding agent workspace — learn the concepts, synthesize an implementation plan, then watch the agent commit one reviewable step at a time on a live git-graph map. Branch a new approach from any commit without losing the one that already works.';

export const metadata: Metadata = {
  metadataBase: new URL('https://code.forkai.in'),
  title: {
    default: 'forkai code — a plan-first AI coding agent workspace',
    template: '%s · forkai code',
  },
  description: DESCRIPTION,
  applicationName: 'forkai code',
  keywords: [
    'ai coding agent', 'plan-first coding', 'ai pair programmer', 'coding agent workspace',
    'git branching map', 'ai code review', 'agentic coding', 'github coding agent',
    'implementation plan ai', 'ai commit by commit', 'branch from any commit', 'ai developer tool',
  ],
  alternates: { canonical: '/' },
  robots: { index: true, follow: true },
  formatDetection: { telephone: false },
  openGraph: {
    type: 'website',
    siteName: 'forkai code',
    title: 'forkai code — a plan-first AI coding agent workspace',
    description: DESCRIPTION,
    url: 'https://code.forkai.in',
    locale: 'en_US',
    images: [{ url: '/api/og', width: 1200, height: 630, alt: 'forkai code — a plan-first AI coding agent workspace' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'forkai code — a plan-first AI coding agent workspace',
    description: DESCRIPTION,
    images: ['/api/og'],
  },
  // Standalone PWA on iOS (no Safari chrome once added to the Home Screen).
  appleWebApp: { capable: true, statusBarStyle: 'default', title: 'forkai code' },
};

// viewport-fit=cover lets the Capacitor/iOS safe-area insets (notch, home bar)
// reach the CSS env() values the mobile layout relies on.
// maximumScale:1 + userScalable:false disable the webview's native pinch- and
// focus-zoom on every page/popup (Landing, Login, Tweaks, History, Account, …).
// The mind map keeps its own JS-driven zoom (touch/wheel handlers, not native),
// so it is unaffected.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#191919' },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Transparent marks. The dark mark (for light tabs) is the non-media DEFAULT,
            incl. the .ico that Safari requests by default and uses regardless of theme
            (Safari ignores prefers-color-scheme on favicons). The white mark is a
            dark-scheme version for browsers that honor it (Chrome/Firefox). */}
        <link rel="icon" href="/favicon.ico?v=5" sizes="any" />
        <link rel="icon" type="image/png" sizes="48x48" href="/favicon-48.png?v=5" />
        <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png?v=5" />
        <link rel="icon" type="image/png" sizes="16x16" href="/favicon-16.png?v=5" />
        <link rel="icon" type="image/png" sizes="48x48" media="(prefers-color-scheme: dark)" href="/favicon-dark-48.png?v=5" />
        <link rel="icon" type="image/png" sizes="32x32" media="(prefers-color-scheme: dark)" href="/favicon-dark-32.png?v=5" />
        <link rel="icon" type="image/png" sizes="16x16" media="(prefers-color-scheme: dark)" href="/favicon-dark-16.png?v=5" />
        <link rel="apple-touch-icon" sizes="180x180" href="/apple-icon-180.png?v=5" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Newsreader:ital,opsz,wght@0,6..72,300;0,6..72,400;1,6..72,300;1,6..72,400&family=Spectral:ital,wght@0,300;0,400;1,300;1,400&family=Fraunces:ital,opsz,wght@0,9..144,300;0,9..144,400;1,9..144,300;1,9..144,400&family=DM+Sans:ital,opsz,wght@0,9..40,400;0,9..40,500;0,9..40,600&family=IBM+Plex+Sans:ital,wght@0,400;0,500;0,600;1,400&family=JetBrains+Mono:wght@400;500&family=Geist:wght@300;400;500;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <Script src="https://www.googletagmanager.com/gtag/js?id=AW-18267828347" strategy="afterInteractive" />
        <Script id="gtag-init" strategy="afterInteractive">{`
          window.dataLayer = window.dataLayer || [];
          function gtag(){dataLayer.push(arguments);}
          gtag('js', new Date());
          gtag('config', 'AW-18267828347');
        `}</Script>
        <JsonLd />
        <Providers>{children}</Providers>
        <CookieConsent />
      </body>
    </html>
  );
}
