/**
 * After-hours VEHICLE pickup — the facts and the send.
 *
 * Sibling of sendAfterHoursAccess.ts, which handles gear in the storage
 * container. This one is for a truck or van a client's driver collects
 * from the lot when nobody is here: gate code + plate + the unit's own
 * lock box code, per vehicle on the job.
 *
 * Which vehicles: every live BookingAssignment on the job's live
 * bookings — the same set the job page's "Reserved assets" tile shows
 * (SWAPPED is a unit taken OFF the job; CANCELLED / ARCHIVED bookings
 * are not on it). The agent picks a subset in the panel; the default is
 * all of them.
 *
 * Read `afterHoursPayload` before adding a caller to `jobPickupVehicles`:
 * it returns lock box codes, and the entitlement check belongs to the
 * caller (a staff session, here). Never a portal or public read.
 */

import { prisma } from '@/lib/prisma'
import { pickPrimaryContact } from '@/lib/jobs/primaryContact'
import { afterHoursPayload } from '@/lib/afterHours/instructions'
import { sendAgreementEmail } from '@/lib/email/sendAgreementEmail'
import { withTeamCc, agentReplyTo } from '@/lib/email/teamVisibility'
import {
  buildVehiclePickupEmail,
  type VehiclePickupVehicle,
} from '@/lib/email/templates/vehiclePickup'

export const VEHICLE_PICKUP_AUDIT_ACTION = 'job.vehicle_pickup_sent'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
/** Free-typed extra recipients per send. Jose's went to three people. */
export const MAX_EXTRA_RECIPIENTS = 5

export interface PickupVehicle extends VehiclePickupVehicle {
  assetId: string
  startDate: string
  endDate: string
  status: string
}

/** @db.Date columns hold a UTC midnight — format in UTC or the day shifts. */
function fmtDay(d: Date): string {
  return d.toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' })
}

export async function jobPickupVehicles(jobId: string): Promise<PickupVehicle[]> {
  const rows = await prisma.bookingAssignment.findMany({
    where: {
      status: { not: 'SWAPPED' },
      bookingItem: {
        booking: {
          jobId,
          status: { notIn: ['CANCELLED', 'ARCHIVED'] },
          archivedAt: null,
        },
      },
    },
    orderBy: [{ startDate: 'asc' }, { createdAt: 'asc' }],
    select: {
      startDate: true,
      endDate: true,
      status: true,
      asset: {
        select: {
          id: true,
          unitName: true,
          licensePlate: true,
          accessCode: true,
          category: { select: { name: true } },
        },
      },
    },
  })
  // First-wins per asset, like the job page: the earliest live window is
  // the one a pickup email is about.
  const seen = new Map<string, PickupVehicle>()
  for (const r of rows) {
    if (seen.has(r.asset.id)) continue
    const start = fmtDay(r.startDate)
    const end = fmtDay(r.endDate)
    seen.set(r.asset.id, {
      assetId: r.asset.id,
      unitName: r.asset.unitName,
      category: r.asset.category?.name ?? null,
      licensePlate: r.asset.licensePlate?.trim() || null,
      lockboxCode: r.asset.accessCode?.trim() || null,
      window: start === end ? start : `${start} – ${end}`,
      startDate: r.startDate.toISOString(),
      endDate: r.endDate.toISOString(),
      status: r.status,
    })
  }
  return [...seen.values()].sort((a, b) =>
    a.unitName.localeCompare(b.unitName, undefined, { numeric: true }),
  )
}

export type VehiclePickupFailure =
  | 'job_not_found'
  | 'no_gate_code'
  | 'no_vehicles'
  | 'no_lockbox_code'
  | 'no_recipient'
  | 'send_failed'

export interface VehiclePickupSendResult {
  ok: boolean
  reason?: VehiclePickupFailure
  message?: string
  sentTo?: string[]
  vehicles?: string[]
}

export async function sendVehiclePickupInstructions(args: {
  jobId: string
  userId: string | null
  /** Job contact to address. Optional when `extraEmails` carries someone. */
  personId?: string | null
  /** Free-typed addresses — the driver, a second coordinator. */
  extraEmails?: string[]
  /** Subset of the job's live units. Empty / undefined = all of them. */
  assetIds?: string[]
  note?: string | null
}): Promise<VehiclePickupSendResult> {
  const job = await prisma.job.findUnique({
    where: { id: args.jobId },
    select: {
      id: true,
      name: true,
      agent: { select: { name: true, email: true, phone: true } },
      orders: {
        where: { status: { notIn: ['CANCELLED', 'CLOSED'] } },
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: { id: true },
      },
      jobContacts: {
        select: {
          role: true,
          isPrimary: true,
          person: { select: { id: true, firstName: true, lastName: true, email: true } },
        },
      },
    },
  })
  if (!job) return { ok: false, reason: 'job_not_found', message: 'Job not found.' }

  const { gateCode } = await afterHoursPayload()
  if (!gateCode) {
    return {
      ok: false,
      reason: 'no_gate_code',
      message:
        'The gate code is not on file, so the email would say there is none. Record it under Admin → Assistant first.',
    }
  }

  const all = await jobPickupVehicles(job.id)
  const wanted = args.assetIds?.length ? new Set(args.assetIds) : null
  const vehicles = wanted ? all.filter((v) => wanted.has(v.assetId)) : all
  if (vehicles.length === 0) {
    return {
      ok: false,
      reason: 'no_vehicles',
      message: all.length
        ? 'None of the selected units are on this job any more. Reload and pick again.'
        : 'No unit is reserved on this job yet. Assign the vehicle first — the email names the unit, its plate and its lock box code.',
    }
  }
  // A missing lock box code reads as "there is no lock box" to a driver at
  // 5am. Refuse and name the unit rather than send a dash.
  const noCode = vehicles.filter((v) => !v.lockboxCode)
  if (noCode.length) {
    return {
      ok: false,
      reason: 'no_lockbox_code',
      message: `${noCode.map((v) => v.unitName).join(', ')} ${
        noCode.length > 1 ? 'have' : 'has'
      } no lock box code on file. Record it on the unit under Fleet, or leave it out of this send.`,
    }
  }

  // Recipients: the chosen job contact (else the primary, when nobody was
  // typed in) plus any free-typed addresses, de-duplicated.
  const mailable = job.jobContacts.filter((c) => EMAIL_RE.test(c.person.email || ''))
  const extras = Array.from(
    new Set(
      (args.extraEmails ?? [])
        .map((e) => e.trim())
        .filter((e) => EMAIL_RE.test(e))
        .slice(0, MAX_EXTRA_RECIPIENTS),
    ),
  )
  const chosen = args.personId
    ? mailable.find((c) => c.person.id === args.personId) ?? null
    : extras.length
      ? null
      : pickPrimaryContact(mailable)
  if (args.personId && !chosen) {
    return {
      ok: false,
      reason: 'no_recipient',
      message: 'That contact has no valid email address on file.',
    }
  }
  const to = Array.from(
    new Set([chosen?.person.email, ...extras].filter((e): e is string => !!e)),
  )
  if (to.length === 0) {
    return {
      ok: false,
      reason: 'no_recipient',
      message: 'No contact on this job has a valid email address. Pick one or type an address.',
    }
  }

  const note = args.note?.trim() || null
  const tpl = buildVehiclePickupEmail({
    firstName: chosen?.person.firstName,
    projectName: job.name,
    gateCode,
    vehicles,
    note,
    repName: job.agent?.name || null,
    repPhone: job.agent?.phone || null,
    repEmail: job.agent?.email || null,
  })

  const cc = await withTeamCc([], to[0])
  const result = await sendAgreementEmail({
    label: 'job/vehicle-pickup',
    to,
    cc: cc.filter((c) => !to.includes(c)).length ? cc.filter((c) => !to.includes(c)) : undefined,
    // "Which van is mine?" has to reach the rep who sent it.
    replyTo: agentReplyTo(job.agent?.email) ?? undefined,
    subject: tpl.subject,
    html: tpl.html,
    text: tpl.text,
    orderId: job.orders[0]?.id ?? null,
  })
  if (!result.ok) {
    return {
      ok: false,
      reason: 'send_failed',
      message: 'Could not send the pickup instructions. Please try again.',
    }
  }

  await prisma.auditLog.create({
    data: {
      userId: args.userId,
      action: VEHICLE_PICKUP_AUDIT_ACTION,
      entityType: 'job',
      entityId: job.id,
      // Never the codes — they live on the Asset and in SiteSetting and
      // are changed there.
      newValues: {
        sentTo: to,
        vehicles: vehicles.map((v) => v.unitName),
        assetIds: vehicles.map((v) => v.assetId),
        hasNote: !!note,
      },
    },
  })

  return { ok: true, sentTo: to, vehicles: vehicles.map((v) => v.unitName) }
}

/** The last send on this job, for the card's "sent to X · when · by Y" line. */
export async function lastVehiclePickupSend(jobId: string): Promise<{
  at: string
  to: string[]
  vehicles: string[]
  by: string | null
} | null> {
  const row = await prisma.auditLog.findFirst({
    where: { action: VEHICLE_PICKUP_AUDIT_ACTION, entityType: 'job', entityId: jobId },
    orderBy: { createdAt: 'desc' },
    select: {
      createdAt: true,
      newValues: true,
      user: { select: { name: true, email: true } },
    },
  })
  if (!row) return null
  const nv = (row.newValues ?? {}) as { sentTo?: unknown; vehicles?: unknown }
  const strs = (x: unknown) => (Array.isArray(x) ? x.filter((s): s is string => typeof s === 'string') : [])
  return {
    at: row.createdAt.toISOString(),
    to: strs(nv.sentTo),
    vehicles: strs(nv.vehicles),
    by: row.user?.name || row.user?.email || null,
  }
}
