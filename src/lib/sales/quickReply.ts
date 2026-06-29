/**
 * Quick Reply — a fast availability-confirmation reply for inbound client
 * emails asking to hold trucks/supplies for a dated shoot, BEFORE a firm
 * quote. Availability text is generated FROM the real pooled counts
 * (getCategoryAvailability) — never asserted blindly. No quote PDF; just a
 * warm acknowledgment + per-category availability + the supply-list link +
 * a clear next step.
 */
import { getCategoryAvailability } from '@/lib/scheduling/availability'

const HOST = process.env.PORTAL_BASE_URL || 'https://tsx.sirreel.com'
export const SUPPLIES_URL = `${HOST}/order/supplies`

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
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export function composeQuickReply(args: ComposeQuickReplyArgs): { subject: string; html: string; text: string } {
  const greetName = (args.recipientName || '').trim().split(/\s+/)[0] || 'there'
  const job = args.jobName || args.clientName || 'your shoot'
  const start = fmtDate(args.pickup)
  const end = fmtDate(args.ret)
  const dateLine = start && end ? `${start} – ${end}` : start ? `starting ${start}` : 'your dates'
  const bullets = args.lines.map(lineSentence)
  const anyTight = args.lines.some((l) => l.status !== 'available')
  const note = args.personalNote?.trim()

  const t: string[] = []
  t.push(`Hi ${greetName},`, '')
  t.push(`Thanks for reaching out about ${job} — happy to help get this on the calendar.`, '')
  if (bullets.length) {
    t.push(`Here's where availability stands for ${dateLine}:`)
    for (const b of bullets) t.push(`  • ${b}`)
  } else {
    t.push(`Send over the item list whenever it's ready and I'll confirm availability line by line for ${dateLine}.`)
  }
  t.push('')
  t.push(`When you're ready, you can send your production supply list here: ${SUPPLIES_URL}`, '')
  if (note) t.push(note, '')
  t.push(
    anyTight
      ? `If you can confirm the dates and final list, I'll lock these in and send a firm quote right away.`
      : `Just say the word and I'll put a firm quote together once you confirm the dates and final supply list.`,
  )
  t.push('', `Best,`, args.agentName)
  const text = t.join('\n')

  const liHtml = bullets.map((b) => `<li style="margin:4px 0;">${esc(b)}</li>`).join('')
  const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:14px;color:#16191d;line-height:1.55;">
  <p>Hi ${esc(greetName)},</p>
  <p>Thanks for reaching out about <strong>${esc(job)}</strong> — happy to help get this on the calendar.</p>
  ${bullets.length
      ? `<p>Here's where availability stands for <strong>${esc(dateLine)}</strong>:</p><ul style="padding-left:18px;margin:8px 0;">${liHtml}</ul>`
      : `<p>Send over the item list whenever it's ready and I'll confirm availability line by line for <strong>${esc(dateLine)}</strong>.</p>`}
  <p>When you're ready, you can send your production supply list here:<br/><a href="${SUPPLIES_URL}" style="color:#b45309;font-weight:600;">${SUPPLIES_URL}</a></p>
  ${note ? `<p>${esc(note)}</p>` : ''}
  <p>${anyTight
      ? `If you can confirm the dates and final list, I'll lock these in and send a firm quote right away.`
      : `Just say the word and I'll put a firm quote together once you confirm the dates and final supply list.`}</p>
  <p>Best,<br/>${esc(args.agentName)}</p>
</div>`

  const subject = `Re: ${job} — availability for ${dateLine}`
  return { subject, html, text }
}
