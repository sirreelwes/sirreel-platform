/**
 * Card-declined provider (DERIVED). Upcoming bookings whose client HAS a card
 * on file and it will not charge — refused by the bank, or expired.
 *
 * Wes, 2026-09-18, after "I don't understand how they were able to submit a
 * card that was declined": the client's portal stores an unapproved
 * authorization on purpose (the same write carries their signature), the desk
 * gets one AUTH_DECLINED email in the moment, and from then on nothing in HQ
 * says anything ever again. The client is now told at submit time and on
 * their next visit; this is the half that chases the ones who do not act.
 *
 * ── Why card-required could never cover this ───────────────────────────
 *
 * That provider's whole condition is NOT EXISTS — no portal card on any of
 * the job's paperwork rows, and nothing on the company wallet. A declined
 * card satisfies both existence checks, so it SILENCES the sibling item. The
 * dead card is the reason the job looks handled.
 *
 * The same blind spot is in `cardGateForJob`, which computes `onFile` from
 * existence alone and never reads `authRespStat`. **So the yard will release
 * this vehicle.** That is stated in the subtitle rather than fixed here:
 * teaching the gate to refuse would start stopping trucks at the dock, which
 * is Wes's call and not a side effect of an action item. Until it is made,
 * this row is the only thing standing between a refused card and a rental
 * that cannot be billed — which is why it reads the way it does.
 *
 * ── What it will not do ────────────────────────────────────────────────
 *
 * Fire on a card nobody checked. `isCardUsable` treats an unknown card as
 * fine, because most authorizations on this board live in Cognito or
 * RentalWorks and have no gateway answer in HQ at all (21 of 23 bookings,
 * measured 2026-09-06). A provider that flagged those would be wrong about
 * nearly every job and ignored by the second week.
 *
 * Nor fire when the client has ALREADY replaced it: the test is over every
 * card on the job and the company, so one good card anywhere clears the row
 * and the dead one is left alone on the account.
 *
 * Owner roles: sales-lifecycle → [ADMIN, MANAGER, AGENT], same as its
 * sibling. Billing cares about this too, but the person who chases a client
 * for a card is the rep who has their number.
 */

import type { UserRole } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import type { ActionItem, ActionItemProvider, ProviderContext } from '@/lib/actionItems/types'
import { PICKUP_WINDOW_DAYS } from '@/lib/actionItems/rules'
import { isExpiryPast } from '@/lib/payments/companyCards'
import { replacementNeeded, type CardUsability } from '@/lib/payments/cardAsk'

const OWNER: UserRole[] = ['ADMIN', 'MANAGER', 'AGENT']
const URGENT_DAYS = 3

interface Row {
  bookingId: string
  jobId: string | null
  jobName: string | null
  companyId: string | null
  companyName: string | null
  startDate: Date
  sentAt: Date | null
  sentTo: string | null
}

export const cardDeclinedProvider: ActionItemProvider = {
  id: 'card-declined',
  kind: 'DERIVED',
  async fetch(_ctx: ProviderContext): Promise<ActionItem[]> {
    // Same window and same live-booking predicate as card-required — the two
    // items are the two halves of one question and must agree on which
    // pickups are in scope.
    const rows = await prisma.$queryRaw<Row[]>`
      SELECT b.id AS "bookingId",
             b.job_id AS "jobId",
             b.job_name AS "jobName",
             b.company_id AS "companyId",
             c.name AS "companyName",
             b.start_date AS "startDate",
             pr.sent_at AS "sentAt",
             pr.sent_to AS "sentTo"
      FROM bookings b
      LEFT JOIN paperwork_requests pr ON pr.booking_id = b.id
      LEFT JOIN companies c ON c.id = b.company_id
      LEFT JOIN sr_jobs j ON j.id = b.job_id
      WHERE b.status NOT IN ('CANCELLED', 'ARCHIVED')
        AND b.archived_at IS NULL
        AND b.start_date >= CURRENT_DATE
        AND b.start_date <= CURRENT_DATE + ${PICKUP_WINDOW_DAYS}::int
        AND (j.status IS NULL OR j.status::text <> 'LOST')
      -- LEFT, not JOIN as card-required has it: a job can hold a bad card on
      -- the company WALLET with no paperwork request of its own (staff keyed
      -- it, and it has since expired). Requiring the request would miss those.
      -- The join can therefore yield several rows per booking, so the newest
      -- ask sorts first and the lead-per-job pass below takes it — "asked Nd
      -- ago" has to mean the last time we asked, not the first.
      ORDER BY b.start_date ASC, pr.sent_at DESC NULLS LAST
      LIMIT 200
    `
    if (rows.length === 0) return []

    // One row per JOB — a job with two bookings is one card to chase, and
    // the lead booking is the soonest pickup (the query is already sorted).
    const leads = new Map<string, Row>()
    for (const r of rows) {
      const key = r.jobId ?? r.bookingId
      if (!leads.has(key)) leads.set(key, r)
    }

    const jobIds = [...new Set([...leads.values()].map((r) => r.jobId).filter((v): v is string => !!v))]
    const companyIds = [...new Set([...leads.values()].map((r) => r.companyId).filter((v): v is string => !!v))]

    // Both stores, batched — never per job. The card a client authorized on
    // this job's paperwork, and every card on their company's wallet.
    const [portal, wallet] = await Promise.all([
      jobIds.length
        ? prisma.paperworkRequest.findMany({
            where: {
              ccCardNumberEncrypted: { not: null },
              booking: { jobId: { in: jobIds } },
            },
            select: {
              ccAuthRespStat: true,
              ccCardExpiry: true,
              ccCardLast4: true,
              booking: { select: { jobId: true } },
            },
          })
        : Promise.resolve([]),
      companyIds.length
        ? prisma.companyCard.findMany({
            where: { companyId: { in: companyIds }, removedAt: null },
            select: { companyId: true, authRespStat: true, expiry: true, last4: true },
          })
        : Promise.resolve([]),
    ])

    type Card = CardUsability & { last4: string | null }
    const byJob = new Map<string, Card[]>()
    const byCompany = new Map<string, Card[]>()
    for (const p of portal) {
      const jid = p.booking?.jobId
      if (!jid) continue
      const list = byJob.get(jid) ?? []
      list.push({
        authChecked: p.ccAuthRespStat != null,
        validated: p.ccAuthRespStat === 'A',
        expired: isExpiryPast(p.ccCardExpiry),
        last4: p.ccCardLast4,
      })
      byJob.set(jid, list)
    }
    for (const w of wallet) {
      const list = byCompany.get(w.companyId) ?? []
      list.push({
        authChecked: w.authRespStat != null,
        validated: w.authRespStat === 'A',
        expired: isExpiryPast(w.expiry),
        last4: w.last4,
      })
      byCompany.set(w.companyId, list)
    }

    const out: ActionItem[] = []
    for (const [key, r] of leads) {
      const cards = [
        ...(r.jobId ? byJob.get(r.jobId) ?? [] : []),
        ...(r.companyId ? byCompany.get(r.companyId) ?? [] : []),
      ]
      // Cards on file, and not one of them will charge. No cards at all is
      // card-required's row, not this one.
      if (!replacementNeeded(cards)) continue

      const days = Math.ceil((r.startDate.getTime() - Date.now()) / 86_400_000)
      const when =
        days <= 0
          ? 'today'
          : days === 1
            ? 'tomorrow'
            : r.startDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
      const who = r.companyName || r.jobName || 'client'

      // Name the card so the rep can say which one on the phone. The dead
      // card is usually the only one, and "····4242" is what the client sees
      // in their own portal.
      const dead = cards.find((c) => c.last4 != null) ?? cards[0]
      const which = dead?.last4 ? ` ····${dead.last4}` : ''
      // Every card here is unusable, so the reason is whichever applies to
      // the one we are naming — expired opens a different phone call than
      // refused. DECLINED outranks EXPIRED when a card is both, which is the
      // common shape (an expired card also fails the $0 check) and the same
      // precedence cardAskState uses, so the tile and this row cannot tell a
      // rep two different stories about one card.
      const reason =
        dead && dead.authChecked === true && dead.validated === false
          ? 'was declined'
          : 'has expired'

      // How long they have had the ask. `sentAt` is when the card link last
      // went out on this booking; a re-send moves it, which is right — the
      // question is how long since we last asked, not since the first time.
      const askedDays =
        r.sentAt != null ? Math.floor((Date.now() - r.sentAt.getTime()) / 86_400_000) : null
      const asked =
        askedDays == null
          ? 'no card link on this booking'
          : askedDays <= 0
            ? 'asked today'
            : `asked ${askedDays}d ago${r.sentTo ? ` (${r.sentTo})` : ''}`

      out.push({
        id: `card-declined:${key}`,
        type: 'card_declined',
        title: `Card${which} ${reason} — ${who}`,
        subtitle: `${r.jobName || 'Job'} goes out ${when} · ${asked}, still no working card · the check-out only looks for a card on file, so the yard WILL release this one`,
        ownerRole: OWNER,
        priority: days <= URGENT_DAYS ? 'high' : 'medium',
        href: r.jobId ? `/jobs/${r.jobId}#card-auth` : '/jobs',
        // The record's own time is the ask, when there was one — the pickup
        // is what the row is labelled by (rules.ts, Wes 2026-09-17).
        occurredAt: r.sentAt ?? r.startDate,
        dueAt: r.startDate,
        source: 'card-declined',
        dismissal: { kind: 'sideRow' },
      })
    }
    return out
  },
}
