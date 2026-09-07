/**
 * Text-message threads — one per phone number — and the rules around them.
 *
 * Built 2026-09-07 (Wes: "build the thread store and webhook") so the
 * after-hours assistant can answer texts the way it answers web chat. SMS
 * has no browser to hold history, so the thread IS the conversation: the
 * last 24 hours of turns, capped, are what the model sees.
 *
 * Consent is carrier-grade and lives on the thread:
 *   - STOP / END / CANCEL / UNSUBSCRIBE / QUIT → optedOutAt. Nothing texts
 *     the number again, automated or human, until START.
 *   - START / YES / UNSTOP → optedInAt, optedInVia 'keyword'.
 *   - HELP / INFO → the help line; no state change.
 * Keywords are handled BEFORE anything reaches the model, and their replies
 * are fixed strings that match what was filed with the carrier campaign.
 *
 * Outbound goes through sendTracked() so every text is a row with the
 * Twilio id the status webhook can update — the same discipline as
 * EmailDelivery. Automated sends respect quiet hours (9pm–6am Pacific);
 * a human pressing send does not.
 */
import { prisma } from '@/lib/prisma'
import { sendSms, toE164 } from '@/lib/sms/sendSms'
import { PUBLIC_CONTACT } from '@/lib/site/publicNav'

/** Turns older than this are not shown to the model. */
const IDLE_WINDOW_MS = 24 * 60 * 60 * 1000
/** Most recent turns the model sees, after the window. */
const MAX_TURNS = 30

export const OPT_OUT_KEYWORDS = ['STOP', 'END', 'CANCEL', 'UNSUBSCRIBE', 'QUIT', 'STOPALL']
export const OPT_IN_KEYWORDS = ['START', 'YES', 'UNSTOP']
export const HELP_KEYWORDS = ['HELP', 'INFO']

/** Fixed replies — these match the campaign registration filed with Twilio. */
export const KEYWORD_REPLIES = {
  optIn: `SirReel Studio Services: You're opted in to booking updates and day-of logistics texts. Msg frequency varies. Msg & data rates may apply. Reply HELP for help, STOP to opt out.`,
  optOut: `SirReel Studio Services: You've opted out and won't receive more texts from us. Reply START to opt back in.`,
  help: `SirReel Studio Services: We text about your rental booking only. Email ${PUBLIC_CONTACT.email} or call ${PUBLIC_CONTACT.phone}. Msg & data rates may apply. Reply STOP to opt out.`,
} as const

export type Keyword = 'optIn' | 'optOut' | 'help' | null

/** A single-word message that is a carrier keyword. Anything longer is conversation. */
export function classifyKeyword(body: string): Keyword {
  const word = body.trim().toUpperCase().replace(/[.!]+$/, '')
  if (!word || /\s/.test(word)) return null
  if (OPT_OUT_KEYWORDS.includes(word)) return 'optOut'
  if (OPT_IN_KEYWORDS.includes(word)) return 'optIn'
  if (HELP_KEYWORDS.includes(word)) return 'help'
  return null
}

export async function getOrCreateThread(phoneRaw: string) {
  const phone = toE164(phoneRaw)
  if (!phone) return null
  return prisma.smsThread.upsert({ where: { phone }, create: { phone }, update: {} })
}

export async function recordInbound(args: { threadId: string; body: string; twilioSid: string | null }) {
  const [row] = await prisma.$transaction([
    prisma.smsMessage.create({
      data: { threadId: args.threadId, direction: 'INBOUND', body: args.body.slice(0, 4000), twilioSid: args.twilioSid, status: 'received', source: 'twilio' },
      select: { id: true },
    }),
    prisma.smsThread.update({ where: { id: args.threadId }, data: { lastInboundAt: new Date() } }),
  ])
  return row
}

/** Log an outbound that was delivered by TwiML (the webhook's own reply),
 *  which has no Twilio sid of its own at write time. */
export async function recordOutbound(args: {
  threadId: string
  body: string
  source: 'assistant' | 'keyword' | 'staff' | 'system'
  twilioSid?: string | null
  status?: string | null
  errorText?: string | null
  jobId?: string | null
  subRentalId?: string | null
  sentById?: string | null
}) {
  const [row] = await prisma.$transaction([
    prisma.smsMessage.create({
      data: {
        threadId: args.threadId, direction: 'OUTBOUND', body: args.body.slice(0, 4000), source: args.source,
        twilioSid: args.twilioSid ?? null, status: args.status ?? 'sent', errorText: args.errorText ?? null,
        jobId: args.jobId ?? null, subRentalId: args.subRentalId ?? null, sentById: args.sentById ?? null,
      },
      select: { id: true },
    }),
    prisma.smsThread.update({ where: { id: args.threadId }, data: { lastOutboundAt: new Date() } }),
  ])
  return row
}

export async function applyKeyword(threadId: string, kw: Exclude<Keyword, null>) {
  if (kw === 'optOut') await prisma.smsThread.update({ where: { id: threadId }, data: { optedOutAt: new Date() } })
  if (kw === 'optIn') await prisma.smsThread.update({ where: { id: threadId }, data: { optedOutAt: null, optedInAt: new Date(), optedInVia: 'keyword' } })
}

/** The turns the model sees: inside the idle window, most recent MAX_TURNS,
 *  keyword traffic excluded, collapsed so roles alternate and the last is the user. */
export async function turnsForModel(threadId: string): Promise<Array<{ role: 'user' | 'assistant'; content: string }>> {
  const since = new Date(Date.now() - IDLE_WINDOW_MS)
  const rows = await prisma.smsMessage.findMany({
    where: { threadId, createdAt: { gte: since }, source: { notIn: ['keyword'] } },
    orderBy: { createdAt: 'desc' },
    take: MAX_TURNS,
    select: { direction: true, body: true },
  })
  const turns: Array<{ role: 'user' | 'assistant'; content: string }> = []
  for (const r of rows.reverse()) {
    const role = r.direction === 'INBOUND' ? 'user' : 'assistant'
    const last = turns[turns.length - 1]
    if (last && last.role === role) last.content = `${last.content}\n${r.body}`
    else turns.push({ role, content: r.body })
  }
  // The model requires the first turn to be the user's.
  while (turns.length && turns[0].role !== 'user') turns.shift()
  return turns
}

/**
 * Who HQ thinks this number is, for the assistant's context line and the
 * thread's anchors. Names, roles and job codes only — never a code, an
 * address, or anything a stranger spoofing a number should learn. The
 * assistant still verifies before releasing a code.
 */
export async function identifyNumber(phone: string): Promise<{ context: string | null; personId: string | null; subRentalId: string | null }> {
  const digits = phone.replace(/\D/g, '').slice(-10)
  if (digits.length < 10) return { context: null, personId: null, subRentalId: null }
  const like = `%${digits.slice(0, 3)}%${digits.slice(3, 6)}%${digits.slice(6)}%`

  // A partner's driver or delivery contact on a live sub-rental.
  const sub = await prisma.$queryRaw<Array<{ id: string; driver_name: string | null; item: string | null; job_code: string | null; start_date: Date | null; vendor: string }>>`
    SELECT s.id, s.driver_name, COALESCE(v2.name, s.item_description) AS item, j.job_code, s.start_date, v.name AS vendor
    FROM sub_rentals s
    JOIN vendors v ON v.id = s.vendor_id
    LEFT JOIN sub_contracted_vehicles v2 ON v2.id = s.subcontracted_vehicle_id
    LEFT JOIN sr_jobs j ON j.id = s.job_id
    WHERE s.driver_phone IS NOT NULL
      AND regexp_replace(s.driver_phone, '\\D', '', 'g') LIKE ${'%' + digits}
      AND s.status NOT IN ('CANCELLED', 'RETURNED')
    ORDER BY s.start_date DESC NULLS LAST
    LIMIT 1
  `.catch(() => [])
  if (sub[0]) {
    const s = sub[0]
    const when = s.start_date ? ` starting ${s.start_date.toISOString().slice(0, 10)}` : ''
    return {
      context: `${s.driver_name ?? 'A driver'} — ${s.vendor}'s driver/delivery contact for the ${s.item ?? 'unit'}${s.job_code ? ` on job ${s.job_code}` : ''}${when}.`,
      personId: null,
      subRentalId: s.id,
    }
  }

  // A CRM person with a live job.
  const person = await prisma.$queryRaw<Array<{ id: string; first_name: string | null; last_name: string | null; job_code: string | null; role: string | null }>>`
    SELECT p.id, p.first_name, p.last_name, j.job_code, jc.role::text AS role
    FROM people p
    LEFT JOIN sr_job_contacts jc ON jc.person_id = p.id
    LEFT JOIN sr_jobs j ON j.id = jc.job_id AND j.archived_at IS NULL AND j.status::text NOT IN ('LOST', 'WRAPPED')
    WHERE (p.phone IS NOT NULL AND regexp_replace(p.phone, '\\D', '', 'g') LIKE ${'%' + digits})
       OR (p.mobile IS NOT NULL AND regexp_replace(p.mobile, '\\D', '', 'g') LIKE ${'%' + digits})
    ORDER BY j.updated_at DESC NULLS LAST
    LIMIT 1
  `.catch(() => [])
  void like
  if (person[0]) {
    const p = person[0]
    const name = [p.first_name, p.last_name].filter(Boolean).join(' ').trim() || 'A client contact'
    return {
      context: `${name}${p.role ? ` (${p.role})` : ''}${p.job_code ? `, a contact on job ${p.job_code}` : ', a client contact with no live job on file'}.`,
      personId: p.id,
      subRentalId: null,
    }
  }
  return { context: null, personId: null, subRentalId: null }
}

/** 9pm–6am Pacific: automated texts wait. Staff sends are exempt. */
export function inQuietHours(now = new Date()): boolean {
  const h = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', hour: 'numeric', hour12: false }).format(now))
  return h >= 21 || h < 6
}

const STATUS_CALLBACK = `${(process.env.NEXT_PUBLIC_APP_URL || 'https://hq.sirreel.com').replace(/\/$/, '')}/api/public/sms/status`

/**
 * Send a text and log it. Refuses opted-out numbers, holds automated sends
 * in quiet hours, and records a skipped row either way so the job page can
 * say why nothing went out. When Twilio isn't configured the row is
 * 'skipped-unconfigured' — the send becomes real the day the number is set.
 */
export async function sendTracked(args: {
  to: string
  body: string
  source: 'assistant' | 'staff' | 'system'
  jobId?: string | null
  subRentalId?: string | null
  sentById?: string | null
  /** Staff pressing send may text at any hour. */
  overrideQuietHours?: boolean
}): Promise<{ ok: boolean; status: string; error?: string }> {
  const thread = await getOrCreateThread(args.to)
  if (!thread) return { ok: false, status: 'bad-number', error: `unusable number: ${args.to}` }
  const text = args.body.endsWith('Reply STOP to opt out.') ? args.body : `${args.body.trim()} Reply STOP to opt out.`
  const log = (status: string, extra: { twilioSid?: string | null; errorText?: string | null } = {}) =>
    recordOutbound({ threadId: thread.id, body: text, source: args.source, status, jobId: args.jobId, subRentalId: args.subRentalId, sentById: args.sentById, ...extra })

  if (thread.optedOutAt) { await log('skipped-opted-out'); return { ok: false, status: 'skipped-opted-out', error: 'number opted out' } }
  if (args.source !== 'staff' && !args.overrideQuietHours && inQuietHours()) { await log('skipped-quiet'); return { ok: false, status: 'skipped-quiet', error: 'quiet hours' } }

  const r = await sendSms(thread.phone, text, { statusCallback: STATUS_CALLBACK })
  if (r.ok) { await log('queued', { twilioSid: r.sid ?? null }); return { ok: true, status: 'queued' } }
  if (r.skipped) { await log('skipped-unconfigured'); return { ok: false, status: 'skipped-unconfigured', error: 'SMS not configured' } }
  await log('failed', { errorText: r.error ?? null })
  return { ok: false, status: 'failed', error: r.error }
}
