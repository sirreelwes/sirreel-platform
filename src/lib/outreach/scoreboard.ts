/**
 * The outreach scoreboard.
 *
 * Sent → delivered → replied → inquiry → quoted → booked, with the
 * dollars attached at the end.
 *
 * ── Attribution is deliberately WEAK, and says so ──────────────────
 *
 * The honest ceiling on this data is lower than a marketing dashboard
 * would like to pretend. We can prove a send happened and prove a reply
 * arrived, because both are rows we own. We CANNOT prove that an order
 * three weeks later was caused by an email — the client may have called
 * Jose, seen us on a friend's job, or been coming back anyway.
 *
 * So the later stages are counted as INFLUENCED, not caused: the contact
 * was mailed, and then a thing happened within the attribution window.
 * Every number past `replied` carries that caveat in its label, because
 * a funnel that quietly implies causation is how a team talks itself
 * into believing a channel works.
 *
 * ── Why there is no data yet, and why that is fine ────────────────
 *
 * Sending is closed until the outreach subdomain is warmed (Phase 2), so
 * every figure here is zero on the day this ships. The scoreboard exists
 * now so the first campaign is measured from its first hour rather than
 * reconstructed afterwards from memory.
 */

import { prisma } from '@/lib/prisma'
import { OUTREACH_LABEL_PREFIX } from '@/lib/outreach/sendGuard'

/** How long after a touch we still credit it with influence. */
export const ATTRIBUTION_WINDOW_DAYS = 30

export interface FunnelStage {
  key: string
  label: string
  value: number
  /** True when the number is influence, not proof of cause. */
  influenced?: boolean
  note?: string
}

export interface ScoreboardResult {
  generatedAt: string
  windowDays: number
  /** Null when nothing has ever been sent — the UI says so plainly. */
  firstSendAt: string | null
  funnel: FunnelStage[]
  byRep: { userId: string; name: string; sent: number; replied: number }[]
  deliverability: { delivered: number; bounced: number; complained: number; bounceRate: number | null }
  influencedRevenue: number
}

export async function buildScoreboard(now: Date = new Date()): Promise<ScoreboardResult> {
  const windowStart = new Date(now.getTime() - ATTRIBUTION_WINDOW_DAYS * 86_400_000)

  // Everything outreach ever sent, identified by the label prefix every
  // outreach path stamps (campaigns AND touch plans).
  const deliveries = await prisma.emailDelivery.findMany({
    where: { label: { startsWith: OUTREACH_LABEL_PREFIX } },
    select: { toAddress: true, status: true, sentAt: true, label: true },
  })

  const sent = deliveries.length
  const firstSendAt = deliveries.reduce<Date | null>(
    (min, d) => (!min || d.sentAt < min ? d.sentAt : min),
    null,
  )

  const delivered = deliveries.filter((d) => d.status === 'DELIVERED').length
  const bounced = deliveries.filter((d) => d.status === 'BOUNCED').length
  const complained = deliveries.filter((d) => d.status === 'COMPLAINED').length

  // ── Replies. Provable: inbound mail from an address we mailed, after
  // we mailed it. Counted per PERSON, not per message — five replies
  // from one producer is one conversation, not five wins.
  const mailedAddresses = Array.from(new Set(deliveries.map((d) => d.toAddress.toLowerCase())))
  const earliestSendByAddress = new Map<string, Date>()
  for (const d of deliveries) {
    const key = d.toAddress.toLowerCase()
    const prior = earliestSendByAddress.get(key)
    if (!prior || d.sentAt < prior) earliestSendByAddress.set(key, d.sentAt)
  }

  let replied = 0
  if (mailedAddresses.length > 0) {
    const inbound = await prisma.emailMessage.findMany({
      where: {
        direction: 'inbound',
        duplicateOfId: null,
        sentAt: { gte: firstSendAt ?? windowStart },
      },
      select: { fromAddress: true, sentAt: true },
    })
    const repliedSet = new Set<string>()
    for (const m of inbound) {
      const bare = (m.fromAddress.match(/<([^>]+)>/)?.[1] ?? m.fromAddress).toLowerCase().trim()
      const firstTouch = earliestSendByAddress.get(bare)
      if (firstTouch && m.sentAt > firstTouch) repliedSet.add(bare)
    }
    replied = repliedSet.size
  }

  // ── Influenced stages. A mailed contact, then a thing, inside the
  // window. Not proof — see the header.
  const mailedPeople = mailedAddresses.length
    ? await prisma.person.findMany({
        where: { email: { in: mailedAddresses } },
        select: { id: true, email: true },
      })
    : []
  const mailedPersonIds = mailedPeople.map((p) => p.id)

  const [inquiries, orders] = await Promise.all([
    mailedPersonIds.length
      ? prisma.inquiry.count({
          where: { personId: { in: mailedPersonIds }, createdAt: { gte: windowStart } },
        })
      : Promise.resolve(0),
    mailedPersonIds.length
      ? prisma.order.findMany({
          where: {
            createdAt: { gte: windowStart },
            company: { affiliations: { some: { personId: { in: mailedPersonIds }, isCurrent: true } } },
          },
          select: { id: true, total: true, status: true },
        })
      : Promise.resolve([]),
  ])

  const quoted = orders.length
  const booked = orders.filter((o) => o.status !== 'CANCELLED' && o.status !== 'DRAFT').length
  const influencedRevenue = orders
    .filter((o) => o.status !== 'CANCELLED' && o.status !== 'DRAFT')
    .reduce((sum, o) => sum + Number(o.total ?? 0), 0)

  // ── Per rep, off the label's userId segment.
  const byRepMap = new Map<string, number>()
  for (const d of deliveries) {
    const parts = (d.label ?? '').slice(OUTREACH_LABEL_PREFIX.length).split(':')
    const userId = parts[0]
    if (userId) byRepMap.set(userId, (byRepMap.get(userId) ?? 0) + 1)
  }
  const repUsers = byRepMap.size
    ? await prisma.user.findMany({
        where: { id: { in: [...byRepMap.keys()] } },
        select: { id: true, name: true, email: true },
      })
    : []
  const byRep = repUsers.map((u) => ({
    userId: u.id,
    name: u.name ?? u.email,
    sent: byRepMap.get(u.id) ?? 0,
    // Per-rep reply attribution needs per-rep recipient sets; the
    // aggregate reply count is the honest number today, so this stays 0
    // rather than inventing a split.
    replied: 0,
  }))

  return {
    generatedAt: now.toISOString(),
    windowDays: ATTRIBUTION_WINDOW_DAYS,
    firstSendAt: firstSendAt ? firstSendAt.toISOString() : null,
    funnel: [
      { key: 'sent', label: 'Sent', value: sent },
      { key: 'delivered', label: 'Delivered', value: delivered, note: 'Confirmed by the provider' },
      { key: 'replied', label: 'Replied', value: replied, note: 'Distinct people who wrote back' },
      {
        key: 'inquiry', label: 'Inquiries', value: inquiries, influenced: true,
        note: `An inquiry from a mailed contact within ${ATTRIBUTION_WINDOW_DAYS} days`,
      },
      {
        key: 'quoted', label: 'Quoted', value: quoted, influenced: true,
        note: 'Their company was quoted in the window',
      },
      {
        key: 'booked', label: 'Booked', value: booked, influenced: true,
        note: 'Not proof the email caused it',
      },
    ],
    byRep,
    deliverability: {
      delivered,
      bounced,
      complained,
      bounceRate: sent > 0 ? bounced / sent : null,
    },
    influencedRevenue,
  }
}
