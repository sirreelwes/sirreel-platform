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

export const dynamic = 'force-dynamic'
const SINGLETON = 'singleton'

export async function GET() {
  const gate = await requireAssistantAccess()
  if (gate instanceof NextResponse) return gate

  const s = await prisma.siteSetting.findUnique({
    where: { id: SINGLETON },
    select: { gateCode: true, gateCodeUpdatedAt: true, gateCodeUpdatedById: true },
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
      startDate: true,
      endDate: true,
    },
    orderBy: { createdAt: 'desc' },
    take: 200,
  })

  const audit = await prisma.auditLog.findMany({
    where: { action: { startsWith: 'public.access_' } },
    orderBy: { createdAt: 'desc' },
    take: 30,
    select: { id: true, action: true, createdAt: true, ipAddress: true, newValues: true },
  })

  return NextResponse.json({
    gateCode: s?.gateCode ?? '',
    gateCodeUpdatedAt: s?.gateCodeUpdatedAt ?? null,
    gateCodeUpdatedBy,
    jobs,
    audit,
  })
}

export async function POST(req: NextRequest) {
  const gate = await requireAssistantAccess()
  if (gate instanceof NextResponse) return gate

  const body = (await req.json().catch(() => null)) as
    | { action?: string; gateCode?: string; jobId?: string }
    | null
  if (!body?.action) return NextResponse.json({ error: 'action required' }, { status: 400 })

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

  return NextResponse.json({ error: 'unknown action' }, { status: 400 })
}
