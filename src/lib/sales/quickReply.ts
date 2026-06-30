/**
 * Quick Reply — a fast availability-confirmation reply for inbound client
 * emails asking to hold trucks/supplies for a dated shoot, BEFORE a firm
 * quote. Availability text is generated FROM the real pooled counts
 * (getCategoryAvailability) — never asserted blindly. No quote PDF; just a
 * warm acknowledgment + per-category availability + the supply-list link +
 * a clear next step.
 */
import { getCategoryAvailability } from '@/lib/scheduling/availability'
import { buildTsxWelcomeEmail } from '@/lib/email/templates/tsxWelcomeTemplate'
import { SUPPLY_ORDER_URL } from '@/lib/email/supplyUrl'

// Re-exported for back-compat with existing importers; the canonical home is
// src/lib/email/supplyUrl.ts (orders.sirreel.com).
export const SUPPLIES_URL = SUPPLY_ORDER_URL

export interface QuickReplyCategoryInput {
  id: string
  name: string
  quantity: number
}

export interface QuickReplyLine {
  id: string
  name: string
  requested: number
  availableToHold: number
  serviceableCount: number
  status: 'available' | 'tight' | 'short'
}

function toDate(iso?: string | null): Date | null {
  if (!iso || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return null
  const d = new Date(`${iso.slice(0, 10)}T00:00:00.000Z`)
  return Number.isNaN(d.getTime()) ? null : d
}

/** Per-category availability for the requested window, from the real engine. */
export async function computeQuickReplyAvailability(
  categories: QuickReplyCategoryInput[],
  pickup?: string | null,
  ret?: string | null,
): Promise<QuickReplyLine[]> {
  const start = toDate(pickup)
  const end = toDate(ret)
  const lines: QuickReplyLine[] = []
  for (const c of categories) {
    let availableToHold = 0
    let serviceableCount = 0
    if (start && end) {
      const a = await getCategoryAvailability(c.id, start, end, 1)
      availableToHold = Math.max(0, a.availableToHold)
      serviceableCount = a.serviceableCount
    }
    const requested = Math.max(1, Math.floor(c.quantity || 1))
    const status: QuickReplyLine['status'] =
      availableToHold >= requested ? 'available' : availableToHold <= 0 ? 'short' : 'tight'
    lines.push({ id: c.id, name: c.name, requested, availableToHold, serviceableCount, status })
  }
  return lines
}

function fmtDate(iso?: string | null): string | null {
  const d = toDate(iso ?? null)
  if (!d) return null
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
}

function lineSentence(l: QuickReplyLine): string {
  const q = l.requested
  if (l.status === 'available') return `${l.name} (${q}) — yes, we have those open for your dates.`
  if (l.status === 'tight') return `${l.name} (${q}) — we can cover ${l.availableToHold} of the ${q} right now; let's lock these in soon, they're tight for these dates.`
  return `${l.name} (${q}) — these are fully spoken for on your dates; I can suggest alternatives or a nearby window.`
}

export interface ComposeQuickReplyArgs {
  recipientName?: string | null
  clientName?: string | null
  jobName?: string | null
  pickup?: string | null
  ret?: string | null
  lines: QuickReplyLine[]
  agentName: string
  personalNote?: string | null
  /** Fold a request for the production company + project name into the reply. */
  askForDetails?: boolean
  /** Rep's own message — replaces the templated prose; the branded shell, the
   *  real availability block + supply CTA, and the sign-off stay intact. */
  customMessage?: string | null
}

export function composeQuickReply(args: ComposeQuickReplyArgs): { subject: string; html: string; text: string } {
  const job = args.jobName || args.clientName || 'your shoot'
  const start = fmtDate(args.pickup)
  const end = fmtDate(args.ret)
  const dateLine = start && end ? `${start} – ${end}` : start ? `starting ${start}` : 'your dates'
  const lines = args.lines.map(lineSentence)
  const anyTight = args.lines.some((l) => l.status !== 'available')
  const nextStep = anyTight
    ? `If you can confirm the dates and final list, I'll lock these in and send a firm quote right away.`
    : `Just say the word and I'll put a firm quote together once you confirm the dates and final supply list.`

  // Reuse Send Quote's branded shell (buildTsxWelcomeEmail) in 'availability'
  // mode — one template, both flows. The supply link renders as a styled
  // button inside the shell; the plain-English availability lines + next-step
  // are preserved.
  return buildTsxWelcomeEmail({
    mode: 'availability',
    clientFirstName: args.recipientName ?? null,
    clientFullName: args.recipientName ?? null,
    agentName: args.agentName,
    agentEmail: '',
    agentPhone: null,
    personalNote: args.personalNote ?? null,
    quote: null,
    // Ask only for the field(s) we actually lack (computed from the current,
    // possibly rep-typed, values) — never ask for a company/job we already have.
    availability: {
      jobName: job,
      dateRange: dateLine,
      lines,
      suppliesUrl: SUPPLY_ORDER_URL,
      nextStep,
      askForCompany: !!args.askForDetails && !args.clientName?.trim(),
      askForJob: !!args.askForDetails && !args.jobName?.trim(),
      customBody: args.customMessage ?? null,
    },
  })
}
