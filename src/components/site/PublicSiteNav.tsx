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
} from '@/lib/site/publicNav'

/**
 * Public-site header — Cinelease-structure shell (2026-07-06):
 *
 *   1. Thin dark utility bar: phone + email (left).
 *   2. Dark header with the SirReel WORDMARK centered, linking to Home.
 *   3. Centered nav row beneath the logo (data-driven by publicNav.ts),
 *      with a gold-outline "Start an Order" button pinned right. On
 *      mobile the logo stays centered, nav collapses to a hamburger,
 *      and the order button persists.
 *
 * Non-live items render visibly but non-clickable ("coming soon"),
 * matching the registry's `live: false` contract.
 */
export function PublicSiteNav() {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)

  const isActive = (href: string) => {
    const base = href.split('#')[0]
    if (base === '/home') return pathname === '/home'
    return pathname === base || pathname.startsWith(base + '/')
  }

  const navLink = (item: (typeof PUBLIC_NAV)[number], onClick?: () => void) => {
    if (!item.live) {
      return (
        <span
          key={item.label}
          aria-disabled="true"
          title="Coming soon"
          className="text-[13px] font-semibold uppercase tracking-[0.08em] text-[#6d685e] cursor-not-allowed select-none whitespace-nowrap"
          style={{ fontFamily: 'Archivo, sans-serif' }}
        >
          {item.label}
        </span>
      )
    }
    const active = isActive(item.href)
    return (
      <Link
        key={item.label}
        href={item.href}
        onClick={onClick}
        aria-current={active ? 'page' : undefined}
        className={`text-[13px] font-semibold uppercase tracking-[0.08em] whitespace-nowrap transition-colors ${
          active ? 'text-[#c39a3f]' : 'text-[#cfc9bd] hover:text-white'
        }`}
        style={{ fontFamily: 'Archivo, sans-serif' }}
      >
        {item.label}
      </Link>
    )
  }

  return (
    <header className="sticky top-0 z-40 bg-[#0c0c0d] text-white">
      {/* 1. Utility bar */}
      <div className="border-b border-white/10">
        <div className="max-w-[1480px] mx-auto px-5 h-9 flex items-center gap-5 text-[12px] text-[#a8a294]">
          <a href={PUBLIC_CONTACT.phoneHref} className="hover:text-white transition-colors whitespace-nowrap">
            {PUBLIC_CONTACT.phone}
          </a>
          <a href={PUBLIC_CONTACT.emailHref} className="hover:text-white transition-colors whitespace-nowrap">
            {PUBLIC_CONTACT.email}
          </a>
        </div>
      </div>

      {/* 2. Centered wordmark */}
      <div className="max-w-[1480px] mx-auto px-5 pt-7 pb-5 flex justify-center">
        <Link href={PUBLIC_HOME_HREF} aria-label="SirReel — Home" className="inline-block">
          <Image
            src="/sirreel-logo-white.png"
            alt="SirReel Studio Services"
            width={520}
            height={137}
            priority
            className="h-11 sm:h-14 w-auto"
          />
        </Link>
      </div>

      {/* 3. Nav row */}
      <div className="border-t border-white/10">
        <div className="max-w-[1480px] mx-auto px-5 h-14 flex items-center">
          {/* Desktop: centered links + right-pinned order button. The
              left spacer balances the order button so the links sit
              truly centered. */}
          <div className="hidden md:grid grid-cols-[1fr_auto_1fr] items-center w-full">
            <span />
            <nav className="flex items-center justify-center gap-7" aria-label="Primary">
              {PUBLIC_NAV.map((item) => navLink(item))}
            </nav>
            <div className="flex justify-end">
              <Link
                href={PUBLIC_ORDER_CTA.href}
                className="inline-flex items-center rounded-full border-[1.5px] border-[#c39a3f] text-[#c39a3f] hover:bg-[#c39a3f] hover:text-[#0c0c0d] px-5 py-2 text-[12.5px] font-bold uppercase tracking-[0.08em] whitespace-nowrap transition-colors"
                style={{ fontFamily: 'Archivo, sans-serif' }}
              >
                {PUBLIC_ORDER_CTA.label}
              </Link>
            </div>
          </div>

          {/* Mobile: hamburger left, order button right */}
          <div className="md:hidden flex items-center justify-between w-full">
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              aria-label={open ? 'Close menu' : 'Open menu'}
              aria-expanded={open}
              className="w-10 h-10 -ml-2 inline-flex items-center justify-center text-white"
            >
              {open ? (
                <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round">
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              ) : (
                <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round">
                  <path d="M4 7h16M4 12h16M4 17h16" />
                </svg>
              )}
            </button>
            <Link
              href={PUBLIC_ORDER_CTA.href}
              className="inline-flex items-center rounded-full border-[1.5px] border-[#c39a3f] text-[#c39a3f] px-4 py-2 text-[12px] font-bold uppercase tracking-[0.08em] whitespace-nowrap"
              style={{ fontFamily: 'Archivo, sans-serif' }}
            >
              {PUBLIC_ORDER_CTA.label}
            </Link>
          </div>
        </div>

        {/* Mobile dropdown panel */}
        {open && (
          <div className="md:hidden border-t border-white/10 bg-[#0c0c0d]">
            <nav className="max-w-[1480px] mx-auto px-5 py-4 flex flex-col gap-4" aria-label="Primary mobile">
              {PUBLIC_NAV.map((item) => navLink(item, () => setOpen(false)))}
            </nav>
          </div>
        )}
      </div>
    </header>
  )
}
