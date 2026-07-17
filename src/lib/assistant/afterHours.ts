/**
 * After-hours assistant — server-side verification + escalation.
 *
 * SECURITY MODEL: the vehicle access code NEVER enters the AI prompt.
 * The model calls the verify tool with what the caller typed; THIS
 * module decides deterministically whether the code is released, and
 * only a passing verification puts the code into the tool result.
 * Every attempt (released or denied) is audit-logged and notifies the
 * team inbox.
 *
 * VERIFICATION (mirrors the human agent script — "what job are you
 * on, which vehicle are you driving"):
 *   1. Vehicle: the stated unit resolves to exactly ONE active asset
 *      carrying a BookingAssignment whose window covers today (±1 day
 *      grace) on a non-cancelled booking.
 *   2. Name: the stated driver name token-matches a person attached to
 *      that booking — the booking contact, the job's contacts, or a
 *      driver on a checkout record for the assignment.
 *   3. Optional job-name tie-breaker when provided.
 * Match → code released (if one is on file). No match → the assistant
 * offers the callback path; nothing is revealed.
 */

import { prisma } from '@/lib/prisma'
import { sendAgreementEmail } from '@/lib/email/sendAgreementEmail'

const TEAM_INBOX = 'hello@sirreel.com'

function normTokens(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
}

/** Loose person-name match: every token of the shorter name appears in the longer. */
function nameMatches(provided: string, candidate: string): boolean {
  const p = normTokens(provided)
  const c = normTokens(candidate)
  if (p.length === 0 || c.length === 0) return false
  const [shorter, longer] = p.length <= c.length ? [p, c] : [c, p]
  return shorter.every((t) => longer.includes(t))
}

export type VerifyResult =
  | { result: 'RELEASED'; code: string; vehicle: string; jobName: string }
  | { result: 'NO_CODE_ON_FILE'; vehicle: string }
  | { result: 'VEHICLE_NOT_FOUND' }
  | { result: 'VEHICLE_AMBIGUOUS'; candidates: string[] }
  | { result: 'NO_ACTIVE_RENTAL'; vehicle: string }
  | { result: 'NAME_MISMATCH'; vehicle: string }

export async function verifyDriverForAccessCode(input: {
  driverName: string
  vehicleNumber: string
  jobName?: string | null
  ip: string
}): Promise<VerifyResult> {
  const { driverName, vehicleNumber, jobName, ip } = input

  const audit = async (action: string, extra: Record<string, unknown>) => {
    try {
      await prisma.auditLog.create({
        data: {
          userId: null,
          ipAddress: ip,
          action,
          entityType: 'Asset',
          entityId: (extra.assetId as string) ?? 'unresolved',
          oldValues: { driverName, vehicleNumber, jobName: jobName ?? null },
          newValues: { ...extra, at: new Date().toISOString() },
        },
      })
    } catch (err) {
      console.error('[after-hours] audit write failed:', err)
    }
  }

  // ── 1. Resolve the vehicle ──
  const tokens = normTokens(vehicleNumber)
  const digits = tokens.find((t) => /^\d+$/.test(t)) ?? null
  const assets = await prisma.asset.findMany({
    where: {
      isActive: true,
      ...(digits
        ? { unitName: { contains: digits } }
        : { unitName: { contains: vehicleNumber.trim(), mode: 'insensitive' } }),
    },
    select: { id: true, unitName: true, accessCode: true, category: { select: { name: true } } },
  })
  // Digit containment over-matches ("2" hits 12/20/…): require exact
  // trailing number when digits were given.
  const matched = digits
    ? assets.filter((a) => {
        const m = a.unitName.match(/(\d+)\s*$/)
        return m?.[1] === digits
      })
    : assets

  if (matched.length === 0) {
    await audit('public.access_code_denied', { reason: 'vehicle_not_found' })
    return { result: 'VEHICLE_NOT_FOUND' }
  }

  // ── 2. Find the active assignment window per candidate asset ──
  const today = new Date()
  today.setUTCHours(0, 0, 0, 0)
  const graceStart = new Date(today); graceStart.setUTCDate(graceStart.getUTCDate() + 1)
  const graceEnd = new Date(today); graceEnd.setUTCDate(graceEnd.getUTCDate() - 1)

  const assignments = await prisma.bookingAssignment.findMany({
    where: {
      assetId: { in: matched.map((a) => a.id) },
      status: { in: ['ASSIGNED', 'CHECKED_OUT'] },
      startDate: { lte: graceStart },
      endDate: { gte: graceEnd },
      bookingItem: { booking: { status: { notIn: ['CANCELLED', 'ARCHIVED'] }, archivedAt: null } },
    },
    select: {
      id: true,
      assetId: true,
      bookingItem: {
        select: {
          booking: {
            select: {
              id: true,
              jobName: true,
              person: { select: { firstName: true, lastName: true } },
              job: {
                select: {
                  name: true,
                  jobContacts: { select: { person: { select: { firstName: true, lastName: true } } } },
                },
              },
            },
          },
        },
      },
      checkoutRecords: {
        select: { driver: { select: { firstName: true, lastName: true } } },
      },
    },
  })

  if (assignments.length === 0) {
    await audit('public.access_code_denied', { reason: 'no_active_rental', assetId: matched[0].id })
    return { result: 'NO_ACTIVE_RENTAL', vehicle: matched[0].unitName }
  }

  // Multiple distinct assets active with the same number (e.g. Cargo 22
  // exists twice) → ask the model to clarify by category.
  const activeAssetIds = [...new Set(assignments.map((a) => a.assetId))]
  if (activeAssetIds.length > 1) {
    const names = matched
      .filter((a) => activeAssetIds.includes(a.id))
      .map((a) => `${a.unitName} (${a.category.name})`)
    await audit('public.access_code_denied', { reason: 'vehicle_ambiguous', candidates: names })
    return { result: 'VEHICLE_AMBIGUOUS', candidates: names }
  }

  const asset = matched.find((a) => a.id === activeAssetIds[0])!
  const assetAssignments = assignments.filter((a) => a.assetId === asset.id)

  // ── 3. Name (and optional job) check across the booking's people ──
  let matchedBooking: { jobName: string } | null = null
  for (const asg of assetAssignments) {
    const b = asg.bookingItem.booking
    if (jobName && jobName.trim()) {
      const jn = (b.job?.name ?? b.jobName ?? '').toLowerCase()
      if (!jn.includes(jobName.trim().toLowerCase()) && !jobName.trim().toLowerCase().includes(jn)) {
        // stated job doesn't match this booking — keep scanning others
      }
    }
    const candidates: string[] = []
    if (b.person) candidates.push(`${b.person.firstName ?? ''} ${b.person.lastName ?? ''}`)
    for (const jc of b.job?.jobContacts ?? []) {
      candidates.push(`${jc.person.firstName ?? ''} ${jc.person.lastName ?? ''}`)
    }
    for (const cr of asg.checkoutRecords) {
      if (cr.driver) candidates.push(`${cr.driver.firstName} ${cr.driver.lastName}`)
    }
    if (candidates.some((c) => nameMatches(driverName, c))) {
      matchedBooking = { jobName: b.job?.name ?? b.jobName }
      break
    }
  }

  if (!matchedBooking) {
    await audit('public.access_code_denied', { reason: 'name_mismatch', assetId: asset.id })
    await notifyTeam(`After-hours code DENIED — ${asset.unitName}`, [
      `Access-code request for ${asset.unitName} was DENIED (name mismatch).`,
      `Stated driver: ${driverName}${jobName ? ` · stated job: ${jobName}` : ''}`,
      `IP: ${ip}. The assistant offered the callback path.`,
    ])
    return { result: 'NAME_MISMATCH', vehicle: asset.unitName }
  }

  if (!asset.accessCode?.trim()) {
    await audit('public.access_code_denied', { reason: 'no_code_on_file', assetId: asset.id })
    await notifyTeam(`After-hours code request — no code on file for ${asset.unitName}`, [
      `${driverName} verified OK for ${asset.unitName} (${matchedBooking.jobName}) but NO access code is on file for the unit.`,
      `Set it in the vehicle summary panel. IP: ${ip}.`,
    ])
    return { result: 'NO_CODE_ON_FILE', vehicle: asset.unitName }
  }

  await audit('public.access_code_released', {
    assetId: asset.id,
    releasedFor: driverName,
    jobName: matchedBooking.jobName,
  })
  await notifyTeam(`After-hours code released — ${asset.unitName}`, [
    `Access code for ${asset.unitName} released to ${driverName} (${matchedBooking.jobName}) via the site assistant.`,
    `Verified: driver name matched the booking's contacts. IP: ${ip}.`,
    `The code itself is not repeated in this email.`,
  ])
  return {
    result: 'RELEASED',
    code: asset.accessCode.trim(),
    vehicle: asset.unitName,
    jobName: matchedBooking.jobName,
  }
}

/** Escalation: file an after-hours callback into the pipeline + notify. */
export async function fileAfterHoursCallback(input: {
  name: string
  contact: string
  message: string
  ip: string
}): Promise<{ ok: boolean }> {
  const name = input.name.trim().slice(0, 200) || 'Unknown caller'
  const contact = input.contact.trim().slice(0, 300)
  const message = input.message.trim().slice(0, 2000)
  try {
    await prisma.inquiry.create({
      data: {
        source: 'WEB_FORM',
        status: 'NEW',
        title: `After-hours assistant — ${name}`,
        description: `After-hours callback request via the site assistant.\n\nName: ${name}\nContact: ${contact}\nMessage: ${message}\nIP: ${input.ip}`,
      },
    })
    await notifyTeam(`After-hours callback — ${name}`, [
      `The site assistant filed an after-hours callback request.`,
      `Name: ${name}`,
      `Contact: ${contact}`,
      `Message: ${message}`,
    ])
    return { ok: true }
  } catch (err) {
    console.error('[after-hours] callback filing failed:', err)
    return { ok: false }
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
}

async function notifyTeam(subject: string, lines: string[]): Promise<void> {
  try {
    const result = await sendAgreementEmail({
      to: [TEAM_INBOX],
      subject,
      html: `<p>${lines.map(escapeHtml).join('<br/>')}</p>`,
      text: lines.join('\n'),
      label: 'after-hours-assistant',
    })
    if (!result.ok) console.error('[after-hours] team notify failed:', result.reason)
  } catch (err) {
    console.error('[after-hours] team notify threw:', err)
  }
}
