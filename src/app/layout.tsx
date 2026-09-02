import type { Metadata, Viewport } from 'next';
import { Archivo_Black } from 'next/font/google';
import './globals.css';
import { Providers } from './providers';
import { PUBLIC_SITE_ORIGIN } from '@/lib/site/publicUrl';
import { Analytics } from '@vercel/analytics/react';

/**
 * SirReel's display face. The wordmark is a very heavy, tightly-set
 * grotesque — the job title used to be Georgia semibold, which read as
 * generic editorial serif rather than as SirReel (Wes 2026-09-01).
 * Archivo Black is the closest free match to the lockup's weight and fit.
 *
 * next/font self-hosts it at build time, so there is no runtime request to
 * Google and no layout shift. Exposed as a variable and wired to Tailwind's
 * `font-display` so headings opt in — the app's body copy stays on the
 * system stack.
 */
const displayFont = Archivo_Black({
  subsets: ['latin'],
  weight: '400',
  variable: '--font-display',
  display: 'swap',
});

export const metadata: Metadata = {
  // Without metadataBase, Next cannot resolve relative og:image paths and
  // emits absolute-URL warnings at build time; social cards then render
  // blank. Points at the marketing origin because that is the only host
  // whose pages are ever shared or crawled.
  metadataBase: new URL(PUBLIC_SITE_ORIGIN),
  title: 'SirReel HQ',
  description: 'Production vehicle fleet management platform',
  // favicon.ico carries 16→256 frames so the browser picks a size instead of
  // downscaling one 48px image, which is why the tab icon looked mushy and
  // clipped the S's wings. PNGs cover Android/PWA surfaces.
  icons: {
    icon: [
      { url: '/favicon.ico', sizes: 'any' },
      { url: '/icon-192.png', type: 'image/png', sizes: '192x192' },
      { url: '/icon-512.png', type: 'image/png', sizes: '512x512' },
    ],
    apple: '/apple-touch-icon.png',
  },
  // The staff dashboard and client portal share this layout; robots.ts
  // already disallows those hosts wholesale, and this is the belt to that
  // braces. Public pages override it below via the (public) layout.
  robots: { index: false, follow: false },
};

// Explicit, app-wide. Next injects a width=device-width default, but
// nothing declared themeColor (the installed PWA's status-bar tint) or
// viewportFit (the notch safe-area). maximumScale is deliberately left
// alone — pinch-zoom is an accessibility affordance and HQ carries a
// lot of dense tabular data on a phone.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#1a1a1a',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={displayFont.variable}>
      <body className="min-h-screen bg-gray-50 text-gray-900 antialiased">
        <Providers>{children}</Providers>
        {/* Vercel Web Analytics — page views, referrers, top pages.
            Mounted at the root so it is instrumented once for the whole
            app; it previously lived on the (public) shell alone. Note
            that the staff dashboard and the client portal share this
            root, so authenticated surfaces are now measured too.
            Cookieless and does not fingerprint, so no consent banner. */}
        <Analytics />
      </body>
    </html>
  );
}
