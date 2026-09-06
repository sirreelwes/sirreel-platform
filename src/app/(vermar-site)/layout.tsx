/**
 * Utliiz's PUBLIC site — what utliiz.com (and vermardesign.com) serve.
 * Its own route group so neither SirReel's marketing shell nor the staff
 * shell wraps it, and no gate: this is the front door.
 *
 * LOOK (Wes 2026-09-06: "something completely different to SirReel.com,
 * use that turquoise color as a base", then "match the font to the word
 * mark and incorporate more of those colors into site"): DM Sans
 * throughout, the mark's Utah red (#CC0000) on every action, the mark's
 * ink (#0f2a30) on the type, and the invoice turquoise family
 * (#0F7A93 / #8FC2CE / #E4F1F4 / #F1F8F9) for fills, the calendar and the
 * ground. SirReel is black + gold, Archivo + Hanken, cream — nothing here
 * should read as that.
 */
import type { Metadata } from 'next'
import { DM_Sans } from 'next/font/google'
import { HQ_PRODUCT } from '@/lib/hq-white-label/product'

// One family, the wordmark's: DM Sans (Wes 2026-09-06: "match the font to
// the word mark"). 900 carries the headlines exactly as the mark does;
// 400–700 carry the body. Both variables point at it so nothing else has
// to change to follow.
const dmSans = DM_Sans({ subsets: ['latin'], weight: ['400', '500', '700', '900'], variable: '--font-utliiz-display', display: 'swap' })
const dmSansBody = DM_Sans({ subsets: ['latin'], weight: ['400', '500', '700'], variable: '--font-utliiz-body', display: 'swap' })

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
      className={`${dmSans.variable} ${dmSansBody.variable} min-h-screen bg-[#F1F8F9] text-[#0f2a30] antialiased`}
      style={{ fontFamily: 'var(--font-utliiz-body), system-ui, sans-serif' }}
    >
      {children}
    </div>
  )
}
