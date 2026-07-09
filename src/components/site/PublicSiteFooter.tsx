import Link from 'next/link'
import Image from 'next/image'
import {
  PUBLIC_NAV,
  PUBLIC_ORDER_CTA,
  PUBLIC_HOME_HREF,
  PUBLIC_CONTACT,
} from '@/lib/site/publicNav'

/**
 * Public-site footer — Cinelease-structure shell (2026-07-06):
 * wordmark, two link columns mirroring the nav, contact block, and a
 * copyright line. No news/social sections. Coming-soon nav items render
 * as muted non-links, consistent with the header.
 */
export function PublicSiteFooter() {
  const year = 2026 // static: Date.now() is unavailable in this runtime; bump on rollover.

  // Footer mirrors the nav's top-level entries. Plain-link entries link
  // through; dropdown entries surface as a label with their live leaf
  // items indented beneath (coming-soon and sensitive-request leaves are
  // omitted here — the footer is a clean sitemap, not the full menu).
  const footerEntry = (entry: (typeof PUBLIC_NAV)[number]) => {
    if (!entry.groups) {
      return (
        <Link key={entry.label} href={entry.href!} className="text-[#a8a294] hover:text-white transition-colors">
          {entry.label}
        </Link>
      )
    }
    const leaves = entry.groups
      .flatMap((g) => g.items)
      .filter((it) => it.href && (it.mode === 'order' || it.mode === 'download' || it.mode === 'link'))
    return (
      <div key={entry.label}>
        <div className="text-[#8b857a]">{entry.label}</div>
        {leaves.length > 0 && (
          <div className="mt-1.5 flex flex-col gap-1.5 pl-3">
            {leaves.map((it) =>
              it.external ? (
                <a key={it.label} href={it.href} target="_blank" rel="noreferrer" className="text-[#a8a294] hover:text-white transition-colors">
                  {it.label}
                </a>
              ) : (
                <Link key={it.label} href={it.href!} className="text-[#a8a294] hover:text-white transition-colors">
                  {it.label}
                </Link>
              ),
            )}
          </div>
        )}
      </div>
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
          </div>

          {/* Column 1 — nav items */}
          <div>
            <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-[#c39a3f] mb-3.5" style={{ fontFamily: 'Archivo, sans-serif' }}>
              Explore
            </div>
            <nav className="flex flex-col gap-2.5 text-[13.5px]" aria-label="Footer">
              {PUBLIC_NAV.map(footerEntry)}
            </nav>
          </div>

          {/* Column 2 — actions */}
          <div>
            <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-[#c39a3f] mb-3.5" style={{ fontFamily: 'Archivo, sans-serif' }}>
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
        </div>
      </div>
    </footer>
  )
}
