/**
 * GET / PATCH /api/portal/company/[companyId]/notifications
 *
 * The executive's own notification elections. Wes 2026-09-04: "an option
 * for what notifications they would like: Job Start, Invoices Paid and job
 * closed, etc."
 *
 * Scoped to the CompanyPortalAccess row resolved from the session, never to
 * an id in the body — two executives at the same company have separate
 * elections and neither may edit the other's.
 *
 * NONE cadence is the mute. It leaves the per-event booleans untouched, so
 * unmuting restores exactly the settings they had rather than a default
 * they never chose.
 */

import { NextRequest, NextResponse } from 'next/server'
import type { CompanyPortalCadence } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getCompanyPortalSessionFromRequest } from '@/lib/portal/companyPortal'

export const dynamic = 'force-dynamic'

const CADENCES: CompanyPortalCadence[] = ['IMMEDIATE', 'WEEKLY', 'NONE']

const FLAGS = ['notifyJobStart', 'notifyInvoicePaid', 'notifyJobClosed', 'notifyQuoteSent'] as const

export async function GET(req: NextRequest, { params }: { params: { companyId: string } }) {
  const session = await getCompanyPortalSessionFromRequest(req, params.companyId)
  if (!session) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const row = await prisma.companyPortalAccess.findUnique({
    where: { id: session.accessId },
    select: {
      notifyJobStart: true,
      notifyInvoicePaid: true,
      notifyJobClosed: true,
      notifyQuoteSent: true,
      cadence: true,
    },
  })
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ ok: true, settings: row })
}

export async function PATCH(req: NextRequest, { params }: { params: { companyId: string } }) {
  const session = await getCompanyPortalSessionFromRequest(req, params.companyId)
  if (!session) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>

  const data: Record<string, unknown> = {}
  for (const flag of FLAGS) {
    if (typeof body[flag] === 'boolean') data[flag] = body[flag]
  }
  if (typeof body.cadence === 'string' && CADENCES.includes(body.cadence as CompanyPortalCadence)) {
    data.cadence = body.cadence
  }
  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
  }

  const updated = await prisma.companyPortalAccess.update({
    where: { id: session.accessId },
    data,
    select: {
      notifyJobStart: true,
      notifyInvoicePaid: true,
      notifyJobClosed: true,
      notifyQuoteSent: true,
      cadence: true,
    },
  })

  return NextResponse.json({ ok: true, settings: updated })
}
