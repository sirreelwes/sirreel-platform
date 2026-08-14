/**
 * After-hours assistant — server-side verification + escalation.
 *
 * SECURITY MODEL: no code (gate or lockbox) EVER enters the AI prompt.
 * The model calls the verify tool with what the caller typed; THIS module
 * decides deterministically whether to release, and only a passing
 * verification puts a code into the tool result. Every attempt (released
 * or denied) is audit-logged and notifies the team inbox.
 *
 * VERIFICATION — factor-based. The caller proves who they are with a
 * combination of:
 *   • Job code   — the random per-job code shown on the client's Portal
 *                  v2 job page (Job.assistantAuthCode). The strong factor.
 *   • VIN last-4 — last four of an active vehicle's VIN (corroborating;
 *                  also pins WHICH vehicle for the lockbox code).
 *   • Driver name — token-match against the booking's contacts / checkout
 *                  drivers (corroborating; also the legacy factor).
 * Release bar (Phase 1, hard-coded — a future admin policy can tune it):
 *   (job code + [VIN last-4 OR name])  OR  (legacy: unit number + name).
 *
 * ON PASS we release two secrets, both behind the same bar:
 *   • Gate code   — the standing lot code (SiteSetting.gateCode).
 *   • Lockbox code — the per-vehicle code (Asset.accessCode) once the
 *                    specific vehicle is pinned.
 * Failures collapse to a single NOT_VERIFIED so the assistant never leaks
 * whether a job/vehicle exists or who is on a booking.
 */

import { prisma } from '@/lib/prisma'
import { sendAgreementEmail } from '@/lib/email/sendAgreementEmail'
import { sendSms } from '@/lib/sms/sendSms'

const TEAM_INBOX = 'rentals@sirreel.com'
// Copied on after-hours callbacks and emergency alerts so hq@ sees the whole
// inbound funnel in one place. rentals@ stays primary — this adds, it does
// not reroute.
const HQ_INBOX = process.env.HQ_NOTIFY_INBOX || 'hq@sirreel.com'
const GRACE_DAYS = 1

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

/** Strip everything but A–Z/0–9 and uppercase — for comparing codes/VINs. */
function normAlnum(s: string): string {
  return s.toUpperCase().replace(/[^A-Z0-9]/g, '')
}

type ResolvedAsset = {
  id: string
  unitName: string
  vin: string | null
  accessCode: string | null
  categoryName: string
}

export type ReleaseResult =
  | {
      result: 'RELEASED'
      jobName: string
      gateCode: string | null // the standing lot gate code; null = not on file
      lockboxCode: string | null // per-vehicle code; null = not resolved / none on file
      vehicle: string | null // unit name the lockbox code belongs to
      lockboxHint: 'OK' | 'NEED_VEHICLE' | 'AMBIGUOUS' | 'NO_CODE_ON_FILE'
      lockboxCandidates?: string[]
    }
  | {
      result: 'NOT_VERIFIED'
      /**
       * The VIN last-4 they gave matches an active SirReel vehicle, so they
       * are physically at one of our trucks even though we could not verify
       * their booking. NOT an authorization — a VIN is printed on the
       * windshield and is far too weak to release a gate code on. It only
       * means a real person is standing in our lot at 1am, which is worth a
       * human rather than a phone number.
       */
      atVehicle?: boolean
    }

/**
 * Does this VIN last-4 belong to an active SirReel vehicle?
 *
 * Deliberately independent of the job/vehicle resolution above. The driver
 * locked out on 2026-08-14 never got that far — with no job code there was
 * nothing to anchor on, so the VIN they DID have was never even looked at.
 * Whether someone is standing at our truck is knowable regardless.
 *
 * Filtered in memory: the fleet is small and a suffix match is not indexable.
 */
async function vehicleForVinLast4(vinLast4: string): Promise<{ id: string; unitName: string } | null> {
  if (!vinLast4 || vinLast4.length < 4) return null
  const assets = await prisma.asset.findMany({
    where: { isActive: true, vin: { not: null } },
    select: { id: true, unitName: true, vin: true },
  })
  const hit = assets.find((a) => a.vin && normAlnum(a.vin).endsWith(vinLast4))
  return hit ? { id: hit.id, unitName: hit.unitName } : null
}

export async function verifyAndRelease(input: {
  jobCode?: string | null
  vehicleNumber?: string | null
  vinLast4?: string | null
  driverName?: string | null
  ip: string
}): Promise<ReleaseResult> {
  const jobCodeRaw = input.jobCode?.trim() || ''
  const vehicleNumber = input.vehicleNumber?.trim() || ''
  const vinLast4 = normAlnum(input.vinLast4 || '').slice(-4)
  const driverName = input.driverName?.trim() || ''
  const ip = input.ip

  const audit = async (action: string, extra: Record<string, unknown>) => {
    try {
      await prisma.auditLog.create({
        data: {
          userId: null,
          ipAddress: ip,
          action,
          entityType: 'Asset',
          entityId: (extra.assetId as string) ?? 'unresolved',
          oldValues: {
            jobCodeProvided: Boolean(jobCodeRaw),
            vehicleNumber: vehicleNumber || null,
            vinLast4: vinLast4 || null,
            driverName: driverName || null,
          },
          newValues: { ...extra, at: new Date().toISOString() },
        },
      })
    } catch (err) {
      console.error('[after-hours] audit write failed:', err)
    }
  }

  // ── 1. Resolve the job from the job code (the strong factor) ──
  let jobId: string | null = null
  let jobCodeOk = false
  if (jobCodeRaw) {
    // Job codes are 5-digit numbers — strip whatever the caller added around them.
    const digits = jobCodeRaw.replace(/\D/g, '')
    if (digits.length === 5) {
      const hit = await prisma.job.findUnique({
        where: { assistantAuthCode: digits },
        select: { id: true },
      })
      if (hit) {
        jobId = hit.id
        jobCodeOk = true
      }
    }
  }

  // ── 2. Optionally resolve candidate vehicles by unit number ──
  let matchedAssetIds: string[] | null = null
  if (vehicleNumber) {
    const tokens = normTokens(vehicleNumber)
    const digits = tokens.find((t) => /^\d+$/.test(t)) ?? null
    const assets = await prisma.asset.findMany({
      where: {
        isActive: true,
        ...(digits
          ? { unitName: { contains: digits } }
          : { unitName: { contains: vehicleNumber, mode: 'insensitive' } }),
      },
      select: { id: true, unitName: true },
    })
    // Digit containment over-matches ("2" hits 12/20/…) — require exact
    // trailing number when digits were given.
    const matched = digits
      ? assets.filter((a) => a.unitName.match(/(\d+)\s*$/)?.[1] === digits)
      : assets
    matchedAssetIds = matched.map((a) => a.id)
  }

  const vehicleResolvedLegacy = Boolean(matchedAssetIds && matchedAssetIds.length)

  // Nothing to anchor on → can't verify.
  if (!jobId && !vehicleResolvedLegacy) {
    // Check the VIN even though nothing anchored — this is precisely the
    // case that stranded a driver: correct VIN, no job code, dead end.
    const atVehicle = Boolean(await vehicleForVinLast4(vinLast4))
    await audit('public.access_denied', {
      reason: 'no_resolvable_job_or_vehicle',
      vinLast4Ok: vinLast4 ? atVehicle : undefined,
      atVehicle,
    })
    return { result: 'NOT_VERIFIED', atVehicle }
  }

  // ── 3. Find active assignments for the anchor (job and/or vehicle) ──
  const today = new Date()
  today.setUTCHours(0, 0, 0, 0)
  const graceStart = new Date(today)
  graceStart.setUTCDate(graceStart.getUTCDate() + GRACE_DAYS)
  const graceEnd = new Date(today)
  graceEnd.setUTCDate(graceEnd.getUTCDate() - GRACE_DAYS)

  const assignments = await prisma.bookingAssignment.findMany({
    where: {
      status: { in: ['ASSIGNED', 'CHECKED_OUT'] },
      startDate: { lte: graceStart },
      endDate: { gte: graceEnd },
      ...(matchedAssetIds && matchedAssetIds.length ? { assetId: { in: matchedAssetIds } } : {}),
      bookingItem: {
        booking: {
          status: { notIn: ['CANCELLED', 'ARCHIVED'] },
          archivedAt: null,
          ...(jobId ? { jobId } : {}),
        },
      },
    },
    select: {
      assetId: true,
      asset: {
        select: {
          id: true,
          unitName: true,
          vin: true,
          accessCode: true,
          category: { select: { name: true } },
        },
      },
      bookingItem: {
        select: {
          booking: {
            select: {
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
      checkoutRecords: { select: { driver: { select: { firstName: true, lastName: true } } } },
    },
  })

  if (assignments.length === 0) {
    await audit('public.access_denied', { reason: 'no_active_rental', jobCodeOk })
    // A correct job code with no live window is a real person worth a heads-up.
    if (jobCodeOk) await notifyDenied(ip, 'no active rental window', { jobCodeOk, vinLast4Ok: false, nameOk: false })
    return { result: 'NOT_VERIFIED' }
  }

  // ── 4. Evaluate corroborating factors over the active set ──
  const assetsById = new Map<string, ResolvedAsset>()
  for (const a of assignments) {
    assetsById.set(a.asset.id, {
      id: a.asset.id,
      unitName: a.asset.unitName,
      vin: a.asset.vin,
      accessCode: a.asset.accessCode,
      categoryName: a.asset.category.name,
    })
  }
  const assets = [...assetsById.values()]

  const vinMatches = vinLast4
    ? assets.filter((a) => a.vin && normAlnum(a.vin).endsWith(vinLast4))
    : []
  const vinLast4Ok = vinMatches.length > 0

  let nameOk = false
  if (driverName) {
    for (const asg of assignments) {
      const b = asg.bookingItem.booking
      const cands: string[] = []
      if (b.person) cands.push(`${b.person.firstName ?? ''} ${b.person.lastName ?? ''}`)
      for (const jc of b.job?.jobContacts ?? []) {
        cands.push(`${jc.person.firstName ?? ''} ${jc.person.lastName ?? ''}`)
      }
      for (const cr of asg.checkoutRecords) {
        if (cr.driver) cands.push(`${cr.driver.firstName} ${cr.driver.lastName}`)
      }
      if (cands.some((c) => nameMatches(driverName, c))) {
        nameOk = true
        break
      }
    }
  }

  // Release bar. Job code is the strong factor; it needs one corroborator.
  // The legacy unit+name path stays open for a substitute returner who
  // wasn't handed the job code.
  const authed =
    (jobCodeOk && (vinLast4Ok || nameOk)) || (!jobCodeOk && vehicleResolvedLegacy && nameOk)

  if (!authed) {
    // vinLast4Ok above is scoped to the assignments we resolved; this asks the
    // broader question of whether the VIN is one of ours at all.
    const atVehicle = vinLast4Ok || Boolean(await vehicleForVinLast4(vinLast4))
    await audit('public.access_denied', {
      reason: 'insufficient_factors',
      jobCodeOk,
      vinLast4Ok,
      nameOk,
      atVehicle,
    })
    await notifyDenied(ip, 'insufficient factors', { jobCodeOk, vinLast4Ok, nameOk })
    return { result: 'NOT_VERIFIED', atVehicle }
  }

  const booking0 = assignments[0].bookingItem.booking
  const jobName = booking0.job?.name ?? booking0.jobName ?? 'your job'

  // ── 5. Resolve releasables ──
  // Gate code — the lot-level singleton.
  const settings = await prisma.siteSetting.findFirst({ select: { gateCode: true } })
  const gateCode = settings?.gateCode?.trim() || null

  // Lockbox — pin exactly one vehicle. Prefer the VIN-matched asset, else
  // the unit-number match, else (job-code path) the job's active vehicles.
  const lockboxCandidates: ResolvedAsset[] = vinMatches.length
    ? vinMatches
    : vehicleResolvedLegacy
      ? assets.filter((a) => matchedAssetIds!.includes(a.id))
      : assets

  let target: ResolvedAsset | null = null
  let lockboxHint: 'OK' | 'NEED_VEHICLE' | 'AMBIGUOUS' | 'NO_CODE_ON_FILE' = 'OK'
  let lockboxCode: string | null = null
  if (lockboxCandidates.length === 1) {
    target = lockboxCandidates[0]
    lockboxCode = target.accessCode?.trim() || null
    if (!lockboxCode) lockboxHint = 'NO_CODE_ON_FILE'
  } else if (lockboxCandidates.length === 0) {
    lockboxHint = 'NEED_VEHICLE'
  } else {
    lockboxHint = 'AMBIGUOUS'
  }

  const verifiedBy = [jobCodeOk && 'job code', vinLast4Ok && 'VIN last-4', nameOk && 'driver name']
    .filter(Boolean)
    .join(' + ')

  await audit('public.access_released', {
    assetId: target?.id ?? 'gate-only',
    releasedGate: Boolean(gateCode),
    releasedLockbox: Boolean(lockboxCode),
    vehicle: target?.unitName ?? null,
    jobName,
    verifiedBy,
  })
  await notifyTeam(`After-hours access released — ${jobName}`, [
    `Access released via the site assistant for ${jobName}.`,
    `Gate code: ${gateCode ? 'released' : 'NOT on file'} · Lockbox (${target?.unitName ?? 'n/a'}): ${
      lockboxCode ? 'released' : lockboxHint
    }.`,
    `Verified by: ${verifiedBy}. IP: ${ip}.`,
    `The codes themselves are not repeated in this email.`,
  ])

  return {
    result: 'RELEASED',
    jobName,
    gateCode,
    lockboxCode,
    vehicle: target?.unitName ?? null,
    lockboxHint,
    ...(lockboxHint === 'AMBIGUOUS'
      ? { lockboxCandidates: lockboxCandidates.map((a) => `${a.unitName} (${a.categoryName})`) }
      : {}),
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

export type AlertResult =
  | { result: 'ALERTED'; texted: number; oncall: number }
  | { result: 'NO_ONCALL' }

/**
 * Emergency escalation — invoked by the assistant ONLY when a caller declares a
 * genuine emergency. We do NOT hand agents' numbers to the caller; instead we
 * TEXT the on-call agents the caller's request so they can review it and decide
 * whether to call back. Falls back to an email alert when SMS (Twilio) isn't
 * configured. Every escalation is audited + emails the team.
 */
export async function alertOnCallTeam(input: {
  callerName: string
  callbackNumber: string
  emergency: string
  ip: string
}): Promise<AlertResult> {
  const agents = await prisma.user.findMany({
    where: { isEmergencyContact: true, isActive: true, emergencyPhone: { not: null } },
    select: { name: true, emergencyPhone: true },
  })
  const oncall = agents
    .map((a) => ({ name: a.name, phone: (a.emergencyPhone ?? '').trim() }))
    .filter((a) => a.phone)

  const caller = input.callerName?.trim() || 'a caller'
  const cb = input.callbackNumber?.trim() || 'no number given'
  const what = (input.emergency || '').trim().slice(0, 400) || '(no details)'

  if (oncall.length === 0) {
    await notifyTeam('⚠ After-hours emergency — NO on-call contacts set', [
      `A caller reported an emergency but NO on-call agents are configured in /admin/assistant.`,
      `Caller: ${caller} · callback: ${cb}`,
      `Emergency: ${what}`,
      `IP: ${input.ip}.`,
    ])
    return { result: 'NO_ONCALL' }
  }

  const sms = `SirReel after-hours EMERGENCY. ${caller} (${cb}): "${what}". Call the caller back only if this warrants it.`
  let texted = 0
  for (const a of oncall) {
    const r = await sendSms(a.phone, sms)
    if (r.ok) texted++
    else if (!r.skipped) console.error('[after-hours] SMS to', a.name, 'failed:', r.error)
  }

  // Always email the team as a record + fallback (esp. before SMS is live).
  await notifyTeam('⚠ After-hours EMERGENCY — on-call alerted', [
    `Caller: ${caller} · callback: ${cb}`,
    `Emergency: ${what}`,
    `On-call: ${oncall.map((a) => a.name).join(', ')}. SMS delivered ${texted}/${oncall.length}${texted === 0 ? ' (SMS not configured — email only)' : ''}.`,
    `IP: ${input.ip}.`,
  ])

  try {
    await prisma.auditLog.create({
      data: {
        userId: null,
        ipAddress: input.ip,
        action: 'public.emergency_escalation',
        entityType: 'User',
        entityId: 'emergency',
        oldValues: { caller, callback: cb, emergency: what },
        newValues: { oncall: oncall.length, texted, at: new Date().toISOString() },
      },
    })
  } catch (err) {
    console.error('[after-hours] emergency audit failed:', err)
  }

  return { result: 'ALERTED', texted, oncall: oncall.length }
}

export type StrandedResult =
  | { result: 'ALERTED'; texted: number; oncall: number }
  | { result: 'NO_ONCALL' }
  | { result: 'ALREADY_ALERTED' }

/** One escalation per vehicle per hour. */
const STRANDED_COOLDOWN_MINUTES = 60

/**
 * A driver is at one of our vehicles and cannot be verified — get them a
 * person.
 *
 * Separate from alertOnCallTeam deliberately. That path is for declared
 * emergencies and its SMS says EMERGENCY; sending lockouts through it would
 * either overstate them or, worse, train the on-call team to skim past the
 * word. This one says what it is: someone is at the lot and stuck.
 *
 * It releases NOTHING. A VIN is printed on the windshield, so it cannot
 * authorize anything on its own — it establishes presence, not permission.
 * The on-call agent decides what to do, which is exactly the judgement a
 * verification wall cannot make at 1am.
 *
 * Rate-limited per vehicle. The driver who prompted this tried three times in
 * four minutes; without a cooldown that is three sets of texts to the team.
 */
export async function alertStrandedDriver(input: {
  callerName?: string | null
  callbackNumber?: string | null
  vinLast4?: string | null
  note?: string | null
  ip: string
}): Promise<StrandedResult> {
  const vinLast4 = normAlnum(input.vinLast4 || '').slice(-4)
  const asset = await vehicleForVinLast4(vinLast4)
  // Presence is the entire basis for this escalation. Without a VIN that
  // matches one of ours, anyone on the internet could text the team at 3am.
  if (!asset) return { result: 'NO_ONCALL' }

  const since = new Date(Date.now() - STRANDED_COOLDOWN_MINUTES * 60_000)
  const recent = await prisma.auditLog.findFirst({
    where: { action: 'public.stranded_driver', entityId: asset.id, createdAt: { gte: since } },
    select: { id: true },
  })
  if (recent) return { result: 'ALREADY_ALERTED' }

  const agents = await prisma.user.findMany({
    where: { isEmergencyContact: true, isActive: true, emergencyPhone: { not: null } },
    select: { name: true, emergencyPhone: true },
  })
  const oncall = agents
    .map((a) => ({ name: a.name, phone: (a.emergencyPhone ?? '').trim() }))
    .filter((a) => a.phone)

  const caller = input.callerName?.trim() || 'A driver'
  const cb = input.callbackNumber?.trim() || 'no number given'
  const note = (input.note || '').trim().slice(0, 300)

  const lines = [
    `${caller} is at ${asset.unitName} and could not be verified by the after-hours assistant.`,
    `Callback: ${cb}`,
    ...(note ? [`They said: ${note}`] : []),
    `The VIN they gave matches ${asset.unitName}, so they are at the vehicle. No codes were released.`,
    `IP: ${input.ip}.`,
  ]

  if (oncall.length === 0) {
    await notifyTeam('⚠ Driver stuck at the lot — NO on-call contacts set', [
      ...lines,
      'No on-call agents are configured in /admin/assistant, so nobody was texted.',
    ])
    return { result: 'NO_ONCALL' }
  }

  const sms = `SirReel after-hours: ${caller} is at ${asset.unitName} and could NOT be verified for gate/lockbox codes. Callback ${cb}.${note ? ` "${note}"` : ''} No codes released.`
  let texted = 0
  for (const a of oncall) {
    const r = await sendSms(a.phone, sms)
    if (r.ok) texted++
    else if (!r.skipped) console.error('[after-hours] stranded SMS to', a.name, 'failed:', r.error)
  }

  await notifyTeam('Driver stuck at the lot — on-call alerted', [
    ...lines,
    `On-call: ${oncall.map((a) => a.name).join(', ')}. SMS delivered ${texted}/${oncall.length}${texted === 0 ? ' (SMS not configured — email only)' : ''}.`,
  ])

  try {
    await prisma.auditLog.create({
      data: {
        userId: null,
        ipAddress: input.ip,
        action: 'public.stranded_driver',
        entityType: 'Asset',
        entityId: asset.id,
        oldValues: { caller, callback: cb, note: note || null },
        newValues: { vehicle: asset.unitName, oncall: oncall.length, texted, at: new Date().toISOString() },
      },
    })
  } catch (err) {
    console.error('[after-hours] stranded audit failed:', err)
  }

  return { result: 'ALERTED', texted, oncall: oncall.length }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
}

async function notifyDenied(
  ip: string,
  reason: string,
  factors: { jobCodeOk: boolean; vinLast4Ok: boolean; nameOk: boolean },
): Promise<void> {
  await notifyTeam(`After-hours access DENIED`, [
    `An after-hours access request was DENIED (${reason}).`,
    `Factors matched — job code: ${factors.jobCodeOk ? 'yes' : 'no'}, VIN last-4: ${
      factors.vinLast4Ok ? 'yes' : 'no'
    }, driver name: ${factors.nameOk ? 'yes' : 'no'}.`,
    `IP: ${ip}. The assistant offered the callback path.`,
  ])
}

async function notifyTeam(subject: string, lines: string[]): Promise<void> {
  // Kill-switch for the build/testing phase — set ASSISTANT_SUPPRESS_NOTIFY=1
  // to avoid emailing rentals@ while we exercise the flow. Unset in prod so
  // the team is notified for real.
  if (process.env.ASSISTANT_SUPPRESS_NOTIFY === '1') {
    console.log(`[after-hours] notify suppressed (${subject})`)
    return
  }
  try {
    const result = await sendAgreementEmail({
      to: [TEAM_INBOX, HQ_INBOX],
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
