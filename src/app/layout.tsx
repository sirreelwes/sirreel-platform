import type { Metadata } from 'next';
import './globals.css';
import { Providers } from './providers';
import { PUBLIC_SITE_ORIGIN } from '@/lib/site/publicUrl';

export const metadata: Metadata = {
  // Without metadataBase, Next cannot resolve relative og:image paths and
  // emits absolute-URL warnings at build time; social cards then render
  // blank. Points at the marketing origin because that is the only host
  // whose pages are ever shared or crawled.
  metadataBase: new URL(PUBLIC_SITE_ORIGIN),
  title: 'SirReel HQ',
  description: 'Production vehicle fleet management platform',
  icons: { icon: '/favicon.ico', apple: '/apple-touch-icon.png' },
  // The staff dashboard and client portal share this layout; robots.ts
  // already disallows those hosts wholesale, and this is the belt to that
  // braces. Public pages override it below via the (public) layout.
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-gray-50 text-gray-900 antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
