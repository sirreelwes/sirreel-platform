/**
 * VerMar Design's PUBLIC site for HQ — what vermardesign.com serves. Its
 * own route group so neither SirReel's marketing shell nor the staff
 * shell wraps it, and no gate: this is the front door. The middleware
 * rewrites the vermardesign.com root here; on hq.sirreel.com it is also
 * reachable at /vermar-site, unlinked.
 */
import type { Metadata } from 'next'
import { HQ_PRODUCT } from '@/lib/hq-white-label/product'

export const metadata: Metadata = {
  title: `${HQ_PRODUCT.name} by ${HQ_PRODUCT.maker} — ${HQ_PRODUCT.tagline}`,
  description: 'Fleet operations for production-vehicle companies: one calendar for every unit, your own bookings and clients, and the bookings your partners place, all in one place.',
  robots: { index: true, follow: true },
}

export default function VerMarSiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[#0f1523] text-white antialiased" style={{ fontFamily: "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif" }}>
      {children}
    </div>
  )
}
