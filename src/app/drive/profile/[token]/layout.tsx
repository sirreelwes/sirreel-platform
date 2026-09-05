import type { Metadata, Viewport } from 'next'

export const metadata: Metadata = { title: 'Your driver profile — SirReel', robots: { index: false, follow: false } }
export const viewport: Viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover', themeColor: '#09090b' }

export default function DriverProfileLayout({ children }: { children: React.ReactNode }) {
  return children
}
