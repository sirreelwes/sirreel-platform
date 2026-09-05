/**
 * The sub-rental conduit — production ↔ SirReel ↔ partner ↔ partner's driver.
 *
 * Wes, 2026-09-05: "a portal through which all vendor/SirReel interaction and
 * transfer of information can happen." Concretely, for King Kong's EcoFlux on
 * a client's show:
 *
 *   1. The production says where the unit reports (and, per unit, the call
 *      time) on THEIR portal → the partner sees it on the vendor page and is
 *      emailed; if a driver is already named, the driver is emailed too.
 *   2. The partner names a driver on the vendor page → the production sees
 *      the driver's name in their portal and is emailed; the driver gets
 *      their own page.
 *   3. The driver confirms they have the location and call time on their
 *      page → the production is emailed.
 *   4. The driver logs hours on their page → the partner and HQ see them.
 *
 * Every hop is an email FROM SirReel, and every hop copies the
 * `sub-rental-conduit-cc` channel (Wes, for the time being). Nobody is handed
 * anybody else's address.
 *
 * ── The conduit rule, as it stands after this change ────────────────────────
 * Before today the vendor side saw only the unit, the dates, the status and
 * our job code. Wes has now ruled that the partner and their driver DO see the
 * delivery address, access notes and call time — a driver cannot arrive
 * without them. What has NOT changed:
 *   · the partner and the driver never see the production's name, company,
 *     or contacts (the on-site contact's PHONE is withheld; a first name to
 *     ask for at a gate identifies no company and is left in);
 *   · the production never sees the partner's name — the driver is presented
 *     as "your driver", full stop.
 * The template argument types below are the enforcement: a vendor- or
 * driver-facing builder has no field a production name could travel in, and
 * a production-facing builder has none for a vendor name.
 */
import { randomBytes } from 'crypto'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { sendAgreementEmail } from '@/lib/email/sendAgreementEmail'
import { channelRecipients } from '@/lib/email/notificationChannels'
import { renderEmailShell, renderEmailText, p, detailTable, calloutBox } from '@/lib/email/templates/shell'
import { portalBaseUrl, portalJobUrl } from '@/lib/portal/portalUrl'
import { refreshOrIssueJobMagicLink } from '@/lib/portal/jobMagicLink'
import { PUBLIC_SITE_ORIGIN } from '@/lib/site/publicUrl'
import { vendorPagePath } from '@/lib/sub-rentals/potentialSubRental'
import { relayAddress } from '@/lib/sub-rentals/driverRelay'
import { sumHours } from '@/lib/drivers/hoursEntry'

// ── Paths ────────────────────────────────────────────────────────────────────

/** The partner's driver's page. On the portal host like /drive/[token]. */
export function driverUnitPagePath(token: string): string {
  return `/drive/unit/${token}`
}
export function driverUnitPageUrl(token: string): string {
  return `${portalBaseUrl()}${driverUnitPagePath(token)}`
}
export function vendorPageUrl(token: string): string {
  return `${PUBLIC_SITE_ORIGIN}${vendorPagePath(token)}`
}

/**
 * Statuses in which location and call time are the partner's business.
 * An ESTIMATED unit has nobody committed; telling its owner where a
 * production shoots would be handing out a client's address for a deal
 * that may never happen. RETURNED / CANCELLED are over.
 */
export const LOGISTICS_LIVE = ['REQUESTED', 'CONFIRMED', 'PICKED_UP', 'ON_RENT'] as const
export function receivesLogistics(status: string): boolean {
  return (LOGISTICS_LIVE as readonly string[]).includes(status)
}

// ── Loading ──────────────────────────────────────────────────────────────────

const CONDUIT_SELECT = {
  id: true,
  status: true,
  itemDescription: true,
  quantity: true,
  startDate: true,
  endDate: true,
  orderId: true,
  jobId: true,
  callTime: true,
  driverNotes: true,
  logisticsUpdatedAt: true,
  logisticsNotifiedAt: true,
  driverName: true,
  driverEmail: true,
  driverPhone: true,
  driverToken: true,
  driverAckedAt: true,
  driverAckNote: true,
  relayTag: true,
  vendorToken: true,
  vendorConfirmedAt: true,
  vendorDeclinedAt: true,
  originAddress: true,
  subcontractedVehicle: { select: { name: true } },
  vendor: { select: { id: true, name: true, email: true, poEmail: true, lotAddress: true } },
  driverHours: { select: { hours: true } },
  job: {
    select: {
      id: true,
      jobCode: true,
      reportToAddress: true,
      reportToAccessNotes: true,
      reportToTime: true,
      reportToContactName: true,
      reportToUpdatedAt: true,
      pickupSameAsDelivery: true,
      pickupAddress: true,
      pickupAccessNotes: true,
      pickupTime: true,
      jobContacts: {
        select: {
          isPrimary: true,
          person: { select: { id: true, firstName: true, lastName: true, email: true } },
        },
      },
      orders: {
        where: { status: { not: 'CANCELLED' as const } },
        orderBy: { createdAt: 'desc' as const },
        select: {
          id: true,
          portalSlug: true,
          agent: { select: { name: true, email: true } },
          portalAccesses: {
            where: { revokedAt: null },
            select: {
              contactId: true,
              contact: { select: { firstName: true, lastName: true, email: true } },
            },
          },
        },
      },
    },
  },
} satisfies Prisma.SubRentalSelect

export type ConduitRow = Prisma.SubRentalGetPayload<{ select: typeof CONDUIT_SELECT }>

export async function loadConduit(subRentalId: string): Promise<ConduitRow | null> {
  return prisma.subRental.findUnique({ where: { id: subRentalId }, select: CONDUIT_SELECT })
}

const ymd = (d: Date | null): string | null => (d ? d.toISOString().slice(0, 10) : null)

export function unitNameOf(row: { itemDescription: string; subcontractedVehicle: { name: string } | null }): string {
  return row.subcontractedVehicle?.name ?? row.itemDescription
}

function fmtDay(ymdStr: string | null): string | null {
  if (!ymdStr) return null
  const d = new Date(`${ymdStr}T12:00:00Z`)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })
}
export function fmtRange(start: string | null, end: string | null): string {
  const a = fmtDay(start)
  const b = fmtDay(end)
  if (a && b) return start === end ? a : `${a} – ${b}`
  return a ?? b ?? 'dates to be confirmed'
}

// ── What the partner and the driver may see ──────────────────────────────────

/**
 * The location facts for one unit, as the partner and driver see them.
 * Built from the JOB's report-to (shared by every unit arriving) plus this
 * unit's own call time and note. No phone number, no production name —
 * see the header. `hasAny` gates the "awaiting the production" empty state.
 */
export interface LogisticsView {
  /** Point of origin — where the unit leaves from (booking override, else the
   *  partner's lot). The partner's own fact; shown to the driver and HQ. */
  leavingFrom: string | null
  address: string | null
  accessNotes: string | null
  /** The production's general arrival window for deliveries ("6–7am"). */
  arriveTime: string | null
  /** This unit's own call time — overrides the general window when set. */
  callTime: string | null
  driverNotes: string | null
  /** First name to ask for at the gate. Never their number. */
  onSiteContactName: string | null
  pickupAddress: string | null
  pickupAccessNotes: string | null
  pickupTime: string | null
  updatedAt: string | null
  hasAny: boolean
}

export function logisticsFor(row: {
  callTime: string | null
  driverNotes: string | null
  logisticsUpdatedAt: Date | null
  originAddress?: string | null
  vendor?: { lotAddress: string | null } | null
  job: {
    reportToAddress: string | null
    reportToAccessNotes: string | null
    reportToTime: string | null
    reportToContactName: string | null
    reportToUpdatedAt: Date | null
    pickupSameAsDelivery: boolean
    pickupAddress: string | null
    pickupAccessNotes: string | null
    pickupTime: string | null
  } | null
}): LogisticsView {
  const j = row.job
  const same = j?.pickupSameAsDelivery ?? true
  const v: Omit<LogisticsView, 'hasAny'> = {
    leavingFrom: row.originAddress ?? row.vendor?.lotAddress ?? null,
    address: j?.reportToAddress ?? null,
    accessNotes: j?.reportToAccessNotes ?? null,
    arriveTime: j?.reportToTime ?? null,
    callTime: row.callTime ?? null,
    driverNotes: row.driverNotes ?? null,
    onSiteContactName: j?.reportToContactName ?? null,
    pickupAddress: same ? j?.reportToAddress ?? null : j?.pickupAddress ?? null,
    pickupAccessNotes: same ? j?.reportToAccessNotes ?? null : j?.pickupAccessNotes ?? null,
    // Never inherited from delivery — same rule as the client portal.
    pickupTime: j?.pickupTime ?? null,
    updatedAt: (() => {
      const a = row.logisticsUpdatedAt?.getTime() ?? 0
      const b = j?.reportToUpdatedAt?.getTime() ?? 0
      const m = Math.max(a, b)
      return m ? new Date(m).toISOString() : null
    })(),
  }
  return { ...v, hasAny: !!(v.address || v.accessNotes || v.arriveTime || v.callTime || v.driverNotes) }
}

/** Rows for a detailTable — only the facts that are set. */
function logisticsRows(l: LogisticsView): Array<{ label: string; value: string }> {
  const rows: Array<{ label: string; value: string }> = []
  if (l.leavingFrom) rows.push({ label: 'Leaving from', value: l.leavingFrom })
  if (l.address) rows.push({ label: 'Report to', value: l.address })
  if (l.accessNotes) rows.push({ label: 'Gate / access', value: l.accessNotes })
  if (l.callTime) rows.push({ label: 'Call time', value: l.callTime })
  else if (l.arriveTime) rows.push({ label: 'Arrive', value: l.arriveTime })
  if (l.onSiteContactName) rows.push({ label: 'Ask for', value: l.onSiteContactName })
  if (l.driverNotes) rows.push({ label: 'Note for the driver', value: l.driverNotes })
  if (l.pickupAddress && l.pickupAddress !== l.address) rows.push({ label: 'Collect from', value: l.pickupAddress })
  if (l.pickupTime) rows.push({ label: 'Collect', value: l.pickupTime })
  return rows
}
function logisticsText(l: LogisticsView): string[] {
  return logisticsRows(l).map((r) => `${r.label}: ${r.value}`)
}

// ── Recipients ───────────────────────────────────────────────────────────────

export interface ProductionRecipient {
  email: string
  name: string | null
  portalUrl: string
}

/**
 * Who on the production hears about this unit, and the link that lands them
 * on their job portal.
 *
 * Portal-access holders first — they are the people already reading the job
 * page, and each gets their own refreshed magic link (the same policy invoice
 * sends use). If nobody holds portal access yet, the primary job contact, with
 * a plain portal URL. De-duplicated by address.
 */
export async function productionRecipients(row: ConduitRow): Promise<ProductionRecipient[]> {
  const job = row.job
  if (!job) return []
  // The order this sub-rental bills through leads; the job's other live
  // orders follow, so a contact on a sibling order still hears.
  const orders = [...job.orders].sort((a, b) => (a.id === row.orderId ? -1 : b.id === row.orderId ? 1 : 0))
  const out: ProductionRecipient[] = []
  const seen = new Set<string>()

  for (const o of orders) {
    if (!o.portalSlug) continue
    for (const pa of o.portalAccesses) {
      const email = pa.contact.email?.trim().toLowerCase()
      if (!email || seen.has(email)) continue
      seen.add(email)
      let url = portalJobUrl(o.portalSlug)
      try {
        const link = await refreshOrIssueJobMagicLink({ orderId: o.id, contactId: pa.contactId })
        url = portalJobUrl(o.portalSlug, link.token)
      } catch {
        /* a bare portal URL still lands them on the resend-link flow */
      }
      out.push({ email, name: `${pa.contact.firstName ?? ''} ${pa.contact.lastName ?? ''}`.trim() || null, portalUrl: url })
    }
  }
  if (out.length) return out

  const contacts = job.jobContacts.filter((c) => !!c.person?.email)
  const chosen = contacts.find((c) => c.isPrimary) ?? contacts[0]
  const slug = orders.find((o) => o.portalSlug)?.portalSlug ?? null
  if (chosen?.person?.email && slug) {
    out.push({
      email: chosen.person.email.trim().toLowerCase(),
      name: `${chosen.person.firstName ?? ''} ${chosen.person.lastName ?? ''}`.trim() || null,
      portalUrl: portalJobUrl(slug),
    })
  }
  return out
}

/** Where the partner is mailed — the ordering desk wins over the contact. */
export function vendorRecipient(row: { vendor: { email: string | null; poEmail: string | null } }): string | null {
  return row.vendor.poEmail ?? row.vendor.email ?? null
}

async function conduitCc(exclude: string[]): Promise<string[]> {
  const cc = await channelRecipients('sub-rental-conduit-cc')
  const skip = new Set(exclude.map((e) => e.toLowerCase()))
  return cc.filter((e) => e && !skip.has(e.toLowerCase()))
}

// ── Tokens ───────────────────────────────────────────────────────────────────

/** The driver's page credential. Minted once; re-minted by assignDriver's caller when the driver changes. */
export async function ensureDriverToken(subRentalId: string, current: string | null): Promise<string> {
  if (current) return current
  const token = randomBytes(32).toString('hex')
  await prisma.subRental.update({
    where: { id: subRentalId },
    data: { driverToken: token, driverTokenMintedAt: new Date() },
  })
  return token
}

/** Re-mint: the old driver's page stops resolving the moment a new driver is named. */
export async function rotateDriverToken(subRentalId: string): Promise<string> {
  const token = randomBytes(32).toString('hex')
  await prisma.subRental.update({
    where: { id: subRentalId },
    data: { driverToken: token, driverTokenMintedAt: new Date(), driverViewedAt: null, driverViewCount: 0, driverAckedAt: null, driverAckNote: null },
  })
  return token
}

// ── Templates (pure; exported for tests) ─────────────────────────────────────

export interface BuiltEmail {
  subject: string
  html: string
  text: string
}

const FOOT_PARTNER = 'Questions about this booking go to SirReel — reply to this email rather than contacting the production.'
const FOOT_DRIVER = 'This link is personal to you. Please don’t forward it.'

/** To the PARTNER: the production has set (or changed) where and when. */
export function buildLogisticsForVendor(a: {
  vendorName: string
  unitName: string
  startDate: string | null
  endDate: string | null
  reference: string | null
  logistics: LogisticsView
  driverName: string | null
  vendorUrl: string
}): BuiltEmail {
  const range = fmtRange(a.startDate, a.endDate)
  const subject = `Location & call time — ${a.unitName}, ${range}`
  const rows = logisticsRows(a.logistics)
  const driverLine = a.driverName
    ? `${a.driverName} has been sent the same details and asked to confirm on their driver page.`
    : `Name your driver on your booking page and they will receive these details directly.`
  const html = renderEmailShell({
    eyebrow: 'Sub-rental · where and when',
    heading: `Where the ${a.unitName} reports`,
    preheader: `${a.unitName}, ${range}`,
    bodyHtml: [
      p(`Hi ${esc(a.vendorName)} — the production has set the location and call time for your <strong>${esc(a.unitName)}</strong> (${esc(range)}${a.reference ? `, SirReel reference ${esc(a.reference)}` : ''}).`),
      rows.length ? detailTable(rows) : p('<em>Details to follow.</em>'),
      p(esc(driverLine)),
    ].join('\n'),
    cta: { label: 'Open the booking page', href: a.vendorUrl },
    footNote: FOOT_PARTNER,
  })
  const text = renderEmailText([
    `Hi ${a.vendorName} — the production has set the location and call time for your ${a.unitName} (${range}${a.reference ? `, SirReel reference ${a.reference}` : ''}).`,
    '',
    ...logisticsText(a.logistics),
    '',
    driverLine,
    '',
    `Booking page: ${a.vendorUrl}`,
    '',
    FOOT_PARTNER,
  ])
  return { subject, html, text }
}

/** To the DRIVER: where to go, when, and please confirm. */
export function buildLogisticsForDriver(a: {
  driverName: string
  unitName: string
  startDate: string | null
  endDate: string | null
  logistics: LogisticsView
  driverUrl: string
  /** True when they had confirmed an earlier version — the copy says so. */
  changed: boolean
}): BuiltEmail {
  const range = fmtRange(a.startDate, a.endDate)
  const subject = a.changed ? `Updated — where to take the ${a.unitName}, ${range}` : `Where to take the ${a.unitName}, ${range}`
  const first = a.driverName.split(/\s+/)[0] || a.driverName
  const html = renderEmailShell({
    eyebrow: 'Your job',
    heading: a.changed ? `The plan changed — ${a.unitName}` : `Where to go — ${a.unitName}`,
    preheader: `${a.unitName}, ${range}`,
    bodyHtml: [
      p(`${esc(first)} — ${a.changed ? 'the production has <strong>changed</strong> the location or call time for' : 'here is where the production wants'} the <strong>${esc(a.unitName)}</strong>, ${esc(range)}.`),
      detailTable(logisticsRows(a.logistics)),
      calloutBox(`<strong>Please confirm you have this.</strong><br/>Open your page and press “I have the location and call time” — the production is waiting to hear that it reached you.`),
    ].join('\n'),
    cta: { label: 'Open your page & confirm', href: a.driverUrl },
    footNote: FOOT_DRIVER,
  })
  const text = renderEmailText([
    `${first} — ${a.changed ? 'the production has CHANGED the location or call time for' : 'here is where the production wants'} the ${a.unitName}, ${range}.`,
    '',
    ...logisticsText(a.logistics),
    '',
    `Please confirm you have this — open your page and press "I have the location and call time":`,
    a.driverUrl,
    '',
    FOOT_DRIVER,
  ])
  return { subject, html, text }
}

/** To the DRIVER when the partner names them: here is your page. */
export function buildDriverWelcome(a: {
  driverName: string
  vendorName: string
  unitName: string
  startDate: string | null
  endDate: string | null
  logistics: LogisticsView
  driverUrl: string
}): BuiltEmail {
  const range = fmtRange(a.startDate, a.endDate)
  const subject = `You're driving the ${a.unitName} — ${range}`
  const first = a.driverName.split(/\s+/)[0] || a.driverName
  const rows = logisticsRows(a.logistics)
  const html = renderEmailShell({
    eyebrow: 'Driver assignment',
    heading: `You’re driving the ${a.unitName}`,
    preheader: `${range} — your page has the location and call time`,
    bodyHtml: [
      p(`${esc(first)} — ${esc(a.vendorName)} listed you as the driver for their <strong>${esc(a.unitName)}</strong> on a SirReel job, ${esc(range)}.`),
      rows.length
        ? detailTable(rows)
        : calloutBox(`The production is still adding the location and call time. You’ll get an email the moment they do, and your page below always shows the latest.`),
      p(`Your page is where you confirm you have the details, ask the production a question, and log your hours each day. Keep the link — it stays current if plans change.`),
    ].join('\n'),
    cta: { label: 'Open your driver page', href: a.driverUrl },
    footNote: FOOT_DRIVER,
  })
  const text = renderEmailText([
    `${first} — ${a.vendorName} listed you as the driver for their ${a.unitName} on a SirReel job, ${range}.`,
    '',
    ...(rows.length ? logisticsText(a.logistics) : ['The production is still adding the location and call time — your page will show it the moment they do.']),
    '',
    `Your page is where you confirm the details, ask the production a question, and log your hours:`,
    a.driverUrl,
    '',
    FOOT_DRIVER,
  ])
  return { subject, html, text }
}

/** To the PRODUCTION: a driver has been named for your unit. No partner name. */
export function buildDriverNamedForProduction(a: {
  recipientName: string | null
  unitName: string
  startDate: string | null
  endDate: string | null
  driverName: string
  hasCallTime: boolean
  portalUrl: string
}): BuiltEmail {
  const range = fmtRange(a.startDate, a.endDate)
  const subject = `Your driver for the ${a.unitName} is ${a.driverName}`
  const greet = a.recipientName ? `${a.recipientName.split(/\s+/)[0]} —` : 'Hi —'
  const ask = a.hasCallTime
    ? `Your call time and location are already on file and have gone to ${a.driverName}. We’ll let you know when they confirm.`
    : `Add the call time and anything ${a.driverName} should know on your job page — we pass it straight to them and tell you when they confirm.`
  const html = renderEmailShell({
    eyebrow: 'Deliveries',
    heading: `Driver assigned — ${a.unitName}`,
    preheader: `${a.driverName} is bringing the ${a.unitName}, ${range}`,
    bodyHtml: [
      p(`${esc(greet)} a driver has been assigned to the <strong>${esc(a.unitName)}</strong> arriving ${esc(range)}.`),
      detailTable([{ label: 'Your driver', value: a.driverName }, { label: 'Unit', value: a.unitName }, { label: 'Dates', value: range }]),
      p(esc(ask)),
    ].join('\n'),
    cta: { label: a.hasCallTime ? 'Open your job page' : 'Add the call time', href: a.portalUrl },
    footNote: 'Messages to the driver go through SirReel and stay on the record for your job.',
  })
  const text = renderEmailText([
    `${greet} a driver has been assigned to the ${a.unitName} arriving ${range}.`,
    '',
    `Your driver: ${a.driverName}`,
    `Unit: ${a.unitName}`,
    `Dates: ${range}`,
    '',
    ask,
    '',
    a.portalUrl,
  ])
  return { subject, html, text }
}

/** To the PRODUCTION: the driver confirmed. */
export function buildDriverAckForProduction(a: {
  recipientName: string | null
  unitName: string
  startDate: string | null
  endDate: string | null
  driverName: string
  logistics: LogisticsView
  note: string | null
  portalUrl: string
}): BuiltEmail {
  const range = fmtRange(a.startDate, a.endDate)
  const subject = `${a.driverName} confirmed — ${a.unitName}, ${range}`
  const greet = a.recipientName ? `${a.recipientName.split(/\s+/)[0]} —` : 'Hi —'
  const html = renderEmailShell({
    eyebrow: 'Deliveries',
    heading: `${a.driverName} has the details`,
    preheader: `${a.unitName}, ${range} — location and call time confirmed`,
    bodyHtml: [
      p(`${esc(greet)} <strong>${esc(a.driverName)}</strong> confirmed they have the location and call time for the <strong>${esc(a.unitName)}</strong>, ${esc(range)}.`),
      detailTable(logisticsRows(a.logistics)),
      a.note ? calloutBox(`<strong>From ${esc(a.driverName)}:</strong><br/>${esc(a.note)}`) : '',
      p(`If anything changes, update it on your job page and the driver is told again.`),
    ].join('\n'),
    cta: { label: 'Open your job page', href: a.portalUrl },
  })
  const text = renderEmailText([
    `${greet} ${a.driverName} confirmed they have the location and call time for the ${a.unitName}, ${range}.`,
    '',
    ...logisticsText(a.logistics),
    ...(a.note ? ['', `From ${a.driverName}: ${a.note}`] : []),
    '',
    `If anything changes, update it on your job page and the driver is told again:`,
    a.portalUrl,
  ])
  return { subject, html, text }
}

/** To the PRODUCTION: the driver asked something. Reply goes back via the relay. */
export function buildDriverQuestionForProduction(a: {
  recipientName: string | null
  unitName: string
  driverName: string
  question: string
  portalUrl: string
  canReply: boolean
}): BuiltEmail {
  const subject = `Question from your driver — ${a.unitName}`
  const greet = a.recipientName ? `${a.recipientName.split(/\s+/)[0]} —` : 'Hi —'
  const replyLine = a.canReply
    ? `Reply to this email and your answer reaches ${a.driverName} through SirReel.`
    : `Answer on your job page (update the notes for the driver) and they’ll be told.`
  const html = renderEmailShell({
    eyebrow: 'Deliveries',
    heading: `${a.driverName} has a question`,
    preheader: a.question.slice(0, 90),
    bodyHtml: [
      p(`${esc(greet)} your driver for the <strong>${esc(a.unitName)}</strong> asks:`),
      calloutBox(esc(a.question).replace(/\n/g, '<br/>')),
      p(esc(replyLine)),
    ].join('\n'),
    cta: { label: 'Open your job page', href: a.portalUrl },
  })
  const text = renderEmailText([
    `${greet} your driver for the ${a.unitName} asks:`,
    '',
    a.question,
    '',
    replyLine,
    '',
    a.portalUrl,
  ])
  return { subject, html, text }
}

/** To HQ: the partner confirmed — or cannot hold. */
export function buildVendorWordForHq(a: {
  kind: 'confirmed' | 'declined'
  vendorName: string
  unitName: string
  startDate: string | null
  endDate: string | null
  jobCode: string | null
  note: string | null
  hqUrl: string
}): BuiltEmail {
  const range = fmtRange(a.startDate, a.endDate)
  const ref = a.jobCode ? ` · ${a.jobCode}` : ''
  const subject =
    a.kind === 'confirmed'
      ? `${a.vendorName} confirmed the hold — ${a.unitName}, ${range}${ref}`
      : `${a.vendorName} CANNOT hold — ${a.unitName}, ${range}${ref}`
  const html = renderEmailShell({
    eyebrow: 'Sub-rentals',
    heading: a.kind === 'confirmed' ? `${a.vendorName} confirmed` : `${a.vendorName} can’t hold the dates`,
    bodyHtml: [
      p(
        a.kind === 'confirmed'
          ? `${esc(a.vendorName)} pressed <strong>Confirm hold</strong> on their booking page for the <strong>${esc(a.unitName)}</strong>, ${esc(range)}. The sub-rental is now CONFIRMED.`
          : `${esc(a.vendorName)} says they <strong>cannot hold</strong> the <strong>${esc(a.unitName)}</strong> for ${esc(range)}. The status has NOT been changed — someone needs to source a replacement or talk to the client.`,
      ),
      a.note ? calloutBox(`<strong>Their note:</strong><br/>${esc(a.note)}`) : '',
    ].join('\n'),
    cta: { label: 'Open the job in HQ', href: a.hqUrl },
  })
  const text = renderEmailText([
    a.kind === 'confirmed'
      ? `${a.vendorName} confirmed the hold on the ${a.unitName}, ${range}. Sub-rental is CONFIRMED.`
      : `${a.vendorName} CANNOT hold the ${a.unitName} for ${range}. Status unchanged — source a replacement or talk to the client.`,
    ...(a.note ? ['', `Their note: ${a.note}`] : []),
    '',
    a.hqUrl,
  ])
  return { subject, html, text }
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

// ── Events ───────────────────────────────────────────────────────────────────

async function send(args: {
  to: string
  cc?: string[]
  replyTo?: string
  mail: BuiltEmail
  label: string
  orderId: string | null
}): Promise<boolean> {
  const cc = [...(args.cc ?? []), ...(await conduitCc([args.to, ...(args.cc ?? [])]))]
  const res = await sendAgreementEmail({
    to: [args.to],
    cc: cc.length ? cc : undefined,
    replyTo: args.replyTo,
    subject: args.mail.subject,
    html: args.mail.html,
    text: args.mail.text,
    label: args.label,
    orderId: args.orderId,
  }).catch((err: unknown) => ({ ok: false as const, reason: err instanceof Error ? err.message : 'send threw' }))
  if (!res.ok) console.warn(`[conduit] ${args.label} to ${args.to} not sent:`, res.reason)
  return res.ok
}

/**
 * Sub-rentals on a job that should hear about a logistics change: live
 * statuses only, both linkage shapes (jobId, and orderId → job).
 */
export async function liveSubRentalIdsForJob(jobId: string, only?: string[]): Promise<string[]> {
  const rows = await prisma.subRental.findMany({
    where: {
      OR: [{ jobId }, { order: { jobId } }],
      status: { in: [...LOGISTICS_LIVE] },
      ...(only?.length ? { id: { in: only } } : {}),
    },
    select: { id: true },
  })
  return rows.map((r) => r.id)
}

/**
 * Step 1 — the production changed where/when. Tell the partner, tell the
 * driver if there is one, and stamp the change so a stale confirmation can
 * be recognised.
 *
 * Fire-and-forget by callers: a failed send never fails the production's
 * save. `logisticsNotifiedAt` is stamped only when at least one mail left,
 * so HQ can see a change that nobody was told about.
 */
export async function notifyLogisticsChanged(args: {
  jobId: string
  /** Restrict to these rows (a per-unit call-time save); omit for all live rows on the job. */
  subRentalIds?: string[]
  /** When the change was made — stamped as logisticsUpdatedAt. */
  at?: Date
}): Promise<{ rows: number; vendorMails: number; driverMails: number }> {
  const at = args.at ?? new Date()
  const ids = await liveSubRentalIdsForJob(args.jobId, args.subRentalIds)
  let vendorMails = 0
  let driverMails = 0
  for (const id of ids) {
    await prisma.subRental.update({ where: { id }, data: { logisticsUpdatedAt: at } })
    const row = await loadConduit(id)
    if (!row) continue
    const logistics = logisticsFor(row)
    if (!logistics.hasAny) continue
    const unitName = unitNameOf(row)
    let any = false

    const vTo = vendorRecipient(row)
    if (vTo && row.vendorToken) {
      const ok = await send({
        to: vTo,
        mail: buildLogisticsForVendor({
          vendorName: row.vendor.name,
          unitName,
          startDate: ymd(row.startDate),
          endDate: ymd(row.endDate),
          reference: row.job?.jobCode ?? null,
          logistics,
          driverName: row.driverName,
          vendorUrl: vendorPageUrl(row.vendorToken),
        }),
        label: 'sub-rental/logistics-vendor',
        orderId: row.orderId,
      })
      if (ok) { vendorMails++; any = true }
    }

    if (row.driverEmail && row.driverName) {
      const token = await ensureDriverToken(row.id, row.driverToken)
      const ok = await send({
        to: row.driverEmail,
        // Their reply rides the relay back to the production, through us.
        replyTo: row.relayTag ? relayAddress(row.relayTag) : undefined,
        mail: buildLogisticsForDriver({
          driverName: row.driverName,
          unitName,
          startDate: ymd(row.startDate),
          endDate: ymd(row.endDate),
          logistics,
          driverUrl: driverUnitPageUrl(token),
          changed: !!row.driverAckedAt,
        }),
        label: 'sub-rental/logistics-driver',
        orderId: row.orderId,
      })
      if (ok) { driverMails++; any = true }
    }

    if (any) await prisma.subRental.update({ where: { id }, data: { logisticsNotifiedAt: new Date() } })
  }
  return { rows: ids.length, vendorMails, driverMails }
}

/**
 * Step 2 — the partner named (or changed) their driver. The driver gets
 * their page; the production hears who is coming and is asked for the call
 * time. Always rotates the driver token so a replaced driver's page dies.
 */
export async function notifyDriverAssigned(subRentalId: string): Promise<{
  driverUrl: string | null
  driverMailed: boolean
  productionMailed: number
}> {
  const token = await rotateDriverToken(subRentalId)
  const row = await loadConduit(subRentalId)
  if (!row || !row.driverName || !row.driverEmail) return { driverUrl: null, driverMailed: false, productionMailed: 0 }
  const unitName = unitNameOf(row)
  const logistics = logisticsFor(row)
  const driverUrl = driverUnitPageUrl(token)

  const driverMailed = await send({
    to: row.driverEmail,
    replyTo: row.relayTag ? relayAddress(row.relayTag) : undefined,
    mail: buildDriverWelcome({
      driverName: row.driverName,
      vendorName: row.vendor.name,
      unitName,
      startDate: ymd(row.startDate),
      endDate: ymd(row.endDate),
      logistics,
      driverUrl,
    }),
    label: 'sub-rental/driver-welcome',
    orderId: row.orderId,
  })

  let productionMailed = 0
  // Only once the production is committed — an ESTIMATED row's client has
  // not said yes and should not be told a driver is "coming".
  if (receivesLogistics(row.status)) {
    for (const r of await productionRecipients(row)) {
      const ok = await send({
        to: r.email,
        mail: buildDriverNamedForProduction({
          recipientName: r.name,
          unitName,
          startDate: ymd(row.startDate),
          endDate: ymd(row.endDate),
          driverName: row.driverName,
          hasCallTime: !!(logistics.callTime || logistics.arriveTime),
          portalUrl: r.portalUrl,
        }),
        label: 'sub-rental/driver-named-production',
        orderId: row.orderId,
      })
      if (ok) productionMailed++
    }
  }
  return { driverUrl, driverMailed, productionMailed }
}

/** Step 3 — the driver confirmed. The production hears. */
export async function notifyDriverAcked(subRentalId: string): Promise<{ productionMailed: number }> {
  const row = await loadConduit(subRentalId)
  if (!row || !row.driverName) return { productionMailed: 0 }
  const unitName = unitNameOf(row)
  const logistics = logisticsFor(row)
  let productionMailed = 0
  for (const r of await productionRecipients(row)) {
    const ok = await send({
      to: r.email,
      mail: buildDriverAckForProduction({
        recipientName: r.name,
        unitName,
        startDate: ymd(row.startDate),
        endDate: ymd(row.endDate),
        driverName: row.driverName,
        logistics,
        note: row.driverAckNote,
        portalUrl: r.portalUrl,
      }),
      label: 'sub-rental/driver-ack-production',
      orderId: row.orderId,
    })
    if (ok) productionMailed++
  }
  return { productionMailed }
}

/** The driver asked the production something from their page. */
export async function relayDriverQuestion(subRentalId: string, question: string): Promise<{ productionMailed: number }> {
  const row = await loadConduit(subRentalId)
  if (!row || !row.driverName) return { productionMailed: 0 }
  const unitName = unitNameOf(row)
  const relay = row.relayTag ? relayAddress(row.relayTag) : undefined
  let productionMailed = 0
  for (const r of await productionRecipients(row)) {
    const ok = await send({
      to: r.email,
      replyTo: relay,
      mail: buildDriverQuestionForProduction({
        recipientName: r.name,
        unitName,
        driverName: row.driverName,
        question,
        portalUrl: r.portalUrl,
        canReply: !!relay,
      }),
      label: 'sub-rental/driver-question',
      orderId: row.orderId,
    })
    if (ok) productionMailed++
  }
  return { productionMailed }
}

/**
 * The partner pressed Confirm hold / Can't hold on their page. HQ hears —
 * the order's agent, the sales desk, and the conduit CC — and an Alert is
 * raised so it shows on the dashboard even if nobody reads mail.
 */
export async function notifyVendorWord(subRentalId: string, kind: 'confirmed' | 'declined', note: string | null): Promise<void> {
  const row = await loadConduit(subRentalId)
  if (!row) return
  const unitName = unitNameOf(row)
  const jobId = row.job?.id ?? row.jobId
  const hqUrl = jobId ? `https://hq.sirreel.com/jobs/${jobId}#sub-rentals` : 'https://hq.sirreel.com/jobs'
  const mail = buildVendorWordForHq({
    kind,
    vendorName: row.vendor.name,
    unitName,
    startDate: ymd(row.startDate),
    endDate: ymd(row.endDate),
    jobCode: row.job?.jobCode ?? null,
    note,
    hqUrl,
  })
  const desk = await channelRecipients('sales-team-cc')
  const agent = row.job?.orders.find((o) => o.id === row.orderId)?.agent?.email ?? row.job?.orders[0]?.agent?.email ?? null
  const to = agent ?? desk[0] ?? null
  if (to) {
    await send({
      to,
      cc: desk.filter((d) => d.toLowerCase() !== to.toLowerCase()),
      mail,
      label: kind === 'confirmed' ? 'sub-rental/vendor-confirmed' : 'sub-rental/vendor-declined',
      orderId: row.orderId,
    })
  }
  await prisma.alert
    .create({
      data: {
        type: kind === 'confirmed' ? 'sub_rental.vendor_confirmed' : 'sub_rental.vendor_declined',
        title: mail.subject,
        body: note ? `Their note: ${note}` : '',
        severity: kind === 'confirmed' ? 'medium' : 'high',
        link: jobId ? `/jobs/${jobId}#sub-rentals` : null,
      },
    })
    .catch((err) => console.error('[conduit] alert write failed:', err))
}

/** Hours summary for a sub-rental's driver — used by all three pages. */
export function hoursTotal(row: { driverHours: Array<{ hours: { toString(): string } }> }): number {
  return sumHours(row.driverHours)
}
