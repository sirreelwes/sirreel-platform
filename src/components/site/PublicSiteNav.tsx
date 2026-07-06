'use client'

import { useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { usePathname } from 'next/navigation'
import {
  PUBLIC_NAV,
  PUBLIC_ORDER_CTA,
  PUBLIC_HOME_HREF,
  PUBLIC_CONTACT,
  PUBLIC_SOCIAL,
  type NavEntry,
  type NavLeaf,
} from '@/lib/site/publicNav'

/**
 * Public-site header — Cinelease structure (2026-07-06):
 *
 *   1. Utility row (dark): phone + email + Instagram/TikTok icons
 *      upper-left; SirReel WORDMARK centered (→ Home); gold "ORDER →"
 *      button upper-right (→ order form).
 *   2. ~1px muted divider under the utility row.
 *   3. Centered nav row: Home · Studios ▾ · Vehicles · Equipment ▾ ·
 *      Forms ▾ · Contact. Studios/Equipment/Forms are dropdowns.
 *
 * Mobile: wordmark centered with a hamburger left and the ORDER button
 * right; the menu opens phone/email/socials + nav (dropdowns as
 * expandable sections). All nav data is driven by publicNav.ts.
 *
 * Mode-aware leaves (order / quote / download / request / coming-soon)
 * render per their mode: downloads open in a new tab; coming-soon is a
 * non-clickable placeholder.
 */

function InstagramIcon() {
  return (
    <svg width={17} height={17} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round">
      <rect x={2} y={2} width={20} height={20} rx={5} />
      <circle cx={12} cy={12} r={4} />
      <path d="M17.5 6.5h.01" />
    </svg>
  )
}
function TikTokIcon() {
  return (
    <svg width={17} height={17} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M16.5 3c.3 2 1.6 3.6 3.5 4v2.5c-1.3 0-2.6-.4-3.6-1v6.3a5.8 5.8 0 1 1-5-5.7v2.6a3.2 3.2 0 1 0 2.4 3.1V3h2.7Z" />
    </svg>
  )
}

export function PublicSiteNav() {
  const pathname = usePathname()
  const [open, setOpen] = useState(false) // mobile menu
  const [expanded, setExpanded] = useState<string | null>(null) // mobile dropdown section

  const isActive = (href?: string) => {
    if (!href) return false
    const base = href.split(/[?#]/)[0]
    if (base === '/home') return pathname === '/home'
    return pathname === base || pathname.startsWith(base + '/')
  }

  // A single leaf inside a dropdown (desktop or mobile panel).
  const leaf = (item: NavLeaf, onNav?: () => void) => {
    if (item.mode === 'coming-soon' || !item.href) {
      return (
        <span
          key={item.label}
          aria-disabled="true"
          title="Coming soon"
          className="block px-3 py-2 text-[13px] text-[#6d685e] cursor-not-allowed select-none"
        >
          {item.label} <span className="text-[10px] uppercase tracking-wide">· soon</span>
        </span>
      )
    }
    // Downloads are file responses → plain anchor, new tab.
    if (item.external) {
      return (
        <a
          key={item.label}
          href={item.href}
          target="_blank"
          rel="noreferrer"
          onClick={onNav}
          className="block px-3 py-2 text-[13px] text-[#cfc9bd] hover:text-white hover:bg-white/5 rounded transition-colors"
        >
          {item.label}
        </a>
      )
    }
    return (
      <Link
        key={item.label}
        href={item.href}
        onClick={onNav}
        className="block px-3 py-2 text-[13px] text-[#cfc9bd] hover:text-white hover:bg-white/5 rounded transition-colors"
      >
        {item.label}
      </Link>
    )
  }

  // Desktop top-level entry — plain link or hover/focus dropdown.
  const desktopEntry = (entry: NavEntry) => {
    if (!entry.groups) {
      const active = isActive(entry.href)
      return (
        <Link
          key={entry.label}
          href={entry.href!}
          aria-current={active ? 'page' : undefined}
          className={`text-[13px] font-semibold uppercase tracking-[0.08em] whitespace-nowrap transition-colors ${
            active ? 'text-[#c39a3f]' : 'text-[#cfc9bd] hover:text-white'
          }`}
          style={{ fontFamily: 'Archivo, sans-serif' }}
        >
          {entry.label}
        </Link>
      )
    }
    // Dropdown — CSS hover + focus-within, keyboard accessible.
    return (
      <div key={entry.label} className="relative group">
        <button
          type="button"
          className="text-[13px] font-semibold uppercase tracking-[0.08em] whitespace-nowrap text-[#cfc9bd] group-hover:text-white transition-colors inline-flex items-center gap-1"
          style={{ fontFamily: 'Archivo, sans-serif' }}
          aria-haspopup="true"
        >
          {entry.label}
          <span className="text-[9px]" aria-hidden>▾</span>
        </button>
        <div className="invisible opacity-0 group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100 transition-opacity absolute left-1/2 -translate-x-1/2 top-full pt-3 z-50">
          <div className="min-w-[230px] bg-[#141416] border border-white/10 rounded-xl shadow-[0_20px_50px_rgba(0,0,0,0.45)] py-2">
            {entry.groups.map((g, gi) => (
              <div key={g.heading ?? gi} className={gi > 0 ? 'mt-1 pt-1 border-t border-white/10' : ''}>
                {g.heading && (
                  <div className="px-3 pt-1.5 pb-1 text-[10px] font-bold uppercase tracking-[0.12em] text-[#c39a3f]" style={{ fontFamily: 'Archivo, sans-serif' }}>
                    {g.heading}
                  </div>
                )}
                {g.items.map((it) => leaf(it))}
              </div>
            ))}
          </div>
        </div>
      </div>
    )
  }

  // Mobile top-level entry — plain link or expandable section.
  const mobileEntry = (entry: NavEntry) => {
    if (!entry.groups) {
      return (
        <Link
          key={entry.label}
          href={entry.href!}
          onClick={() => setOpen(false)}
          className="block py-2 text-[15px] font-semibold uppercase tracking-[0.06em] text-[#e8e3d7]"
          style={{ fontFamily: 'Archivo, sans-serif' }}
        >
          {entry.label}
        </Link>
      )
    }
    const isEx = expanded === entry.label
    return (
      <div key={entry.label} className="border-b border-white/10 last:border-0">
        <button
          type="button"
          onClick={() => setExpanded(isEx ? null : entry.label)}
          aria-expanded={isEx}
          className="w-full flex items-center justify-between py-2 text-[15px] font-semibold uppercase tracking-[0.06em] text-[#e8e3d7]"
          style={{ fontFamily: 'Archivo, sans-serif' }}
        >
          {entry.label}
          <span className={`text-[11px] transition-transform ${isEx ? 'rotate-180' : ''}`} aria-hidden>▾</span>
        </button>
        {isEx && (
          <div className="pb-2">
            {entry.groups.map((g, gi) => (
              <div key={g.heading ?? gi} className="mb-1">
                {g.heading && (
                  <div className="px-1 pt-1 pb-0.5 text-[10px] font-bold uppercase tracking-[0.12em] text-[#c39a3f]" style={{ fontFamily: 'Archivo, sans-serif' }}>
                    {g.heading}
                  </div>
                )}
                {g.items.map((it) => leaf(it, () => setOpen(false)))}
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }

  const orderBtn = (extra = '') => (
    <Link
      href={PUBLIC_ORDER_CTA.href}
      className={`inline-flex items-center rounded-full border-[1.5px] border-[#c39a3f] text-[#c39a3f] hover:bg-[#c39a3f] hover:text-[#0c0c0d] px-5 py-2 text-[12.5px] font-bold uppercase tracking-[0.08em] whitespace-nowrap transition-colors ${extra}`}
      style={{ fontFamily: 'Archivo, sans-serif' }}
    >
      {PUBLIC_ORDER_CTA.label} →
    </Link>
  )

  const socials = (size = '') => (
    <div className={`flex items-center gap-3 ${size}`}>
      <a href={PUBLIC_SOCIAL.instagram} aria-label="Instagram" target="_blank" rel="noreferrer" className="text-[#a8a294] hover:text-white transition-colors">
        <InstagramIcon />
      </a>
      <a href={PUBLIC_SOCIAL.tiktok} aria-label="TikTok" target="_blank" rel="noreferrer" className="text-[#a8a294] hover:text-white transition-colors">
        <TikTokIcon />
      </a>
    </div>
  )

  return (
    <header className="sticky top-0 z-40 bg-[#0c0c0d] text-white">
      {/* ── 1. Utility row ─────────────────────────────────────── */}
      <div className="max-w-[1480px] mx-auto px-5">
        {/* Desktop: 3-column grid so the wordmark is truly centered. */}
        <div className="hidden md:grid grid-cols-[1fr_auto_1fr] items-center gap-4 py-3.5">
          <div className="flex flex-col gap-1.5 text-[12px] text-[#a8a294]">
            <div className="flex items-center gap-4">
              <a href={PUBLIC_CONTACT.phoneHref} className="hover:text-white transition-colors whitespace-nowrap">{PUBLIC_CONTACT.phone}</a>
              <a href={PUBLIC_CONTACT.emailHref} className="hover:text-white transition-colors whitespace-nowrap">{PUBLIC_CONTACT.email}</a>
            </div>
            {socials()}
          </div>
          <Link href={PUBLIC_HOME_HREF} aria-label="SirReel — Home" className="justify-self-center">
            <Image src="/sirreel-logo-white.png" alt="SirReel Studio Services" width={520} height={137} priority className="h-12 lg:h-14 w-auto" />
          </Link>
          <div className="justify-self-end">
            {orderBtn()}
          </div>
        </div>

        {/* Mobile: hamburger · wordmark · order button */}
        <div className="md:hidden flex items-center justify-between gap-3 py-3">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-label={open ? 'Close menu' : 'Open menu'}
            aria-expanded={open}
            className="w-10 h-10 -ml-2 inline-flex items-center justify-center text-white flex-none"
          >
            {open ? (
              <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
            ) : (
              <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
            )}
          </button>
          <Link href={PUBLIC_HOME_HREF} aria-label="SirReel — Home" className="min-w-0">
            <Image src="/sirreel-logo-white.png" alt="SirReel Studio Services" width={400} height={105} priority className="h-9 w-auto" />
          </Link>
          <div className="flex-none">
            <Link
              href={PUBLIC_ORDER_CTA.href}
              className="inline-flex items-center rounded-full border-[1.5px] border-[#c39a3f] text-[#c39a3f] px-3.5 py-1.5 text-[11.5px] font-bold uppercase tracking-[0.08em] whitespace-nowrap"
              style={{ fontFamily: 'Archivo, sans-serif' }}
            >
              {PUBLIC_ORDER_CTA.label} →
            </Link>
          </div>
        </div>
      </div>

      {/* ── 2. Divider ─────────────────────────────────────────── */}
      <div className="border-t border-white/10" />

      {/* ── 3. Nav row (desktop) ───────────────────────────────── */}
      <div className="hidden md:block">
        <div className="max-w-[1480px] mx-auto px-5 h-14 flex items-center justify-center">
          <nav className="flex items-center gap-8" aria-label="Primary">
            {PUBLIC_NAV.map((entry) => desktopEntry(entry))}
          </nav>
        </div>
      </div>

      {/* Mobile menu panel */}
      {open && (
        <div className="md:hidden border-t border-white/10 bg-[#0c0c0d]">
          <div className="max-w-[1480px] mx-auto px-5 py-4">
            <nav aria-label="Primary mobile" className="flex flex-col">
              {PUBLIC_NAV.map((entry) => mobileEntry(entry))}
            </nav>
            <div className="mt-4 pt-4 border-t border-white/10 flex flex-col gap-2.5 text-[13px] text-[#a8a294]">
              <a href={PUBLIC_CONTACT.phoneHref} className="hover:text-white transition-colors">{PUBLIC_CONTACT.phone}</a>
              <a href={PUBLIC_CONTACT.emailHref} className="hover:text-white transition-colors">{PUBLIC_CONTACT.email}</a>
              {socials('mt-1')}
            </div>
          </div>
        </div>
      )}
    </header>
  )
}
