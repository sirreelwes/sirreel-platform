/**
 * Tell the driver when the vehicle under them changes, or when either end
 * of the handoff stops being attended. The database half; the rule, the
 * words and the story are in ./driverNoticeRule.
 *
 * Jose 2026-09-18: "I just changed it to P10 and made it Blind pick up.
 * Will driver get updated vehicle info and instructions for Blind pick
 * up?" His page did — the driver page is recomputed on every open and the
 * swap re-points the DriverAssignment. His INBOX did not: the invite's
 * `unattendedPickup` is computed once, at send time.
 *
 * ── Four properties, all deliberate ───────────────────────────────
 *
 * 1. THE TOKEN IS NOT RE-MINTED. `inviteDriver` upserts a fresh token,
 *    which kills the link the driver may already have open or bookmarked.
 *    A change notice has no business revoking their access, so this reads
 *    the existing `DriverAssignment.token` and sends the same URL. That is
 *    the whole reason this is not just a re-invite.
 *
 * 2. BEST-EFFORT, ALWAYS. The swap and the blind toggle are the act; a
 *    Resend outage or an opted-out number must never roll one back or
 *    500 the route. Every send is wrapped, every failure is reported back
 *    to the rep rather than thrown.
 *
 * 3. NOTHING CHANGED, NOTHING SENT. `driverChanges` returns empty for a
 *    re-pick of the same unit or a write of the value already stored, so
 *    a rep flipping a chip twice does not reach a stranger's phone.
 *
 * 4. A FINISHED JOB IS SILENT. Same guard as the invite
 *    (jobs/clientAskGuard) — nothing rental-time goes out to a driver
 *    about a job whose trucks are back.
 *
 * "Sent" is an AuditLog row (`driver_assignment.change_notified`), not a
 * column — the job-welcome pattern. The row carries who it went to and
 * what changed, never the token and never the body.
 */

import { prisma } from '@/lib/prisma'
import { blindHandoffForAssignment, type JobBlindState } from '@/lib/fleet/blindHandoff'
import { loadClientAskBlock } from '@/lib/jobs/clientAskGuard'
import { sendAgreementEmail } from '@/lib/email/sendAgreementEmail'
import { buildDriverChangeNoticeEmail } from '@/lib/email/templates/driverChangeNotice'
import { sendTracked } from '@/lib/sms/threads'
import {
  driverChanges,
  driverNoticeSms,
  noticeRoute,
  noticeSignature,
  type DriverChange,
  type DriverNoticeFacts,
  type DriverNoticeOutcome,
} from './driverNoticeRule'

export * from './driverNoticeRule'

/**
 * A repeat of the identical message inside this window is a double tap,
 * not a second change. Keyed on the RESULT (see `noticeSignature`), so
 * two different swaps in the same minute both go out.
 */
const DEDUPE_MINUTES = 10

export interface NotifyDriversArgs {
  /** The assignment as it now stands (the replacement, on a swap). */
  bookingAssignmentId: string
  /** True when this is a swap — pass it even if the old unit cannot be named. */
  vehicleChanged?: boolean
  /** The unit swapped out, when we can name it. */
  previousUnitName?: string | null
  /**
   * The effective blind flags BEFORE the change. Omit on a swap: the
   * override rides across with the assignment (assignUnit) and the order
   * layer is untouched, so neither edge moves.
   */
  before?: { blindPickup: boolean; blindReturn: boolean }
  actorUserId?: string | null
}

/**
 * Tell every live driver on one assignment what changed. Returns one
 * outcome per driver so the rep is told exactly who was reached and how
 * — an empty array means there was nobody to tell, which is different
 * from a send that failed.
 */
export async function notifyDriversOfChange(args: NotifyDriversArgs): Promise<DriverNoticeOutcome[]> {
  const asg = await prisma.bookingAssignment.findUnique({
    where: { id: args.bookingAssignmentId },
    select: {
      id: true,
      startDate: true,
      asset: { select: { unitName: true } },
      bookingItem: {
        select: {
          booking: { select: { jobId: true, jobName: true, company: { select: { name: true } } } },
        },
      },
      driverAssignments: {
        where: { status: { not: 'CANCELLED' } },
        select: {
          id: true,
          token: true,
          emailSentTo: true,
          smsSentTo: true,
          driver: { select: { firstName: true, lastName: true, email: true, phone: true } },
        },
      },
    },
  })
  if (!asg || asg.driverAssignments.length === 0) return []

  const booking = asg.bookingItem.booking
  // Nothing rental-time goes out about a job whose trucks are back.
  if (booking.jobId) {
    const block = await loadClientAskBlock(booking.jobId)
    if (block) return []
  }

  const now = await blindHandoffForAssignment(asg.id)
  const before = args.before ?? { blindPickup: now.blindPickup, blindReturn: now.blindReturn }
  const facts: DriverNoticeFacts = {
    // Explicit, not inferred: a swap whose outgoing asset we failed to
    // look up must still reach the driver. See driverNoticeRule.
    vehicleChanged: args.vehicleChanged ?? args.previousUnitName != null,
    previousUnitName: args.previousUnitName ?? null,
    unitName: asg.asset.unitName,
    productionName: booking.jobName ?? null,
    pickupDate: asg.startDate.toISOString().slice(0, 10),
    pickup: { before: before.blindPickup, now: now.blindPickup },
    dropoff: { before: before.blindReturn, now: now.blindReturn },
  }
  const changes = driverChanges(facts)
  if (changes.length === 0) return []

  const signature = noticeSignature(facts, changes)
  const base = process.env.NEXT_PUBLIC_PORTAL_URL || 'https://tsx.sirreel.com'

  const outcomes: DriverNoticeOutcome[] = []
  for (const da of asg.driverAssignments) {
    const driverName = `${da.driver.firstName} ${da.driver.lastName}`.trim() || 'the driver'
    try {
      if (await alreadyToldThem(da.id, signature)) {
        outcomes.push({
          driverAssignmentId: da.id,
          driverName,
          changes,
          channel: null,
          sentTo: null,
          status: 'duplicate',
        })
        continue
      }

      const route = noticeRoute({
        invitedByEmail: da.emailSentTo,
        invitedBySms: da.smsSentTo,
        email: da.driver.email,
        phone: da.driver.phone,
      })
      if (!route) {
        outcomes.push({
          driverAssignmentId: da.id,
          driverName,
          changes,
          channel: null,
          sentTo: null,
          status: 'unreachable',
          detail: 'no email or mobile on file',
        })
        continue
      }

      // Their EXISTING link — never re-minted. See property 1 above.
      const jobLink = `${base}/drive/${da.token}`
      let ok = false
      let detail: string | undefined

      if (route.channel === 'SMS') {
        // `staff` because a person pressed the button that caused this:
        // a 5am change must not be held until quiet hours end.
        const sms = await sendTracked({
          to: route.to,
          body: driverNoticeSms({ driverFirstName: da.driver.firstName, facts, changes, jobLink }),
          source: 'staff',
          jobId: booking.jobId ?? null,
          driverAssignmentId: da.id,
          sentById: args.actorUserId ?? null,
        })
        ok = sms.ok
        detail = sms.ok ? undefined : sms.error || sms.status
      } else {
        const mail = buildDriverChangeNoticeEmail({
          driverFirstName: da.driver.firstName,
          facts,
          changes,
          jobLink,
          companyName: booking.company?.name ?? null,
        })
        const res = await sendAgreementEmail({
          to: [route.to],
          subject: mail.subject,
          html: mail.html,
          text: mail.text,
          // Beside driver/assignment in EmailDelivery, so "did anyone tell
          // the driver?" is one filter away.
          label: 'driver/change-notice',
        })
        ok = res.ok
        detail = res.ok ? undefined : res.reason
      }

      await recordNotice({
        driverAssignmentId: da.id,
        actorUserId: args.actorUserId ?? null,
        signature,
        changes,
        facts,
        channel: route.channel,
        sentTo: route.to,
        ok,
        detail,
      })

      outcomes.push({
        driverAssignmentId: da.id,
        driverName,
        changes,
        channel: route.channel,
        sentTo: route.to,
        status: ok ? 'sent' : 'failed',
        detail,
      })
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err)
      console.error('[driverChangeNotice] send failed:', detail)
      outcomes.push({
        driverAssignmentId: da.id,
        driverName,
        changes,
        channel: null,
        sentTo: null,
        status: 'failed',
        detail,
      })
    }
  }
  return outcomes
}

/**
 * The blind-toggle entry point: diff a job's vehicles either side of the
 * write and tell the drivers on the units that actually moved. Vehicles
 * are matched by assignment id, so a job-wide toggle (which resets every
 * override) is read exactly like a per-vehicle one.
 */
export async function notifyDriversOfBlindChange(
  before: JobBlindState,
  after: JobBlindState,
  actorUserId?: string | null,
): Promise<DriverNoticeOutcome[]> {
  const was = new Map(before.vehicles.map((v) => [v.assignmentId, v.effective]))
  const out: DriverNoticeOutcome[] = []
  for (const v of after.vehicles) {
    const prior = was.get(v.assignmentId)
    if (!prior) continue // A unit that was not on the job before this write.
    if (prior.blindPickup === v.effective.blindPickup && prior.blindReturn === v.effective.blindReturn) continue
    try {
      out.push(
        ...(await notifyDriversOfChange({
          bookingAssignmentId: v.assignmentId,
          before: prior,
          actorUserId,
        })),
      )
    } catch (err) {
      console.error('[driverChangeNotice] blind diff failed:', err instanceof Error ? err.message : err)
    }
  }
  return out
}

/** Did this exact message go to this driver in the last few minutes? */
async function alreadyToldThem(driverAssignmentId: string, signature: string): Promise<boolean> {
  try {
    const since = new Date(Date.now() - DEDUPE_MINUTES * 60 * 1000)
    const prior = await prisma.auditLog.findFirst({
      where: {
        action: 'driver_assignment.change_notified',
        entityType: 'DriverAssignment',
        entityId: driverAssignmentId,
        createdAt: { gte: since },
      },
      orderBy: { createdAt: 'desc' },
      select: { newValues: true },
    })
    const prev = prior?.newValues as { signature?: string; sent?: boolean } | null
    // Only a message that actually WENT counts as already told — a failed
    // send must be retriable by pressing the thing again.
    return !!prev && prev.signature === signature && prev.sent === true
  } catch {
    // The dedupe is a courtesy; never let it stop the message.
    return false
  }
}

async function recordNotice(args: {
  driverAssignmentId: string
  actorUserId: string | null
  signature: string
  changes: DriverChange[]
  facts: DriverNoticeFacts
  channel: 'SMS' | 'EMAIL'
  sentTo: string
  ok: boolean
  detail?: string
}): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        userId: args.actorUserId,
        action: 'driver_assignment.change_notified',
        entityType: 'DriverAssignment',
        entityId: args.driverAssignmentId,
        newValues: {
          signature: args.signature,
          changes: args.changes,
          unit: args.facts.unitName,
          previousUnit: args.facts.previousUnitName ?? null,
          blindPickup: args.facts.pickup.now,
          blindReturn: args.facts.dropoff.now,
          channel: args.channel,
          // Who it went to. Never the token, never the body.
          sentTo: args.sentTo,
          sent: args.ok,
          ...(args.detail ? { error: args.detail } : {}),
        },
      },
    })
  } catch (err) {
    console.error('[driverChangeNotice] audit failed:', err instanceof Error ? err.message : err)
  }
}
