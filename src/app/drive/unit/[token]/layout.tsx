import type { Metadata, Viewport } from 'next'

/**
 * Metadata for the partner driver's page. Without this it inherits the root
 * "SirReel HQ" title — wrong name in a driver's browser tab. Noindex like
 * every token page. Dark theme-color so the iOS status bar matches.
 */
export const metadata: Metadata = {
  title: 'Your job — SirReel',
  robots: { index: false, follow: false },
}
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#09090b',
}

export default function DriverUnitLayout({ children }: { children: React.ReactNode }) {
  return children
}
