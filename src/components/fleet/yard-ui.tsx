/**
 * The yard screens' shared chrome — /fleet/inspection, /fleet/pickup,
 * /fleet/return, and the driver's own check-out card.
 *
 * These are phone screens read standing next to a truck, often before
 * dawn. They live OUTSIDE the (dashboard) shell on purpose and paint
 * their own opaque dark ground (zinc-950), which is the one place dark
 * styling is legal in HQ (see CLAUDE.md UI conventions). Everything
 * here follows the yard rule: names ~16px, detail ~13px, 48px targets.
 *
 * 2026-09-07 (Wes: "restyle them too"): the three screens each carried
 * their own copy of a header, a shell, an access-denied card and a
 * "done" card, none quite matching. One kit, three screens. The header
 * is a licence-plate tile — the unit number is the one thing a tech
 * checks against the truck in front of them, so it is the biggest
 * thing on the screen — plus a three-step strip that says where in
 * the vehicle's arc (walk-around → handover → return) this screen is.
 *
 * Server-safe: no hooks, no handlers. Interactive controls live in
 * YardControls.tsx.
 */

import Link from 'next/link'
import type { ReactNode } from 'react'
import { ArrowLeft, Lock, type LucideIcon } from 'lucide-react'

// ── Formatting ───────────────────────────────────────────────────────

/** A @db.Date (calendar day) → "Sat, Sep 6". UTC on purpose: formatting
 *  a date-only column in local time prints the day before. */
export function fmtYardDay(d: Date | string): string {
  const date = typeof d === 'string' ? new Date(d.length === 10 ? `${d}T00:00:00Z` : d) : d
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })
}

/** A real instant → "Sep 6 · 7:49 PM", on the yard's clock. */
export function fmtYardWhen(d: Date | string): string {
  const date = typeof d === 'string' ? new Date(d) : d
  if (Number.isNaN(date.getTime())) return '—'
  const day = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/Los_Angeles' })
  const time = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Los_Angeles' })
  return `${day} · ${time}`
}

// ── Shell ────────────────────────────────────────────────────────────

/**
 * Full-height dark ground with a single phone-width column. `padBottom`
 * leaves room for a StickyBar so the last field is never under it.
 */
export function YardShell({ children, padBottom = true }: { children: ReactNode; padBottom?: boolean }) {
  return (
    <main className={`min-h-screen bg-zinc-950 text-zinc-100 px-4 pt-4 ${padBottom ? 'pb-32' : 'pb-10'}`}>
      <div className="max-w-md mx-auto">{children}</div>
    </main>
  )
}

/** Centered message on the dark ground — access denied, not found. */
export function YardNotice({
  icon: Icon = Lock,
  title,
  children,
}: {
  icon?: LucideIcon
  title: string
  children?: ReactNode
}) {
  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100 flex items-center justify-center p-6">
      <div className="max-w-sm text-center">
        <Icon size={32} aria-hidden className="mx-auto mb-3 text-zinc-500" />
        <h1 className="text-white text-[18px] font-semibold mb-2">{title}</h1>
        {children && <div className="text-zinc-400 text-[14px] leading-relaxed">{children}</div>}
      </div>
    </main>
  )
}

// ── Header ───────────────────────────────────────────────────────────

export type YardStep = 'inspection' | 'pickup' | 'return'

const STEPS: { id: YardStep; label: string }[] = [
  { id: 'inspection', label: 'Walk-around' },
  { id: 'pickup', label: 'Handover' },
  { id: 'return', label: 'Return' },
]

export interface YardVehicle {
  unitName: string
  /** The category name, or the Prisma relation as selected — pages pass
   *  the asset row straight through. */
  category: string | { name: string }
  make?: string | null
  model?: string | null
  licensePlate?: string | null
}

export interface YardBooking {
  jobName: string
  company?: string | null
  bookingNumber: string
}

export function YardHeader({
  step,
  eyebrow,
  vehicle,
  booking,
  dateLabel,
  date,
  backHref = '/yard',
  backLabel = 'Today',
}: {
  step: YardStep
  /** What this screen is, in the tech's words: "Pre-rental inspection". */
  eyebrow: string
  vehicle: YardVehicle
  booking: YardBooking
  /** "Out" / "Due back" */
  dateLabel: string
  date: Date | string
  backHref?: string | null
  backLabel?: string
}) {
  const makeModel = [vehicle.make, vehicle.model].filter(Boolean).join(' ')
  const category = typeof vehicle.category === 'string' ? vehicle.category : vehicle.category.name
  const detail = [category, makeModel || null, vehicle.licensePlate || null].filter(Boolean)
  const stepIndex = STEPS.findIndex((s) => s.id === step)

  return (
    <header className="mb-5">
      <div className="flex items-center justify-between gap-3 mb-4">
        {backHref ? (
          <Link
            href={backHref}
            className="inline-flex items-center gap-1.5 min-h-[44px] -ml-1 px-1 text-zinc-400 text-[14px] active:text-white"
          >
            <ArrowLeft size={16} aria-hidden />
            {backLabel}
          </Link>
        ) : (
          <span />
        )}
        {/* Where in the arc this screen sits. Not navigation — the
            other two steps have their own entry points — just bearings. */}
        <ol className="flex items-center gap-1.5" aria-label="Vehicle steps">
          {STEPS.map((s, i) => {
            const state = i < stepIndex ? 'done' : i === stepIndex ? 'now' : 'next'
            return (
              <li key={s.id} className="flex items-center gap-1.5">
                <span
                  aria-current={state === 'now' ? 'step' : undefined}
                  className={`text-[11px] font-semibold uppercase tracking-wide px-2 py-1 rounded-full ${
                    state === 'now'
                      ? 'bg-amber-600 text-white'
                      : state === 'done'
                        ? 'text-amber-400'
                        : 'text-zinc-600'
                  }`}
                >
                  {s.label}
                </span>
                {i < STEPS.length - 1 && <span className="text-zinc-700 text-[10px]" aria-hidden>›</span>}
              </li>
            )
          })}
        </ol>
      </div>

      <div className="flex items-stretch gap-3">
        {/* The plate. The unit number is what the tech checks against
            the truck, so it is the largest thing on the screen. */}
        <div className="flex-none min-w-[88px] rounded-2xl border-2 border-zinc-700 bg-zinc-900 px-3 py-2 flex flex-col items-center justify-center">
          <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500">Unit</span>
          <span className="text-[30px] leading-none font-bold text-white tabular-nums mt-0.5">{vehicle.unitName}</span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-amber-400 text-[11px] font-bold uppercase tracking-[0.15em]">{eyebrow}</div>
          <h1 className="text-white text-[17px] font-semibold leading-snug mt-1 truncate">{booking.jobName}</h1>
          <p className="text-zinc-400 text-[13px] mt-0.5 truncate">
            {booking.company ?? '—'} · {booking.bookingNumber}
          </p>
          <p className="text-zinc-500 text-[13px] mt-0.5 truncate">{detail.join(' · ')}</p>
        </div>
      </div>

      <div className="mt-3 flex items-center gap-2 text-[13px]">
        <span className="text-zinc-500">{dateLabel}</span>
        <span className="text-zinc-200 font-medium">{fmtYardDay(date)}</span>
      </div>
    </header>
  )
}

// ── Cards & sections ─────────────────────────────────────────────────

export function YardCard({
  children,
  className = '',
  tone = 'default',
}: {
  children: ReactNode
  className?: string
  tone?: 'default' | 'warn' | 'good' | 'bad' | 'info'
}) {
  const tones = {
    default: 'border-zinc-800 bg-zinc-900',
    info: 'border-amber-800/60 bg-amber-950/30',
    warn: 'border-yellow-800/60 bg-yellow-950/25',
    good: 'border-emerald-800/60 bg-emerald-950/30',
    bad: 'border-rose-800/60 bg-rose-950/30',
  }
  return <section className={`rounded-2xl border p-4 ${tones[tone]} ${className}`}>{children}</section>
}

/** Section title row: name at 16px, an optional right-hand status. */
export function YardSectionTitle({
  children,
  aside,
  hint,
}: {
  children: ReactNode
  aside?: ReactNode
  hint?: ReactNode
}) {
  return (
    <div className="mb-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-white text-[16px] font-semibold">{children}</h2>
        {aside && <div className="text-[13px] text-zinc-400 flex-none">{aside}</div>}
      </div>
      {hint && <p className="text-zinc-500 text-[13px] mt-0.5">{hint}</p>}
    </div>
  )
}

/** A label/value pair inside a card — "Fuel · Full". */
export function YardStat({ label, value, tone }: { label: string; value: ReactNode; tone?: 'warn' | 'bad' }) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">{label}</div>
      <div
        className={`text-[16px] font-semibold mt-0.5 truncate ${
          tone === 'bad' ? 'text-rose-300' : tone === 'warn' ? 'text-yellow-300' : 'text-white'
        }`}
      >
        {value}
      </div>
    </div>
  )
}

/** The end state of a screen: what happened, and the next step. */
export function YardOutcome({
  icon: Icon,
  tone = 'good',
  title,
  children,
  actions,
}: {
  icon: LucideIcon
  tone?: 'good' | 'warn' | 'neutral'
  title: string
  children?: ReactNode
  actions?: ReactNode
}) {
  const iconTone = tone === 'good' ? 'text-emerald-400' : tone === 'warn' ? 'text-yellow-400' : 'text-zinc-400'
  const cardTone = tone === 'good' ? 'good' : tone === 'warn' ? 'warn' : 'default'
  return (
    <YardCard tone={cardTone} className="text-center py-6">
      <Icon size={34} aria-hidden className={`mx-auto mb-3 ${iconTone}`} />
      <p className="text-white text-[18px] font-semibold">{title}</p>
      {children && <div className="text-zinc-300 text-[14px] leading-relaxed mt-2 space-y-1.5">{children}</div>}
      {actions && <div className="mt-5 flex flex-col items-center gap-3">{actions}</div>}
    </YardCard>
  )
}

/** Primary / secondary link buttons for outcomes and blockers. */
export const yardBtnPrimary =
  'inline-flex items-center justify-center gap-1.5 min-h-[48px] rounded-xl bg-amber-600 px-5 text-[15px] font-semibold text-white active:bg-amber-500'
export const yardBtnSecondary =
  'inline-flex items-center justify-center gap-1.5 min-h-[44px] rounded-xl border border-zinc-700 bg-zinc-900 px-4 text-[14px] font-medium text-zinc-200 active:bg-zinc-800'
export const yardBtnLink = 'inline-flex items-center gap-1.5 min-h-[44px] text-[13px] text-zinc-400 active:text-white'
