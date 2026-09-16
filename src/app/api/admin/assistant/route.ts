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
import { resolveGrantExpiry } from '@/lib/assistant/grantExpiry'
import { lines } from '@/lib/assistant/topics'
import { TROUBLESHOOTING_GUIDES } from '@/lib/site/troubleshooting'
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
    // oldValues carries what the caller actually GAVE (unit, VIN, name,
    // whether a job code was tried). It was stored from the start and never
    // selected, so the log could not say what someone asked for — only what
    // came out. Wes 2026-09-15.
    select: { id: true, action: true, createdAt: true, ipAddress: true, newValues: true, oldValues: true },
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

  // Topics for the editor: the stored rows, disabled ones included, plus a
  // flag saying whether AHA is currently running on them or on the built-in
  // seed. Without that flag an empty list looks like "AHA has no tutorials"
  // when it actually has three.
  let topics: Array<Record<string, unknown>> = []
  let topicsSeeded = false
  try {
    topics = await prisma.ahaTopic.findMany({
      orderBy: [{ sortOrder: 'asc' }, { title: 'asc' }],
      select: {
        id: true, slug: true, title: true, eyebrow: true, summary: true, symptoms: true,
        checks: true, stopIf: true, tellUs: true, assistantBrief: true, openQuestions: true,
        enabled: true, sortOrder: true, updatedAt: true,
      },
    })
  } catch (err) {
    console.error('[admin/assistant] topics unavailable:', err)
  }
  if (topics.length === 0) {
    topicsSeeded = true
    topics = TROUBLESHOOTING_GUIDES.map((g, i) => ({
      id: `seed:${g.slug}`, slug: g.slug, title: g.title, eyebrow: g.eyebrow, summary: g.summary,
      symptoms: g.symptoms.join('\n'),
      checks: g.checks.map((c) => `${c.title} — ${c.body}`).join('\n'),
      stopIf: g.stopIf.join('\n'), tellUs: g.tellUs.join('\n'),
      assistantBrief: '', openQuestions: g.openQuestions.join('\n'),
      enabled: true, sortOrder: i, updatedAt: null,
    }))
  }

  return NextResponse.json({
    topics,
    /** True = these are the built-in defaults; saving one makes it editable. */
    topicsSeeded,
    gateCode: s?.gateCode ?? '',
    gateCodeUpdatedAt: s?.gateCodeUpdatedAt ?? null,
    gateCodeUpdatedBy,
    containerCode: s?.containerCode ?? '',
    containerCodeUpdatedAt: s?.containerCodeUpdatedAt ?? null,
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
        action?: string; gateCode?: string; containerCode?: string; jobId?: string; userId?: string; isEmergencyContact?: boolean; emergencyPhone?: string; phone?: string; expiresAt?: string; topic?: Record<string, unknown>; topicId?: string
        name?: string; level?: string; note?: string; jobCode?: string; grantId?: string
      }
    | null
  if (!body?.action) return NextResponse.json({ error: 'action required' }, { status: 400 })

  // ── Add a person to (or take one off) the AHA list by hand ──
  // Wes 2026-09-11. One active row per number: adding again replaces. Rows
  // are never deleted — revoked, so the history says who granted what.
  const GRANTS_MISSING = 'The AHA grants table is not in the database yet — run `npx prisma db push` (see docs), then try again.'
const TOPICS_MISSING =
  'Could not save the topic. If the sr_aha_topics table is missing, run `npx prisma db push` — until then AHA falls back to the built-in tutorials.'
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
    // A CONTACT grant's default expiry follows its job, so the job's last
    // live date is read here alongside the id.
    let jobEnd: Date | null = null
    if (level === 'CONTACT') {
      const jobCode = typeof body.jobCode === 'string' ? body.jobCode.trim() : ''
      if (!jobCode) return NextResponse.json({ error: 'a CONTACT grant needs the job code it is a contact on' }, { status: 400 })
      const job = await prisma.job.findFirst({
        where: { jobCode: { equals: jobCode, mode: 'insensitive' } },
        select: {
          id: true,
          orders: { where: { status: { notIn: ['CANCELLED', 'CLOSED'] } }, select: { endDate: true } },
          bookings: { where: { archivedAt: null, status: { notIn: ['CANCELLED', 'ARCHIVED'] } }, select: { endDate: true } },
        },
      })
      if (!job) return NextResponse.json({ error: `no job ${jobCode}` }, { status: 404 })
      jobId = job.id
      for (const d of [...job.orders.map((o) => o.endDate), ...job.bookings.map((b) => b.endDate)]) {
        if (d && (!jobEnd || d > jobEnd)) jobEnd = d
      }
    }
    // "never" is a deliberate choice an admin has to make; anything else is
    // a date, and leaving it blank takes the default for the level.
    const requested =
      body.expiresAt === 'never'
        ? ('never' as const)
        : typeof body.expiresAt === 'string' && body.expiresAt.trim()
          ? new Date(body.expiresAt)
          : null
    const { expiresAt, error: expiryError } = resolveGrantExpiry({ requested, level, jobEnd })
    if (expiryError) return NextResponse.json({ error: expiryError }, { status: 400 })
    try {
      const replaced = await prisma.ahaGrant.updateMany({ where: { phoneTail: tail, revokedAt: null }, data: { revokedAt: new Date(), revokedById: gate.user.id } })
      const row = await prisma.ahaGrant.create({ data: { phone, phoneTail: tail, name, level, jobId, note, expiresAt, createdById: gate.user.id }, select: { id: true } })
      await prisma.auditLog.create({
        data: { userId: gate.user.id, action: 'admin.aha_grant_added', entityType: 'AhaGrant', entityId: row.id, oldValues: { replaced: replaced.count }, newValues: { name, level, phoneTail: tail.slice(-4), jobId, expiresAt: expiresAt ? expiresAt.toISOString() : 'never', at: new Date().toISOString() } },
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

  // ── Troubleshooting topics (Wes 2026-09-16: sections ops can modify) ──
  // Any user who can reach this page may edit a topic; these are published
  // instructions, not access. Every save is audited with the old text so a
  // bad edit is recoverable from the log.
  if (body.action === 'save-topic') {
    const t = (body.topic ?? {}) as Record<string, unknown>
    const str = (k: string, max: number) => (typeof t[k] === 'string' ? (t[k] as string).trim().slice(0, max) : '')
    const slug = str('slug', 60).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '')
    const title = str('title', 120)
    if (!slug) return NextResponse.json({ error: 'a slug is required (letters, numbers and hyphens)' }, { status: 400 })
    if (!title) return NextResponse.json({ error: 'a title is required' }, { status: 400 })
    const checksText = str('checks', 8000)
    if (lines(checksText).length === 0) return NextResponse.json({ error: 'add at least one step' }, { status: 400 })
    // A topic with no stop condition is the dangerous shape: AHA would keep
    // suggesting things with no boundary. Refuse it rather than ship it.
    const stopText = str('stopIf', 4000)
    if (lines(stopText).length === 0) {
      return NextResponse.json({ error: 'add at least one "stop and call us" condition — a topic without one lets AHA troubleshoot forever' }, { status: 400 })
    }
    const data = {
      slug, title,
      eyebrow: str('eyebrow', 60) || 'Troubleshooting',
      summary: str('summary', 600),
      symptoms: str('symptoms', 2000),
      checks: checksText,
      stopIf: stopText,
      tellUs: str('tellUs', 2000),
      assistantBrief: str('assistantBrief', 8000) || null,
      openQuestions: str('openQuestions', 4000) || null,
      enabled: t.enabled !== false,
      sortOrder: Number.isFinite(Number(t.sortOrder)) ? Number(t.sortOrder) : 0,
    }
    try {
      const before = await prisma.ahaTopic.findUnique({ where: { slug }, select: { id: true, title: true, checks: true, stopIf: true, enabled: true } })
      const row = await prisma.ahaTopic.upsert({
        where: { slug },
        create: { ...data, createdById: gate.user.id, updatedById: gate.user.id },
        update: { ...data, updatedById: gate.user.id },
        select: { id: true, slug: true },
      })
      await prisma.auditLog.create({
        data: {
          userId: gate.user.id,
          action: before ? 'admin.aha_topic_updated' : 'admin.aha_topic_created',
          entityType: 'AhaTopic', entityId: row.id,
          oldValues: before ? { title: before.title, checks: before.checks, stopIf: before.stopIf, enabled: before.enabled } : {},
          newValues: { slug, title, enabled: data.enabled, steps: lines(checksText).length, stops: lines(stopText).length, at: new Date().toISOString() },
        },
      }).catch(() => {})
      return NextResponse.json({ ok: true, slug: row.slug })
    } catch (err) {
      console.error('[admin/assistant] save-topic failed:', err)
      return NextResponse.json({ error: TOPICS_MISSING }, { status: 500 })
    }
  }

  if (body.action === 'delete-topic') {
    if (gate.user.role !== 'ADMIN') return NextResponse.json({ error: 'only an admin can delete a topic' }, { status: 403 })
    const topicId = typeof body.topicId === 'string' ? body.topicId : ''
    if (!topicId) return NextResponse.json({ error: 'topicId required' }, { status: 400 })
    try {
      // The whole text is kept in the audit row — deleting a topic should
      // not be the thing that loses six months of refined instructions.
      const before = await prisma.ahaTopic.findUnique({ where: { id: topicId } })
      if (!before) return NextResponse.json({ error: 'not found' }, { status: 404 })
      await prisma.ahaTopic.delete({ where: { id: topicId } })
      await prisma.auditLog.create({
        data: {
          userId: gate.user.id, action: 'admin.aha_topic_deleted', entityType: 'AhaTopic', entityId: topicId,
          oldValues: { slug: before.slug, title: before.title, summary: before.summary, symptoms: before.symptoms, checks: before.checks, stopIf: before.stopIf, tellUs: before.tellUs, assistantBrief: before.assistantBrief },
          newValues: { at: new Date().toISOString() },
        },
      }).catch(() => {})
      return NextResponse.json({ ok: true })
    } catch (err) {
      console.error('[admin/assistant] delete-topic failed:', err)
      return NextResponse.json({ error: TOPICS_MISSING }, { status: 500 })
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
