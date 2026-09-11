'use client'

/**
 * The job portal's chrome — masthead, identity band, footer — shared by
 * /portal/job/[slug] and its sub-pages (sign/rental, sign/stage, lcdw,
 * after-hours).
 *
 * Wes 2026-09-11: "the client-facing job page — match the company portal
 * … do the sign, lcdw and after-hours pages too." The masthead and band
 * are CompanyPortalView's, verbatim: their mark left | our wordmark right
 * on a white plate, then a thin dark row with the person and the show.
 * One component so the five pages cannot drift from each other, or from
 * the account portal, the way the old per-page dark heroes did.
 *
 * Nothing here fetches. Every page already loads /api/portal/job/data
 * (or, for after-hours, its own route now carries the same facts) —
 * `chromeFromPortalData` lifts what the chrome needs out of that payload.
 */

import type { ReactNode } from 'react'
import { PORTAL } from '@/lib/brand/portalTokens'

export interface JobPortalChromeData {
  company: { name: string; hasLogo: boolean }
  contact: { firstName: string; lastName: string; email: string } | null
  /** The show — Job.name, else the order number. */
  headline: string
  /** Job code, else the order number. */
  code: string
  rep: { name: string; email: string } | null
  afterHoursLine: string
}

/** Lift the chrome facts out of a /api/portal/job/data payload. Tolerant
 *  of a partial one (a sub-page that only kept what it needed). */
export function chromeFromPortalData(d: any): JobPortalChromeData {
  return {
    company: {
      name: d?.company?.name ?? '',
      hasLogo: !!d?.company?.hasLogo,
    },
    contact: d?.contact
      ? { firstName: d.contact.firstName ?? '', lastName: d.contact.lastName ?? '', email: d.contact.email ?? '' }
      : null,
    headline: d?.job?.name || d?.order?.orderNumber || '',
    code: d?.job?.jobCode || d?.order?.orderNumber || '',
    rep: d?.agent?.email ? { name: d.agent.name || d.agent.email, email: d.agent.email } : null,
    afterHoursLine: d?.afterHoursLine || '(888) 477-7335',
  }
}

/** The account portal's section kicker. */
export function JobPortalKicker({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <h2 className={`text-[11px] uppercase font-semibold tracking-[1.6px] text-zinc-500 ${className}`}>{children}</h2>
  )
}

export function JobPortalShell({
  chrome,
  width = 'wide',
  children,
}: {
  /** Null while the page is still loading — the masthead then carries our
   *  wordmark alone and the band stays empty, so the shell never flashes
   *  a wrong name. */
  chrome: JobPortalChromeData | null
  /** 'wide' is the job page's 5xl column; 'narrow' the 3xl reading column
   *  the agreement and waiver pages use. */
  width?: 'wide' | 'narrow'
  children: ReactNode
}) {
  const mainCls =
    width === 'wide' ? 'max-w-5xl mx-auto px-6 py-8 space-y-10' : 'max-w-3xl mx-auto px-6 py-8 space-y-6'
  const person = chrome?.contact ? `${chrome.contact.firstName} ${chrome.contact.lastName}`.trim() : ''

  return (
    <div className="min-h-screen bg-[#F8F7F4]">
      {/* ── Masthead ───────────────────────────────────────────────── */}
      <div className="w-full bg-white border-b border-zinc-200">
        <div className="max-w-5xl mx-auto px-6 py-5 grid grid-cols-[1fr_auto_1fr] items-center gap-5">
          <div className="min-w-0 flex justify-start">
            {chrome?.company.hasLogo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src="/api/portal/job/company-logo"
                alt={chrome.company.name}
                className="block h-6 sm:h-[29px] w-auto max-w-[38vw] sm:max-w-[220px] object-contain object-left"
              />
            ) : (
              <span className="font-display text-[24px] leading-none text-zinc-900 tracking-tight truncate">
                {chrome?.company.name ?? ''}
              </span>
            )}
          </div>
          <span className="block w-px h-9 bg-zinc-300" aria-hidden />
          <div className="min-w-0 flex justify-end">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/sirreel-logo.png"
              alt="SirReel"
              className="block h-8 sm:h-10 w-auto max-w-[38vw] sm:max-w-[220px] object-contain object-right"
            />
          </div>
        </div>
      </div>

      {/* ── Who's here, for which show ─────────────────────────────── */}
      <header className="w-full" style={{ backgroundColor: PORTAL.dark }}>
        <div className="max-w-5xl mx-auto px-6 py-3 flex items-center justify-between gap-4 min-h-[42px]">
          <div className="min-w-0 text-[13px] text-white/85 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            {person && (
              <>
                <span className="font-semibold text-white">{person}</span>
                <span className="text-white/40 hidden sm:inline">·</span>
                <span className="truncate max-w-full">{chrome?.contact?.email}</span>
                <span className="text-white/40 hidden sm:inline">·</span>
              </>
            )}
            {chrome?.headline && <span style={{ color: PORTAL.gold }}>{chrome.headline}</span>}
          </div>
          {chrome?.code && <span className="shrink-0 text-[11px] font-mono text-white/45">{chrome.code}</span>}
        </div>
      </header>

      <main className={mainCls}>{children}</main>

      {/* ── Footer — the account portal's one line ──────────────────── */}
      <footer className="max-w-5xl mx-auto px-6 pb-10 text-xs text-zinc-400">
        Questions about this job?{' '}
        {chrome?.rep ? (
          <a href={`mailto:${chrome.rep.email}`} className="underline text-zinc-600">
            {chrome.rep.name}
          </a>
        ) : (
          <a href="mailto:info@sirreel.com" className="underline text-zinc-600">
            info@sirreel.com
          </a>
        )}{' '}
        · After-hours{' '}
        <a href={`tel:${chrome?.afterHoursLine ?? '(888) 477-7335'}`} className="underline text-zinc-600">
          {chrome?.afterHoursLine ?? '(888) 477-7335'}
        </a>{' '}
        · SirReel Studio Services, 8500 Lankershim Blvd, Sun Valley, CA 91352
      </footer>
    </div>
  )
}
