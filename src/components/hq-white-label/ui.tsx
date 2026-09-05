/**
 * The white-label HQ's small visual vocabulary. Deliberately NOT the
 * SirReel staff tokens (lt-*, chip-*, amber CTAs) — a tenant's HQ wears
 * their accent (the --hq-accent variable the shell sets) on a neutral
 * ground, and nothing that reads as SirReel.
 */
import Link from 'next/link'
import type { HqBookingStatus } from '@/lib/hq-white-label/data'

export const PAGE = 'max-w-[1080px] mx-auto px-4 sm:px-6 py-6'
export const CARD = 'bg-white border border-[#e3e6ea] rounded-xl'
export const H1 = 'text-[22px] sm:text-[26px] font-bold tracking-tight text-[#111827]'
export const H2 = 'text-[11px] font-bold uppercase tracking-[1.6px] text-[#6b7280]'
export const MUTED = 'text-[13px] text-[#6b7280]'
export const BTN = 'inline-flex items-center justify-center gap-1.5 rounded-lg px-3.5 py-2 text-[14px] font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed'
export const BTN_PRIMARY = `${BTN} text-white bg-[var(--hq-accent)] hover:opacity-90`
export const BTN_SECONDARY = `${BTN} text-[#111827] bg-white border border-[#d5d9de] hover:bg-[#f5f6f8]`
export const BTN_DANGER = `${BTN} text-[#991b1b] bg-white border border-[#f2c9c9] hover:bg-[#fff5f5]`
export const INPUT = 'w-full rounded-lg border border-[#d5d9de] bg-white px-3 py-2 text-[15px] text-[#111827] placeholder:text-[#9ca3af] focus:outline-none focus:ring-2 focus:ring-[var(--hq-accent)]/30 focus:border-[var(--hq-accent)]'
export const LABEL = 'block text-[12px] font-semibold text-[#4b5563] mb-1'

const STATUS: Record<HqBookingStatus, { label: string; cls: string }> = {
  QUOTED: { label: 'Quoted', cls: 'bg-[#f3f0ff] text-[#5b3fa6]' },
  HOLD: { label: 'Hold', cls: 'bg-[#fff7e0] text-[#8a6100]' },
  CONFIRMED: { label: 'Confirmed', cls: 'bg-[#e6f4ec] text-[#1f6b45]' },
  OUT: { label: 'Out', cls: 'bg-[#e3effc] text-[#1d4f8f]' },
  RETURNED: { label: 'Returned', cls: 'bg-[#eef0f3] text-[#4b5563]' },
  CANCELLED: { label: 'Cancelled', cls: 'bg-[#eef0f3] text-[#6b7280] line-through' },
}

export function StatusChip({ status }: { status: HqBookingStatus }) {
  const s = STATUS[status]
  return <span className={`inline-block rounded-md px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide ${s.cls}`}>{s.label}</span>
}

export function statusLabel(status: HqBookingStatus): string {
  return STATUS[status].label
}

export function SourceChip({ source }: { source: 'direct' | 'partner' }) {
  if (source === 'direct') return null
  return <span className="inline-block rounded-md px-2 py-0.5 text-[11px] font-semibold bg-[#f5f6f8] text-[#4b5563] border border-[#e3e6ea]">from SirReel</span>
}

export function NeedsChip({ text }: { text: string }) {
  return <span className="inline-block rounded-md px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide bg-[#fff7e0] text-[#8a6100]">{text}</span>
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <div className={`${CARD} px-5 py-8 text-center text-[14px] text-[#6b7280]`}>{children}</div>
}

export function PageHead({ title, sub, action }: { title: string; sub?: string; action?: { href: string; label: string } }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3 mb-5">
      <div>
        <h1 className={H1}>{title}</h1>
        {sub && <p className={`${MUTED} mt-1 max-w-[64ch]`}>{sub}</p>}
      </div>
      {action && (
        <Link href={action.href} className={BTN_PRIMARY}>
          {action.label}
        </Link>
      )}
    </div>
  )
}
