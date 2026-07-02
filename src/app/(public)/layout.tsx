import { Archivo, Hanken_Grotesk } from 'next/font/google'
import { PublicSiteNav } from '@/components/site/PublicSiteNav'
import { PublicSiteFooter } from '@/components/site/PublicSiteFooter'

/**
 * Shared public-site shell (SirReel marketing surface, orders.sirreel.com).
 *
 * This is the reusable foundation for the public site inside HQ: nav + fonts +
 * footer wrap every public page in the (public) route group. Future pages
 * (Studios, Equipment, Forms, Contact, Home) drop a page.tsx into this group
 * and inherit the shell for free. The route group `(public)` does NOT affect
 * the URL — pages resolve at their bare path (e.g. /vehicles).
 *
 * Fully public: no session gate here (auth is enforced only in the
 * (dashboard) group), so unauthenticated visitors render these pages directly.
 * Typography mirrors the order form — Archivo (display) + Hanken Grotesk (body).
 */
const archivo = Archivo({
  subsets: ['latin'],
  weight: ['500', '600', '700', '800', '900'],
  variable: '--font-archivo',
  display: 'swap',
})
const hanken = Hanken_Grotesk({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-hanken',
  display: 'swap',
})

export default function PublicSiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <div
      className={`${archivo.variable} ${hanken.variable} min-h-screen flex flex-col bg-[#f4f1ea] text-[#0c0c0d]`}
      style={{ fontFamily: '"Hanken Grotesk", Inter, system-ui, sans-serif' }}
    >
      <PublicSiteNav />
      <main className="flex-1">{children}</main>
      <PublicSiteFooter />
    </div>
  )
}
