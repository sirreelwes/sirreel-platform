/**
 * Utliiz's PUBLIC site — what utliiz.com (and vermardesign.com) serve.
 * Its own route group so neither SirReel's marketing shell nor the staff
 * shell wraps it, and no gate: this is the front door.
 *
 * LOOK (Wes 2026-09-06: "something completely different to SirReel.com,
 * use that turquoise color as a base that we used for pdf invoices"):
 * SirReel is black + gold, Archivo + Hanken, cream. Utliiz is the
 * invoice turquoise (#0F7A93 and its family from src/lib/pdf/brand.ts)
 * on white and a pale aqua ground, deep teal-black type, Sora for
 * display and Manrope for body. Nothing here should read as SirReel.
 */
import type { Metadata } from 'next'
import { Sora, Manrope } from 'next/font/google'
import { HQ_PRODUCT } from '@/lib/hq-white-label/product'

const display = Sora({ subsets: ['latin'], weight: ['600', '700', '800'], variable: '--font-utliiz-display', display: 'swap' })
const body = Manrope({ subsets: ['latin'], weight: ['400', '500', '600', '700'], variable: '--font-utliiz-body', display: 'swap' })

export const metadata: Metadata = {
  title: `${HQ_PRODUCT.name} — ${HQ_PRODUCT.tagline}`,
  description: 'Fleet operations for rental companies: one calendar for every unit, your own bookings and clients, and the bookings your partners place, all in one place.',
  robots: { index: true, follow: true },
  icons: {
    icon: [{ url: '/utliiz-icon.svg', type: 'image/svg+xml' }, { url: '/utliiz-icon-192.png', type: 'image/png', sizes: '192x192' }, { url: '/utliiz-icon-512.png', type: 'image/png', sizes: '512x512' }],
    apple: '/utliiz-apple-touch-icon.png',
  },
}

export default function UtliizSiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <div
      className={`${display.variable} ${body.variable} min-h-screen bg-[#F1F8F9] text-[#0f2a30] antialiased`}
      style={{ fontFamily: 'var(--font-utliiz-body), system-ui, sans-serif' }}
    >
      {children}
    </div>
  )
}
