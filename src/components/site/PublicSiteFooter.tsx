import Link from 'next/link'
import Image from 'next/image'
import { SocialLinks } from '@/components/site/SocialIcons'
import {
  PUBLIC_NAV,
  PUBLIC_ORDER_CTA,
  PUBLIC_HOME_HREF,
  PUBLIC_CONTACT,
} from '@/lib/site/publicNav'

/**
 * Public-site footer — Cinelease-structure shell (2026-07-06):
 * wordmark, a short Explore column (top-level nav rows only), a Get
 * Started column, contact block, and a copyright line. No news/social
 * sections.
 */
export function PublicSiteFooter() {
  const year = 2026 // static: Date.now() is unavailable in this runtime; bump on rollover.

  // Footer lists the nav's TOP-LEVEL entries only — six short rows. The
  // nested leaves (nine under Forms alone) stay in the header menu; printing
  // the whole tree here made a twenty-row trail beside two near-empty
  // columns (Wes 2026-09-06). Dropdown entries link to their footerHref.
  const footerEntry = (entry: (typeof PUBLIC_NAV)[number]) => {
    const href = entry.href ?? entry.footerHref
    if (!href) return null
    return (
      <Link key={entry.label} href={href} className="text-[#a8a294] hover:text-white transition-colors">
        {entry.label}
      </Link>
    )
  }

  return (
    <footer className="bg-[#0c0c0d] text-[#8b857a] border-t border-white/10">
      <div className="max-w-[1480px] mx-auto px-5 py-12">
        <div className="grid gap-10 sm:grid-cols-[1.4fr_1fr_1fr]">
          {/* Brand + contact */}
          <div>
            <Link href={PUBLIC_HOME_HREF} aria-label="SirReel — Home" className="inline-block">
              <Image
                src="/sirreel-logo-white.png"
                alt="SirReel Studio Services"
                width={400}
                height={105}
                className="h-9 w-auto"
              />
            </Link>
            <p className="mt-5 text-[13px] leading-relaxed">
              {PUBLIC_CONTACT.address}
            </p>
            <p className="mt-1.5 text-[13px] leading-relaxed">
              <a href={PUBLIC_CONTACT.phoneHref} className="hover:text-white transition-colors">
                {PUBLIC_CONTACT.phone}
              </a>
              {' · '}
              <a href={PUBLIC_CONTACT.emailHref} className="hover:text-white transition-colors">
                {PUBLIC_CONTACT.email}
              </a>
            </p>
            {/* Same component the nav uses — hides any profile still on the
                '#' placeholder. */}
            <SocialLinks className="mt-4" size={19} />
          </div>

          {/* Column 1 — nav items */}
          <div>
            <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-[#4DB1C6] mb-3.5" style={{ fontFamily: 'Archivo, sans-serif' }}>
              Explore
            </div>
            <nav className="flex flex-col gap-2.5 text-[13.5px]" aria-label="Footer">
              {PUBLIC_NAV.map(footerEntry)}
            </nav>
          </div>

          {/* Column 2 — actions */}
          <div>
            <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-[#4DB1C6] mb-3.5" style={{ fontFamily: 'Archivo, sans-serif' }}>
              Get Started
            </div>
            <nav className="flex flex-col gap-2.5 text-[13.5px]" aria-label="Footer actions">
              <Link href={PUBLIC_ORDER_CTA.href} className="text-[#a8a294] hover:text-white transition-colors">
                {PUBLIC_ORDER_CTA.label}
              </Link>
              <Link href="/contact" className="text-[#a8a294] hover:text-white transition-colors">
                Contact Us
              </Link>
            </nav>
          </div>
        </div>

        <div className="mt-10 pt-6 border-t border-white/10 text-[12px] text-[#6d685e] flex items-center gap-2">
          {/* Quiet S-mark sign-off beside the copyright line. */}
          <Image src="/s-logo-white.png" alt="" aria-hidden width={1118} height={1065} className="h-3.5 w-auto opacity-40" />
          <span>© {year} {PUBLIC_CONTACT.entity}. All rights reserved.</span>
          {/* Carriers verify the SMS number against a linked policy — keep these two visible. */}
          <span className="ml-auto flex items-center gap-3">
            <Link href="/privacy" className="hover:text-white transition-colors">Privacy</Link>
            <Link href="/sms-terms" className="hover:text-white transition-colors">Text message terms</Link>
          </span>
        </div>
      </div>
    </footer>
  )
}
