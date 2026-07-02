'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { PUBLIC_NAV, PUBLIC_ORDER_CTA } from '@/lib/site/publicNav'

/**
 * Shared public-site nav bar — the SirReel marketing header used across every
 * public page (orders.sirreel.com). Matches the order-form shell: sticky
 * near-black bar, live-text "Sir<gold>Reel</gold>" wordmark in Archivo, gold
 * accent (#c39a3f), amber ORDER CTA.
 *
 * Link enablement is DATA-DRIVEN by src/lib/site/publicNav.ts: items with
 * `live: false` render as visible-but-inactive placeholders (no href, not
 * clickable, "coming soon" cursor) so the full site map shows without dead
 * links or 404s. Flip `live: true` there once a page ships.
 */
export function PublicSiteNav() {
  const pathname = usePathname()

  const isActive = (href: string) =>
    href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(href + '/')

  return (
    <header className="sticky top-0 z-40 bg-[#0c0c0d] text-white border-b border-black">
      <div className="max-w-[1480px] mx-auto px-5 h-[68px] flex items-center justify-between gap-4">
        {/* Wordmark — the gold "Reel" is the signature. Not a link until the
            Home page is live (mirrors the order form's non-link wordmark). */}
        <div className="flex items-center gap-3 min-w-0 shrink-0">
          <div
            className="font-black text-2xl tracking-tight whitespace-nowrap"
            style={{ fontFamily: 'Archivo, sans-serif' }}
          >
            Sir<span className="text-[#c39a3f]">Reel</span>
          </div>
          <div className="hidden lg:block w-px h-6 bg-zinc-700" />
          <div
            className="hidden lg:block text-[12px] font-semibold uppercase tracking-[0.14em] text-[#a8a294] whitespace-nowrap"
            style={{ fontFamily: 'Archivo, sans-serif' }}
          >
            Studio Services
          </div>
        </div>

        {/* Nav links + ORDER CTA */}
        <nav
          className="flex items-center gap-1 sm:gap-2 md:gap-3 overflow-x-auto"
          style={{ fontFamily: 'Archivo, sans-serif' }}
          aria-label="Primary"
        >
          {PUBLIC_NAV.map((item) => {
            const active = item.live && isActive(item.href)
            if (!item.live) {
              return (
                <span
                  key={item.label}
                  aria-disabled="true"
                  title="Coming soon"
                  className="hidden sm:inline text-[13px] font-semibold px-2 py-2 text-[#6d685e] cursor-not-allowed select-none whitespace-nowrap"
                >
                  {item.label}
                </span>
              )
            }
            return (
              <Link
                key={item.label}
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={`text-[13px] font-semibold px-2 py-2 whitespace-nowrap transition-colors ${
                  active
                    ? 'text-white border-b-2 border-[#c39a3f]'
                    : 'text-[#cfc9bd] hover:text-white'
                }`}
              >
                {item.label}
              </Link>
            )
          })}

          <Link
            href={PUBLIC_ORDER_CTA.href}
            className="ml-1 sm:ml-2 inline-flex items-center rounded-full bg-amber-600 hover:bg-amber-500 text-white px-4 py-2 text-[13px] font-bold whitespace-nowrap transition-colors"
            style={{ fontFamily: 'Archivo, sans-serif' }}
          >
            {PUBLIC_ORDER_CTA.label}
          </Link>
        </nav>
      </div>
    </header>
  )
}
