'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { usePathname } from 'next/navigation'
import { Search, X as CloseIcon } from 'lucide-react'
import { SocialLinks } from '@/components/site/SocialIcons'
import { SiteSearch } from '@/components/site/SiteSearch'
import { PublicCartPill } from '@/components/site/PublicCartPill'
import { useSupplyCart } from '@/hooks/useSupplyCart'
import {
  PUBLIC_NAV,
  PUBLIC_ORDER_CTA,
  PUBLIC_HOME_HREF,
  PUBLIC_CONTACT,
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
 *
 * SEARCH + CART (2026-09-12): a search icon opens a full-width field
 * under the header on EVERY public page, and rows in it add straight to
 * the cart. A client prepping a job can search-and-add from wherever they
 * happen to be — the fleet page, the stages page — instead of having to
 * find their way back to the order form first.
 *
 * A panel, not an inline field, because the nav row is a centered
 * six-entry bar: an inline field fits at 1280 and collides at 900, and
 * the icon behaves identically at every width. The Home hero keeps its
 * own big search pill; this is the one for everywhere else.
 */

export function PublicSiteNav({
  liveStudioLinks = {},
}: {
  /** Runtime publish gate: coming-soon leaves whose label is a key here
   *  render as a live link to the given href instead of a placeholder.
   *  Driven by the (public) layout (e.g. Standing Sets once published). */
  liveStudioLinks?: Record<string, string>
} = {}) {
  const pathname = usePathname()
  const [open, setOpen] = useState(false) // mobile menu
  const [expanded, setExpanded] = useState<string | null>(null) // mobile dropdown section
  const [openMenu, setOpenMenu] = useState<string | null>(null) // desktop dropdown
  const [searchOpen, setSearchOpen] = useState(false) // header search panel
  const navRef = useRef<HTMLElement>(null)
  // Mobile shows ONE of the ORDER button / cart pill, so the nav needs the
  // count itself rather than letting the pill decide its own visibility.
  const { totalUnits: cartUnits } = useSupplyCart()

  // Close the desktop dropdown on route change so a click-through never
  // leaves it hanging open on the next page.
  useEffect(() => {
    setOpenMenu(null)
    // The panel stays open across ADDS (that's the fast path) but not
    // across navigation — landing on a new page behind an open search
    // field reads as a broken back button.
    setSearchOpen(false)
  }, [pathname])

  // NOTE: Escape is NOT handled here. The field owns that key — first
  // press closes its results list, second clears the query — and a
  // document-level listener would race it and yank the whole panel on the
  // first press. SiteSearch calls onEscape only once it has nothing of its
  // own left to close.

  // While a desktop dropdown is open, close it on outside click or Escape.
  // (Hover + click both open it; mouse-leave/blur close it — see
  // desktopEntry. This covers the click-away and keyboard cases.)
  useEffect(() => {
    if (!openMenu) return
    const onDown = (e: MouseEvent) => {
      if (navRef.current && !navRef.current.contains(e.target as Node)) setOpenMenu(null)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpenMenu(null)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [openMenu])

  const isActive = (href?: string) => {
    if (!href) return false
    const base = href.split(/[?#]/)[0]
    if (base === '/home') return pathname === '/home'
    return pathname === base || pathname.startsWith(base + '/')
  }

  // A single leaf inside a dropdown (desktop or mobile panel).
  const leaf = (item: NavLeaf, onNav?: () => void) => {
    // Runtime publish gate: a coming-soon leaf flips to a live link once
    // its content is published (e.g. Standing Sets → /standing-sets).
    const liveHref = liveStudioLinks[item.label]
    if (item.mode === 'coming-soon' && liveHref) {
      return (
        <Link
          key={item.label}
          href={liveHref}
          onClick={onNav}
          className="block px-3 py-2 text-[13px] text-[#cfc9bd] hover:text-white hover:bg-white/5 rounded transition-colors"
        >
          {item.label}
        </Link>
      )
    }
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
            active ? 'text-[#4DB1C6]' : 'text-[#cfc9bd] hover:text-white'
          }`}
          style={{ fontFamily: 'Archivo, sans-serif' }}
        >
          {entry.label}
        </Link>
      )
    }
    // Dropdown — controlled open state. Hover opens it, a click toggles it,
    // and it closes on mouse-leave, blur-out, Escape, outside-click, or
    // navigation. (The old CSS focus-within kept it stuck open after a
    // click gave the trigger focus.)
    const isOpen = openMenu === entry.label
    return (
      <div
        key={entry.label}
        className="relative"
        onMouseEnter={() => setOpenMenu(entry.label)}
        onMouseLeave={() => setOpenMenu(null)}
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) setOpenMenu(null)
        }}
      >
        <button
          type="button"
          onClick={() => setOpenMenu(isOpen ? null : entry.label)}
          aria-haspopup="true"
          aria-expanded={isOpen}
          className="text-[13px] font-semibold uppercase tracking-[0.08em] whitespace-nowrap text-[#cfc9bd] hover:text-white transition-colors inline-flex items-center gap-1"
          style={{ fontFamily: 'Archivo, sans-serif' }}
        >
          {entry.label}
          <span className={`text-[9px] transition-transform ${isOpen ? 'rotate-180' : ''}`} aria-hidden>▾</span>
        </button>
        <div
          className={`${isOpen ? 'visible opacity-100' : 'invisible opacity-0'} transition-opacity absolute left-1/2 -translate-x-1/2 top-full pt-3 z-50`}
        >
          <div className="min-w-[230px] bg-[#141416] border border-white/10 rounded-xl shadow-[0_20px_50px_rgba(0,0,0,0.45)] py-2">
            {entry.groups.map((g, gi) => (
              <div key={g.heading ?? gi} className={gi > 0 ? 'mt-1 pt-1 border-t border-white/10' : ''}>
                {g.heading && (
                  <div className="px-3 pt-1.5 pb-1 text-[10px] font-bold uppercase tracking-[0.12em] text-[#4DB1C6]" style={{ fontFamily: 'Archivo, sans-serif' }}>
                    {g.heading}
                  </div>
                )}
                {g.items.map((it) => leaf(it, () => setOpenMenu(null)))}
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
                  <div className="px-1 pt-1 pb-0.5 text-[10px] font-bold uppercase tracking-[0.12em] text-[#4DB1C6]" style={{ fontFamily: 'Archivo, sans-serif' }}>
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
      className={`inline-flex items-center rounded-full border-[1.5px] border-[#4DB1C6] text-[#4DB1C6] hover:bg-[#4DB1C6] hover:text-[#0c0c0d] px-5 py-2 text-[12.5px] font-bold uppercase tracking-[0.08em] whitespace-nowrap transition-colors ${extra}`}
      style={{ fontFamily: 'Archivo, sans-serif' }}
    >
      {PUBLIC_ORDER_CTA.label} →
    </Link>
  )

  const searchBtn = (extra = '') => (
    <button
      type="button"
      onClick={() => setSearchOpen((v) => !v)}
      aria-label={searchOpen ? 'Close search' : 'Search equipment and vehicles'}
      aria-expanded={searchOpen}
      className={`inline-flex items-center justify-center rounded-full text-[#cfc9bd] hover:text-white hover:bg-white/10 transition-colors ${extra}`}
    >
      {searchOpen ? <CloseIcon size={18} aria-hidden /> : <Search size={18} aria-hidden />}
    </button>
  )

  // Icons + the hide-unset-profiles rule live in SocialIcons, shared with
  // the footer so the SVG paths aren't duplicated.
  const socials = (size = '') => <SocialLinks className={size} />

  return (
    <header className="sticky top-0 z-40 bg-[#0c0c0d] text-white">
      {/* ── 1. Utility row ─────────────────────────────────────── */}
      <div className="max-w-[1480px] mx-auto px-5">
        {/* Desktop: 3-column grid so the wordmark is truly centered. */}
        <div className="hidden md:grid grid-cols-[1fr_auto_1fr] items-center gap-4 py-3.5">
          <div className="flex items-center gap-4 text-[13px] text-[#a8a294]">
            <a href={PUBLIC_CONTACT.phoneHref} className="hover:text-white transition-colors whitespace-nowrap">{PUBLIC_CONTACT.phone}</a>
            <a href={PUBLIC_CONTACT.emailHref} className="hover:text-white transition-colors whitespace-nowrap">{PUBLIC_CONTACT.email}</a>
            {socials()}
          </div>
          <Link href={PUBLIC_HOME_HREF} aria-label="SirReel — Home" className="justify-self-center">
            {/* Full wordmark on desktop (same asset as the mobile branded
                band). Same h-11/h-12 as the old S badge so the bar height is
                unchanged. Mobile below keeps the slim S-mark. */}
            <Image src="/sirreel-logo-white.png" alt="SirReel Studio Services" width={1921} height={693} priority className="h-11 lg:h-12 w-auto" />
          </Link>
          <div className="justify-self-end flex items-center gap-2.5">
            <PublicCartPill />
            {orderBtn()}
          </div>
        </div>

        {/* Mobile: hamburger · wordmark · order button. 3-column grid with
            equal (1fr) side columns so the centre wordmark is truly centred
            on screen — a flex justify-between would centre it between the two
            side items instead, which are unequal widths. */}
        <div className="md:hidden grid grid-cols-[1fr_auto_1fr] items-center gap-3 py-3">
          <div className="flex items-center justify-self-start">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-label={open ? 'Close menu' : 'Open menu'}
            aria-expanded={open}
            className="w-10 h-10 -ml-2 inline-flex items-center justify-center text-white"
          >
            {open ? (
              <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
            ) : (
              <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
            )}
          </button>
          {searchBtn('w-10 h-10')}
          </div>
          <Link href={PUBLIC_HOME_HREF} aria-label="SirReel — Home" className="justify-self-center min-w-0">
            <Image src="/s-logo-white.png" alt="SirReel Studio Services" width={1118} height={1065} priority className="h-9 w-auto" />
          </Link>
          {/* One CTA cell, not two. A phone header has no room for both,
              and once there's something in the cart the pill IS the
              stronger call — it goes to the same form, at the list. */}
          <div className="justify-self-end">
            {cartUnits > 0 ? (
              <PublicCartPill size="sm" />
            ) : (
              <Link
                href={PUBLIC_ORDER_CTA.href}
                className="inline-flex items-center rounded-full border-[1.5px] border-[#4DB1C6] text-[#4DB1C6] px-3.5 py-1.5 text-[11.5px] font-bold uppercase tracking-[0.08em] whitespace-nowrap"
                style={{ fontFamily: 'Archivo, sans-serif' }}
              >
                {PUBLIC_ORDER_CTA.label} →
              </Link>
            )}
          </div>
        </div>
      </div>

      {/* ── 2. Divider ─────────────────────────────────────────── */}
      <div className="border-t border-white/10" />

      {/* ── 3. Nav row (desktop) ───────────────────────────────── */}
      <div className="hidden md:block">
        {/* 3-column grid with equal 1fr sides so the nav stays truly
            centered on screen with the search icon parked at the right —
            a flex row would push the links off-center by the icon's width. */}
        <div className="max-w-[1480px] mx-auto px-5 h-14 grid grid-cols-[1fr_auto_1fr] items-center gap-4">
          <span aria-hidden />
          <nav ref={navRef} className="flex items-center gap-8 justify-self-center" aria-label="Primary">
            {PUBLIC_NAV.map((entry) => desktopEntry(entry))}
          </nav>
          <div className="justify-self-end">{searchBtn('w-9 h-9')}</div>
        </div>
      </div>

      {/* ── 4. Search panel ────────────────────────────────────────
          Full-width under the nav, in flow rather than absolute: the
          header is sticky, so an absolute panel would float over page
          content that scrolls behind it. Rows here add straight to the
          cart (see SiteSearch) — the panel stays open after an add so a
          client can keep going, and closes on navigation or Escape. */}
      {searchOpen && (
        <div className="border-t border-white/10 bg-[#0c0c0d]">
          <div className="max-w-[760px] mx-auto px-5 py-3.5">
            <SiteSearch
              autoFocus
              size="sm"
              placeholder="Search equipment, vehicles, stages…"
              onEscape={() => setSearchOpen(false)}
            />
            <div className="mt-2 text-center text-[11px] text-white/40">
              Add what you need, then review it on the order form. No account required.
            </div>
          </div>
        </div>
      )}

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
