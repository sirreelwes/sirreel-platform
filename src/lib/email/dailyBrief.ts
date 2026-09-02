import { prisma } from '@/lib/prisma'
import { deriveOrderWindow } from '@/lib/jobs/dateRange'
import { clientPaperworkIn } from '@/lib/orders/holdOnQuoteSend'
import { renderEmailShell, renderEmailText } from '@/lib/email/templates/shell'

/**
 * The twice-daily operations brief (Wes 2026-09-02: "letting everyone know
 * about upcoming jobs and orders ... every night and every morning ... a
 * status with links").
 *
 * Two editions off one builder, because they answer two different questions:
 *
 *   evening  — "what rolls tomorrow, and what is not ready for it?" Sent
 *              while there is still an evening to fix something.
 *   morning  — "what is happening today?" Sent as the day starts.
 *
 * Everything is DERIVED at send time. Nothing here is stored, so the brief
 * cannot drift from the board the way a cached summary would.
 */

const HQ = process.env.HQ_BASE_URL || 'https://hq.sirreel.com'
const TZ = 'America/Los_Angeles'

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif"
const INK = '#0c0c0d'
const BODY = '#3d392f'
const MUTED = '#8a8272'
const HAIRLINE = '#e2ddd0'
const GOLD = '#c39a3f'
const DANGER = '#a13d33'
const OK = '#2f6f4f'

export type BriefEdition = 'morning' | 'evening'

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Calendar day in Pacific — the day the warehouse actually works. */
function pacificDay(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d)
}

function addDays(iso: string, n: number): string {
  const d = new Date(iso + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

function longDay(iso: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  }).format(new Date(iso + 'T12:00:00Z'))
}

function shortDay(iso: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).format(new Date(iso + 'T12:00:00Z'))
}

/** A line on the brief. `blockers` is what stops it rolling, plain-worded. */
interface BriefRow {
  orderId: string
  jobId: string | null
  orderNumber: string
  status: string
  jobName: string
  companyName: string
  start: string | null
  end: string | null
  blockers: string[]
}

export interface DailyBrief {
  edition: BriefEdition
  /** The day the brief is ABOUT (today for morning, tomorrow for evening). */
  focusDay: string
  subject: string
  html: string
  text: string
  counts: { out: number; back: number; stillOut: number; blocked: number }
}

const READY_ENOUGH = new Set(['BOOKED', 'LOADED_READY', 'ON_JOB', 'RETURNED', 'LD_CHECK', 'INVOICED', 'CLOSED'])

/**
 * Why a row is not ready. Two different failures, deliberately worded as
 * the desk would say them rather than as status names:
 *   - the client has not committed (still a quote),
 *   - or they have, and WE have not finished the paperwork or booked it.
 */
async function blockersFor(row: { orderId: string; status: string }): Promise<string[]> {
  const out: string[] = []
  if (row.status === 'DRAFT') out.push('still a draft — never sent')
  else if (row.status === 'QUOTE_SENT') out.push('quote out, client has not approved')
  else if (row.status === 'APPROVED') out.push('approved but not booked')

  if (row.status !== 'DRAFT' && row.status !== 'QUOTE_SENT') {
    const paperwork = await clientPaperworkIn(row.orderId)
    if (!paperwork.ok && paperwork.missing.length) {
      out.push(`missing ${paperwork.missing.join(', ')}`)
    }
  }
  return out
}

async function gather(now: Date): Promise<{ rows: BriefRow[]; today: string }> {
  const today = pacificDay(now)
  const orders = await prisma.order.findMany({
    where: { status: { notIn: ['CANCELLED'] } },
    select: {
      id: true,
      orderNumber: true,
      status: true,
      startDate: true,
      endDate: true,
      lineItems: { select: { pickupDate: true, returnDate: true } },
      booking: { select: { startDate: true, endDate: true, status: true } },
      job: {
        select: {
          id: true,
          name: true,
          status: true,
          returnedAt: true,
          company: { select: { name: true } },
          bookings: { select: { startDate: true, endDate: true, status: true } },
        },
      },
    },
  })

  const rows: BriefRow[] = []
  for (const o of orders) {
    // A job the desk has explicitly parked or lost is not news every
    // morning until someone deletes it.
    if (o.job?.status === 'LOST' || o.job?.status === 'HOLD') continue
    const w = deriveOrderWindow(o)
    rows.push({
      orderId: o.id,
      jobId: o.job?.id ?? null,
      orderNumber: o.orderNumber,
      status: o.status,
      jobName: o.job?.name ?? o.orderNumber,
      companyName: o.job?.company?.name ?? '',
      start: w.start ? w.start.toISOString().slice(0, 10) : null,
      end: w.end ? w.end.toISOString().slice(0, 10) : null,
      blockers: [],
    })
  }
  return { rows, today }
}

function overdueLabel(r: BriefRow): string {
  if (!r.end) return 'not marked back'
  const days = Math.round(
    (Date.parse(pacificDay(new Date()) + 'T12:00:00Z') - Date.parse(r.end + 'T12:00:00Z')) / 86400000,
  )
  return days <= 0
    ? 'not marked back'
    : `${days} day${days === 1 ? '' : 's'} past its return day — not marked back`
}

function rowHtml(
  r: BriefRow,
  opts: { showWindow?: boolean; verdict?: 'blockers' | 'overdue' | 'none' } = {},
): string {
  const href = r.jobId ? `${HQ}/jobs/${r.jobId}` : `${HQ}/orders/${r.orderId}`
  const window =
    opts.showWindow && r.start
      ? `<span style="color:${MUTED};">${esc(shortDay(r.start))}${r.end && r.end !== r.start ? ` &rarr; ${esc(shortDay(r.end))}` : ''}</span>`
      : ''
  // "ready" is only meaningful where readiness was actually checked. The
  // still-out list never gets a paperwork lookup, and stamping a green
  // "ready" on a truck nobody has marked back is worse than saying nothing.
  const verdict = opts.verdict ?? 'blockers'
  const blockers =
    verdict === 'none'
      ? ''
      : verdict === 'overdue'
        ? `<div style="margin-top:3px;font-size:13px;color:${DANGER};">${esc(overdueLabel(r))}</div>`
        : r.blockers.length
          ? `<div style="margin-top:3px;font-size:13px;color:${DANGER};">${esc(r.blockers.join(' · '))}</div>`
          : `<div style="margin-top:3px;font-size:13px;color:${OK};">ready</div>`
  return `
    <tr>
      <td style="padding:11px 0;border-top:1px solid ${HAIRLINE};font-family:${FONT};">
        <a href="${href}" style="font-size:15px;font-weight:600;color:${INK};text-decoration:none;">${esc(r.jobName)}</a>
        ${r.companyName ? `<span style="font-size:14px;color:${MUTED};"> &middot; ${esc(r.companyName)}</span>` : ''}
        <div style="margin-top:2px;font-size:13px;color:${MUTED};">
          <a href="${HQ}/orders/${r.orderId}" style="color:${MUTED};text-decoration:underline;">${esc(r.orderNumber)}</a>
          &middot; ${esc(r.status.replace(/_/g, ' ').toLowerCase())}
          ${window ? `&middot; ${window}` : ''}
        </div>
        ${blockers}
      </td>
    </tr>`
}

function section(
  title: string,
  note: string,
  rows: BriefRow[],
  showWindow = false,
  verdict: 'blockers' | 'overdue' | 'none' = 'blockers',
): string {
  const head = `
    <div style="margin:26px 0 0;font-family:${FONT};">
      <span style="font-size:12px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:${GOLD};">${esc(title)}</span>
      <span style="font-size:12px;color:${MUTED};margin-left:8px;">${esc(note)}</span>
    </div>`
  if (rows.length === 0) {
    return `${head}<div style="margin-top:8px;font-family:${FONT};font-size:14px;color:${MUTED};">Nothing.</div>`
  }
  return `${head}<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">${rows
    .map((r) => rowHtml(r, { showWindow, verdict }))
    .join('')}</table>`
}

function textSection(title: string, rows: BriefRow[]): string[] {
  if (rows.length === 0) return [title.toUpperCase(), '  Nothing.', '']
  return [
    title.toUpperCase(),
    ...rows.map(
      (r) =>
        `  ${r.jobName}${r.companyName ? ` (${r.companyName})` : ''} — ${r.orderNumber}, ${r.status
          .replace(/_/g, ' ')
          .toLowerCase()}${r.blockers.length ? ` — ${r.blockers.join('; ')}` : ' — ready'}\n    ${
          r.jobId ? `${HQ}/jobs/${r.jobId}` : `${HQ}/orders/${r.orderId}`
        }`,
    ),
    '',
  ]
}

export async function buildDailyBrief(
  edition: BriefEdition,
  now: Date = new Date(),
): Promise<DailyBrief> {
  const { rows, today } = await gather(now)
  const focusDay = edition === 'evening' ? addDays(today, 1) : today

  const goingOut = rows.filter((r) => r.start === focusDay)
  const comingBack = rows.filter((r) => r.end === focusDay && r.start !== focusDay)
  // Past its return day and nobody has marked it back. This is the list
  // that quietly grows: 16 of them on the day this was built.
  const stillOut = rows.filter(
    (r) => r.end !== null && r.end < today && READY_ENOUGH.has(r.status) && r.status !== 'CLOSED',
  )

  // Only the rows that roll on the focus day get a paperwork lookup —
  // one DB round trip each, and the brief should stay cheap.
  for (const r of [...goingOut, ...comingBack]) {
    r.blockers = await blockersFor(r)
  }
  const blocked = goingOut.filter((r) => r.blockers.length > 0)

  // The rest of the week, so a job that needs paperwork is visible days
  // out rather than the evening before it rolls.
  const weekEnd = addDays(focusDay, 7)
  const ahead = rows
    .filter((r) => r.start !== null && r.start > focusDay && r.start <= weekEnd)
    .sort((a, b) => (a.start! < b.start! ? -1 : 1))

  const dayLabel = longDay(focusDay)
  const lead =
    edition === 'evening'
      ? `Tomorrow &mdash; ${esc(dayLabel)}`
      : `Today &mdash; ${esc(dayLabel)}`

  const headline =
    goingOut.length === 0 && comingBack.length === 0
      ? 'Nothing scheduled to move.'
      : `${goingOut.length} going out, ${comingBack.length} coming back.` +
        (blocked.length ? ` ${blocked.length} not ready.` : '')

  const bodyHtml = `
    <p style="margin:0 0 4px;font-family:${FONT};font-size:15px;line-height:1.6;color:${BODY};">${headline}</p>
    ${section('Going out', `${goingOut.length} on ${shortDay(focusDay)}`, goingOut)}
    ${section('Coming back', `${comingBack.length} on ${shortDay(focusDay)}`, comingBack)}
    ${section('Later this week', `${ahead.length} in the next 7 days`, ahead, true, 'none')}
    ${section('Still out', `${stillOut.length} past their return day, not marked back`, stillOut, true, 'overdue')}
    <div style="margin:28px 0 0;font-family:${FONT};font-size:13px;">
      <a href="${HQ}/jobs" style="color:${GOLD};font-weight:600;text-decoration:none;">Open the board &rarr;</a>
    </div>`

  const html = renderEmailShell({
    eyebrow: edition === 'evening' ? 'Nightly brief' : 'Morning brief',
    heading: lead.replace('&mdash;', '—'),
    preheader: headline.replace(/&[a-z]+;/g, ''),
    bodyHtml,
  })

  const text = renderEmailText([
    (edition === 'evening' ? 'NIGHTLY BRIEF — TOMORROW, ' : 'MORNING BRIEF — TODAY, ') +
      dayLabel.toUpperCase(),
    '',
    headline,
    '',
    ...textSection(`Going out (${goingOut.length})`, goingOut),
    ...textSection(`Coming back (${comingBack.length})`, comingBack),
    ...textSection(`Later this week (${ahead.length})`, ahead),
    ...textSection(`Still out (${stillOut.length})`, stillOut),
    `Open the board: ${HQ}/jobs`,
  ])

  return {
    edition,
    focusDay,
    subject:
      edition === 'evening'
        ? `Tomorrow at SirReel — ${shortDay(focusDay)}: ${goingOut.length} out, ${comingBack.length} back`
        : `Today at SirReel — ${shortDay(focusDay)}: ${goingOut.length} out, ${comingBack.length} back`,
    html,
    text,
    counts: {
      out: goingOut.length,
      back: comingBack.length,
      stillOut: stillOut.length,
      blocked: blocked.length,
    },
  }
}
