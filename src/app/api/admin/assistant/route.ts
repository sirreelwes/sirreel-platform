/**
 * /api/admin/assistant — after-hours Assistant control surface.
 * Guarded by requireAssistantAccess (ADMIN / AGENT / MANAGER).
 *
 *  GET  → standing gate code (+ who/when last recorded), the per-job auth
 *         codes, and the recent release/denial audit trail.
 *  POST → { action: 'set-gate-code', gateCode }        record the lot code
 *         { action: 'regenerate-job-code', jobId }      roll a job's code
 *
 * The standing gate code only RECORDS what's physically programmed at the
 * gate — saving here does not change the hardware. Every change stamps
 * who/when (the accidental-edit safeguard) and is audit-logged.
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAssistantAccess } from '@/lib/assistant/requireAssistantAccess'
import { generateAssistantAuthCode } from '@/lib/jobs/assistantAuthCode'
import { summarizeAssistantUsage } from '@/lib/assistant/usageSummary'
import { resolveTwilioConfig } from '@/lib/sms/sendSms'
import { listRecognizedNumbers } from '@/lib/assistant/recognizedNumbers'
import { phoneTail } from '@/lib/assistant/phoneFactor'
import { levelForRole } from '@/lib/assistant/access'
import { firstNameOf } from '@/lib/assistant/greeting'

export const dynamic = 'force-dynamic'
const SINGLETON = 'singleton'

export async function GET() {
  const gate = await requireAssistantAccess()
  if (gate instanceof NextResponse) return gate

  const s = await prisma.siteSetting.findUnique({
    where: { id: SINGLETON },
    select: {
      gateCode: true, gateCodeUpdatedAt: true, gateCodeUpdatedById: true,
      containerCode: true, containerCodeUpdatedAt: true,
      lockboxInstructionsUrl: true,
    },
  })

  let gateCodeUpdatedBy: string | null = null
  if (s?.gateCodeUpdatedById) {
    const u = await prisma.user.findUnique({
      where: { id: s.gateCodeUpdatedById },
      select: { name: true, email: true },
    })
    gateCodeUpdatedBy = u?.name || u?.email || null
  }

  const jobs = await prisma.job.findMany({
    select: {
      id: true,
      jobCode: true,
      name: true,
      assistantAuthCode: true,
      status: true,
      // Job dates were dropped 2026-08-31 — derived from what is
      // scheduled. See src/lib/jobs/dateRange.
      orders: { select: { startDate: true, endDate: true, status: true } },
      bookings: { select: { startDate: true, endDate: true, status: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 200,
  })

  const audit = await prisma.auditLog.findMany({
    where: {
      action: {
        in: [
          'public.access_released',
          'public.access_denied',
          'public.emergency_escalation',
          'public.stranded_driver',
        ],
      },
    },
    orderBy: { createdAt: 'desc' },
    take: 30,
    select: { id: true, action: true, createdAt: true, ipAddress: true, newValues: true },
  })

  // Usage summary reads a wider window than the 30-row log below it. The log
  // answers "what happened last"; this answers "is this working at all",
  // which the log cannot — five of the first seven attempts were denials and
  // nothing on this page said so.
  const usageEvents = await prisma.auditLog.findMany({
    where: {
      action: {
        in: [
          'public.access_released',
          'public.access_denied',
          'public.emergency_escalation',
          'public.stranded_driver',
        ],
      },
    },
    orderBy: { createdAt: 'desc' },
    take: 500,
    select: { action: true, createdAt: true, ipAddress: true, newValues: true },
  })
  const usage = summarizeAssistantUsage(usageEvents)

  const twilio = resolveTwilioConfig()

  // The roster of numbers AHA recognises, read from the same facts the live
  // checks read. Never fails the page: an empty list with a note beats a 500.
  const recognized = await listRecognizedNumbers().catch((err) => { console.error('[admin/assistant] recognized roster failed:', err); return [] })

  const emergencyContacts = await prisma.user.findMany({
    where: { isActive: true, role: { in: ['ADMIN', 'AGENT', 'MANAGER'] } },
    orderBy: [{ isEmergencyContact: 'desc' }, { name: 'asc' }],
    select: { id: true, name: true, role: true, isEmergencyContact: true, emergencyPhone: true, phone: true },
  })

  return NextResponse.json({
    gateCode: s?.gateCode ?? '',
    gateCodeUpdatedAt: s?.gateCodeUpdatedAt ?? null,
    gateCodeUpdatedBy,
    containerCode: s?.containerCode ?? '',
    containerCodeUpdatedAt: s?.containerCodeUpdatedAt ?? null,
    lockboxInstructionsUrl: s?.lockboxInstructionsUrl ?? '',
    jobs,
    audit,
    usage,
    emergencyContacts,
    // sendSms no-ops when Twilio is unconfigured, so every "we texted the
    // on-call team" quietly becomes an email to hq@. The page claims a text
    // was sent; only the server knows whether one could be. The REASON is
    // returned too — "not set up" and "the SID is the wrong one" need
    // different actions, and guessing between them costs an evening.
    smsConfigured: twilio.config !== null,
    smsProblem: twilio.config === null ? twilio.reason : null,
    recognized,
    // The signed-in user's own AHA level, for the "Ask AHA as yourself" panel
    // and to gate the add/remove controls (admin only).
    me: { level: levelForRole(String(gate.user.role)), firstName: firstNameOf(gate.user.name), isAdmin: gate.user.role === 'ADMIN' },
  })
}

export async function POST(req: NextRequest) {
  const gate = await requireAssistantAccess()
  if (gate instanceof NextResponse) return gate

  const body = (await req.json().catch(() => null)) as
    | {
        action?: string; gateCode?: string; containerCode?: string; lockboxInstructionsUrl?: string; jobId?: string; userId?: string; isEmergencyContact?: boolean; emergencyPhone?: string; phone?: string
        name?: string; level?: string; note?: string; jobCode?: string; grantId?: string
      }
    | null
  if (!body?.action) return NextResponse.json({ error: 'action required' }, { status: 400 })

  // ── Add a person to (or take one off) the AHA list by hand ──
  // Wes 2026-09-11. One active row per number: adding again replaces. Rows
  // are never deleted — revoked, so the history says who granted what.
  const GRANTS_MISSING = 'The AHA grants table is not in the database yet — run `npx prisma db push` (see docs), then try again.'
  if (body.action === 'add-grant') {
    if (gate.user.role !== 'ADMIN') return NextResponse.json({ error: 'only an admin can change the AHA list' }, { status: 403 })
    const name = typeof body.name === 'string' ? body.name.trim().slice(0, 120) : ''
    const phone = typeof body.phone === 'string' ? body.phone.trim().slice(0, 30) : ''
    const tail = phoneTail(phone)
    const levelRaw = typeof body.level === 'string' ? body.level.trim().toUpperCase() : ''
    const level = (['BLOCKED', 'CONTACT', 'STAFF', 'ADMIN'] as const).find((l) => l === levelRaw) ?? null
    const note = typeof body.note === 'string' ? body.note.trim().slice(0, 300) || null : null
    if (!name) return NextResponse.json({ error: 'name required' }, { status: 400 })
    if (!tail) return NextResponse.json({ error: 'a full US mobile number is required' }, { status: 400 })
    if (!level) return NextResponse.json({ error: 'level must be BLOCKED, CONTACT, STAFF or ADMIN' }, { status: 400 })
    let jobId: string | null = null
    if (level === 'CONTACT') {
      const jobCode = typeof body.jobCode === 'string' ? body.jobCode.trim() : ''
      if (!jobCode) return NextResponse.json({ error: 'a CONTACT grant needs the job code it is a contact on' }, { status: 400 })
      const job = await prisma.job.findFirst({ where: { jobCode: { equals: jobCode, mode: 'insensitive' } }, select: { id: true } })
      if (!job) return NextResponse.json({ error: `no job ${jobCode}` }, { status: 404 })
      jobId = job.id
    }
    try {
      const replaced = await prisma.ahaGrant.updateMany({ where: { phoneTail: tail, revokedAt: null }, data: { revokedAt: new Date(), revokedById: gate.user.id } })
      const row = await prisma.ahaGrant.create({ data: { phone, phoneTail: tail, name, level, jobId, note, createdById: gate.user.id }, select: { id: true } })
      await prisma.auditLog.create({
        data: { userId: gate.user.id, action: 'admin.aha_grant_added', entityType: 'AhaGrant', entityId: row.id, oldValues: { replaced: replaced.count }, newValues: { name, level, phoneTail: tail.slice(-4), jobId, at: new Date().toISOString() } },
      })
      return NextResponse.json({ ok: true, id: row.id })
    } catch (err) {
      console.error('[admin/assistant] add-grant failed:', err)
      return NextResponse.json({ error: GRANTS_MISSING }, { status: 500 })
    }
  }
  if (body.action === 'revoke-grant') {
    if (gate.user.role !== 'ADMIN') return NextResponse.json({ error: 'only an admin can change the AHA list' }, { status: 403 })
    const grantId = typeof body.grantId === 'string' ? body.grantId : ''
    if (!grantId) return NextResponse.json({ error: 'grantId required' }, { status: 400 })
    try {
      const g = await prisma.ahaGrant.findUnique({ where: { id: grantId }, select: { id: true, revokedAt: true, name: true, level: true } })
      if (!g) return NextResponse.json({ error: 'not found' }, { status: 404 })
      if (!g.revokedAt) await prisma.ahaGrant.update({ where: { id: grantId }, data: { revokedAt: new Date(), revokedById: gate.user.id } })
      await prisma.auditLog.create({
        data: { userId: gate.user.id, action: 'admin.aha_grant_revoked', entityType: 'AhaGrant', entityId: grantId, oldValues: { name: g.name, level: g.level }, newValues: { at: new Date().toISOString() } },
      })
      return NextResponse.json({ ok: true })
    } catch (err) {
      console.error('[admin/assistant] revoke-grant failed:', err)
      return NextResponse.json({ error: GRANTS_MISSING }, { status: 500 })
    }
  }

  if (body.action === 'set-gate-code') {
    const gateCode = typeof body.gateCode === 'string' ? body.gateCode.trim().slice(0, 60) : ''
    await prisma.siteSetting.upsert({
      where: { id: SINGLETON },
      create: {
        id: SINGLETON,
        gateCode: gateCode || null,
        gateCodeUpdatedAt: new Date(),
        gateCodeUpdatedById: gate.user.id,
      },
      update: {
        gateCode: gateCode || null,
        gateCodeUpdatedAt: new Date(),
        gateCodeUpdatedById: gate.user.id,
      },
    })
    // Audit the CHANGE, not the value.
    await prisma.auditLog.create({
      data: {
        userId: gate.user.id,
        action: 'admin.gate_code_updated',
        entityType: 'SiteSetting',
        entityId: SINGLETON,
        oldValues: {},
        newValues: { changed: true, cleared: !gateCode, at: new Date().toISOString() },
      },
    })
    return NextResponse.json({ ok: true })
  }

  // The storage-container keypad, recorded next to the gate for the same
  // reason: it is programmed at the lot, and every surface that quotes it
  // should read one row. It reaches clients only through a released
  // after-hours page (see Job.afterHoursReleasedAt).
  if (body.action === 'set-container-code') {
    const containerCode =
      typeof body.containerCode === 'string' ? body.containerCode.trim().slice(0, 60) : ''
    await prisma.siteSetting.upsert({
      where: { id: SINGLETON },
      create: {
        id: SINGLETON,
        containerCode: containerCode || null,
        containerCodeUpdatedAt: new Date(),
        containerCodeUpdatedById: gate.user.id,
      },
      update: {
        containerCode: containerCode || null,
        containerCodeUpdatedAt: new Date(),
        containerCodeUpdatedById: gate.user.id,
      },
    })
    await prisma.auditLog.create({
      data: {
        userId: gate.user.id,
        action: 'admin.container_code_updated',
        entityType: 'SiteSetting',
        entityId: SINGLETON,
        oldValues: {},
        newValues: { changed: true, cleared: !containerCode, at: new Date().toISOString() },
      },
    })
    return NextResponse.json({ ok: true })
  }

  // The vehicle key lock box how-to. Not a code — a public link (the old
  // www.sirreel.com/lockbox page is dead since the cutover). Rendered in
  // the after-hours vehicle pickup email whenever it is set; blank hides
  // the line. http(s) only, so a typo can't become a mailto: or javascript:.
  if (body.action === 'set-lockbox-url') {
    const raw = typeof body.lockboxInstructionsUrl === 'string' ? body.lockboxInstructionsUrl.trim().slice(0, 500) : ''
    let url: string | null = null
    if (raw) {
      const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`
      try {
        const u = new URL(withScheme)
        if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('scheme')
        url = u.toString()
      } catch {
        return NextResponse.json({ error: 'That is not a web address. Paste a full link like https://www.sirreel.com/lockbox' }, { status: 400 })
      }
    }
    await prisma.siteSetting.upsert({
      where: { id: SINGLETON },
      create: { id: SINGLETON, lockboxInstructionsUrl: url },
      update: { lockboxInstructionsUrl: url },
    })
    await prisma.auditLog.create({
      data: {
        userId: gate.user.id,
        action: 'admin.lockbox_instructions_url_updated',
        entityType: 'SiteSetting',
        entityId: SINGLETON,
        oldValues: {},
        newValues: { url, at: new Date().toISOString() },
      },
    })
    return NextResponse.json({ ok: true, url })
  }

  if (body.action === 'regenerate-job-code') {
    const jobId = typeof body.jobId === 'string' ? body.jobId : ''
    if (!jobId) return NextResponse.json({ error: 'jobId required' }, { status: 400 })
    const job = await prisma.job.findUnique({ where: { id: jobId }, select: { id: true } })
    if (!job) return NextResponse.json({ error: 'job not found' }, { status: 404 })
    const assistantAuthCode = await generateAssistantAuthCode(prisma)
    await prisma.job.update({ where: { id: jobId }, data: { assistantAuthCode } })
    await prisma.auditLog.create({
      data: {
        userId: gate.user.id,
        action: 'admin.job_code_regenerated',
        entityType: 'Job',
        entityId: jobId,
        oldValues: {},
        newValues: { at: new Date().toISOString() },
      },
    })
    return NextResponse.json({ ok: true, assistantAuthCode })
  }

  if (body.action === 'set-emergency-contact') {
    const userId = typeof body.userId === 'string' ? body.userId : ''
    if (!userId) return NextResponse.json({ error: 'userId required' }, { status: 400 })
    const data: { isEmergencyContact?: boolean; emergencyPhone?: string | null } = {}
    if (typeof body.isEmergencyContact === 'boolean') data.isEmergencyContact = body.isEmergencyContact
    if (typeof body.emergencyPhone === 'string') data.emergencyPhone = body.emergencyPhone.trim().slice(0, 30) || null
    await prisma.user.update({ where: { id: userId }, data })
    return NextResponse.json({ ok: true })
  }

  // The staff member's own mobile — the number AHA recognises as staff by
  // text (src/lib/assistant/senderIdentity.ts). Wes 2026-09-10: Jose, Dani,
  // Wes, Oliver, Hugo, Albert. Emergency phone counts too, so an on-call
  // number does not need entering twice.
  if (body.action === 'set-staff-phone') {
    const userId = typeof body.userId === 'string' ? body.userId : ''
    if (!userId) return NextResponse.json({ error: 'userId required' }, { status: 400 })
    if (typeof body.phone !== 'string') return NextResponse.json({ error: 'phone required' }, { status: 400 })
    await prisma.user.update({ where: { id: userId }, data: { phone: body.phone.trim().slice(0, 30) || null } })
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: 'unknown action' }, { status: 400 })
}
