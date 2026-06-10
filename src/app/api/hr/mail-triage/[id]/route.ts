/**
 * PATCH /api/hr/mail-triage/[id]
 *   Body: { employeeId?: string|null, category?: HrCategory, dismiss?: true,
 *           disposition?: HrDisposition }
 *
 * Stamps reviewer + reviewedAt on every change. Used by the triage
 * strip on /hr (assign employee, set category, dismiss/ignore).
 *
 * Allowlist-gated. When `dismiss: true` is set we also flip
 * disposition to FILED (if an employeeId is present) or IGNORED (if
 * still null) — dismissing without resolving the routing would leave
 * an orphan that the strip would re-surface on next view.
 */

import { NextRequest, NextResponse } from 'next/server'
import type { HrCategory, HrDisposition } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { requireHrAccess } from '@/lib/hr/allowlist'

export const dynamic = 'force-dynamic'

const VALID_CATS: HrCategory[] = [
  'TIMESHEET', 'PTO_LEAVE', 'MEDICAL', 'PAYROLL', 'BENEFITS',
  'DISCIPLINE', 'COMPLAINT', 'ONBOARDING', 'RESIGNATION', 'OTHER',
]
const VALID_CATS_SET = new Set<string>(VALID_CATS)
const VALID_DISPS: HrDisposition[] = ['FILED', 'NEEDS_REVIEW', 'IGNORED']
const VALID_DISPS_SET = new Set<string>(VALID_DISPS)

type Params = { params: Promise<{ id: string }> }

interface PatchBody {
  employeeId?: unknown
  category?: unknown
  dismiss?: unknown
  disposition?: unknown
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const gate = await requireHrAccess()
  if (gate instanceof NextResponse) return gate
  const me = gate

  const { id } = await params
  const body = (await req.json().catch(() => ({}))) as PatchBody

  const data: Record<string, unknown> = { reviewedById: me.id, reviewedAt: new Date() }

  if (body.employeeId !== undefined) {
    if (body.employeeId === null || body.employeeId === '') {
      data.employeeId = null
    } else if (typeof body.employeeId !== 'string') {
      return NextResponse.json({ error: 'employeeId must be string or null' }, { status: 400 })
    } else {
      const emp = await prisma.employee.findUnique({
        where: { id: body.employeeId },
        select: { id: true },
      })
      if (!emp) return NextResponse.json({ error: 'employee not found' }, { status: 404 })
      data.employeeId = emp.id
    }
  }

  if (body.category !== undefined) {
    if (typeof body.category !== 'string' || !VALID_CATS_SET.has(body.category)) {
      return NextResponse.json({ error: 'invalid category' }, { status: 400 })
    }
    data.category = body.category as HrCategory
  }

  if (body.disposition !== undefined) {
    if (typeof body.disposition !== 'string' || !VALID_DISPS_SET.has(body.disposition)) {
      return NextResponse.json({ error: 'invalid disposition' }, { status: 400 })
    }
    data.disposition = body.disposition as HrDisposition
  }

  if (body.dismiss === true) {
    data.dismissed = true
    // Don't leave a NEEDS_REVIEW row dangling — resolve disposition
    // implicitly so the triage strip doesn't re-surface it next view.
    const current = await prisma.hrMail.findUnique({
      where: { id },
      select: { employeeId: true },
    })
    const futureEmployee = data.employeeId !== undefined ? data.employeeId : current?.employeeId
    if (data.disposition === undefined) {
      data.disposition = (futureEmployee ? 'FILED' : 'IGNORED') as HrDisposition
    }
  }

  const updated = await prisma.hrMail.update({
    where: { id },
    data,
    select: {
      id: true, employeeId: true, category: true,
      disposition: true, dismissed: true, reviewedAt: true,
    },
  }).catch(() => null)
  if (!updated) return NextResponse.json({ error: 'not found' }, { status: 404 })

  // Mirror the employeeId change onto the attached HrAttachment rows
  // so the employee detail page picks them up. Best-effort — if any
  // updates fail we still return ok.
  if (body.employeeId !== undefined) {
    await prisma.hrAttachment.updateMany({
      where: { hrEmail: { hrMail: { id } } },
      data: { employeeId: data.employeeId as string | null },
    }).catch(() => {})
  }

  return NextResponse.json({ ok: true, hrMail: updated })
}
