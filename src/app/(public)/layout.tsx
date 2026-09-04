import type { Metadata } from 'next'
import { Archivo, Hanken_Grotesk } from 'next/font/google'
import { PublicSiteNav } from '@/components/site/PublicSiteNav'
import { PublicSiteFooter } from '@/components/site/PublicSiteFooter'
import { PublicAssistantWidget } from '@/components/site/PublicAssistantWidget'
import { hasPublishedSpaces } from '@/lib/site/spaces'

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

/**
 * Public-site metadata defaults.
 *
 * The root layout sets robots noindex — correct for the staff dashboard
 * and the client portal, which share it. This group is the ONLY part of
 * the app that should be crawled, so it flips indexing back on and adds
 * the social-card defaults every marketing page inherits.
 *
 * `title.default` covers pages that set no title of their own; those used
 * to fall through to the root layout's "SirReel HQ / Production vehicle
 * fleet management platform", i.e. the internal tool's name on the
 * marketing homepage.
 */
export const metadata: Metadata = {
  title: {
    default: 'SirReel Studio Services — Production Trucks, Stages & Standing Sets in LA',
    template: '%s',
  },
  description:
    'SirReel rents production vehicles, sound stages and standing sets to film and television productions in Los Angeles — cube trucks, cargo and passenger vans, camera cubes, and the Lankershim stages.',
  // NO `alternates.canonical` here on purpose. Next merges metadata shallowly
  // from layout → page, so a canonical set at this level is INHERITED by every
  // public page that doesn't declare its own — which meant /stages, /help,
  // /vehicles, /rental-agreement and the rest all shipped
  // <link rel="canonical" href="https://sirreel.com"> and told Google they
  // were duplicates of the homepage. Each page below now declares its own
  // self-referencing canonical; metadataBase (root layout) resolves them to
  // the apex host.
  robots: { index: true, follow: true },
  openGraph: {
    type: 'website',
    siteName: 'SirReel Studio Services',
    locale: 'en_US',
    url: '/',
    images: [{ url: '/full-logo.jpg', alt: 'SirReel Studio Services' }],
  },
  twitter: {
    card: 'summary_large_image',
    images: ['/full-logo.jpg'],
  },
}

export default async function PublicSiteLayout({ children }: { children: React.ReactNode }) {
  // Publish gate for the Studios ▾ nav: the "Standing Sets" entry stays a
  // "coming soon" placeholder until a standing set is published with a
  // photo, then becomes a live link — mirroring the home tile gate.
  const standingSetsLive = await hasPublishedSpaces('STANDING_SET').catch(() => false)
  const liveStudioLinks: Record<string, string> = standingSetsLive
    ? { 'Standing Sets': '/standing-sets' }
    : {}

  return (
    <div
      className={`${archivo.variable} ${hanken.variable} min-h-screen flex flex-col bg-[#f4f1ea] text-[#0c0c0d]`}
      style={{ fontFamily: '"Hanken Grotesk", Inter, system-ui, sans-serif' }}
    >
      <PublicSiteNav liveStudioLinks={liveStudioLinks} />
      <main className="flex-1">{children}</main>
      <PublicSiteFooter />
      {/* After-hours AI assistant — floating chat on every public page.
          Handles FAQs + verified access-code release (server-side auth). */}
      <PublicAssistantWidget />
      {/* Vercel Web Analytics moved to the ROOT layout — mounting it here
          too would inject the script twice on every public page and
          double-count page views. */}
    </div>
  )
}
