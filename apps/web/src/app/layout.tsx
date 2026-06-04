import type { Metadata, Viewport } from 'next';
import './globals.css';
import { Providers } from '@/components/Providers';

export const metadata: Metadata = {
  title: 'fork ai',
  description: 'A branching research workspace — ask once, branch forever.',
};

// viewport-fit=cover lets the Capacitor/iOS safe-area insets (notch, home bar)
// reach the CSS env() values the mobile layout relies on.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        {/* Transparent marks. The dark mark (for light tabs) is the non-media DEFAULT,
            incl. the .ico that Safari requests by default and uses regardless of theme
            (Safari ignores prefers-color-scheme on favicons). The white mark is a
            dark-scheme version for browsers that honor it (Chrome/Firefox). */}
        <link rel="icon" href="/favicon.ico?v=3" sizes="any" />
        <link rel="icon" type="image/png" sizes="48x48" href="/favicon-48.png?v=3" />
        <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png?v=3" />
        <link rel="icon" type="image/png" sizes="16x16" href="/favicon-16.png?v=3" />
        <link rel="icon" type="image/png" sizes="48x48" media="(prefers-color-scheme: dark)" href="/favicon-dark-48.png?v=3" />
        <link rel="icon" type="image/png" sizes="32x32" media="(prefers-color-scheme: dark)" href="/favicon-dark-32.png?v=3" />
        <link rel="icon" type="image/png" sizes="16x16" media="(prefers-color-scheme: dark)" href="/favicon-dark-16.png?v=3" />
        <link rel="apple-touch-icon" sizes="180x180" href="/favicon-180.png?v=3" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Newsreader:ital,opsz,wght@0,6..72,300;0,6..72,400;1,6..72,300;1,6..72,400&family=Spectral:ital,wght@0,300;0,400;1,300;1,400&family=Fraunces:ital,opsz,wght@0,9..144,300;0,9..144,400;1,9..144,300;1,9..144,400&family=DM+Sans:ital,opsz,wght@0,9..40,400;0,9..40,500;0,9..40,600&family=IBM+Plex+Sans:ital,wght@0,400;0,500;0,600;1,400&family=JetBrains+Mono:wght@400;500&family=Geist:wght@300;400;500;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
