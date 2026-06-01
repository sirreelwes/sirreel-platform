/**
 * GET /api/portal/job/invoices
 *
 * Phase 6 commit 2 — lists invoices for the cookie-authenticated
 * portal session's order. Returns the fields the pay panel needs
 * plus a `payable` flag so the UI can render the right CTA.
 *
 * Hides DRAFT invoices (never client-visible) and VOID invoices
 * (no purpose surfacing them on the portal). SENT and PARTIAL are
 * payable; PAID is reference-only.
 *
 * Field whitelist mirrors what the existing
 * /api/portal/job/invoice/[id]/pdf surfaces — same audit boundary.
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import {
  JOB_SESSION_COOKIE,
  buildJobSessionCookieHeader,
  verifyJobSessionCookieValue,
} from '@/lib/portal/jobSession'
import { resolveJobSession } from '@/lib/portal/jobMagicLink'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const session = verifyJobSessionCookieValue(req.cookies.get(JOB_SESSION_COOKIE)?.value)
  if (!session) {
    return NextResponse.json({ error: 'No session' }, { status: 401 })
  }
  const resolved = await resolveJobSession({ portalAccessId: session.portalAccessId })
  if (!resolved) {
    const res = NextResponse.json({ error: 'Session no longer valid' }, { status: 401 })
    res.headers.append('Set-Cookie', buildJobSessionCookieHeader('', { clear: true }))
    return res
  }

  const rows = await prisma.invoice.findMany({
    where: {
      orderId: resolved.orderId,
      status: { in: ['SENT', 'PARTIAL', 'PAID'] },
    },
    select: {
      id: true,
      invoiceNumber: true,
      type: true,
      status: true,
      total: true,
      amountPaid: true,
      balanceDue: true,
      sentAt: true,
      paidAt: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'desc' },
  })

  const invoices = rows.map((inv) => ({
    id: inv.id,
    invoiceNumber: inv.invoiceNumber,
    type: inv.type,
    status: inv.status,
    total: inv.total.toString(),
    amountPaid: inv.amountPaid.toString(),
    balanceDue: inv.balanceDue.toString(),
    sentAt: inv.sentAt,
    paidAt: inv.paidAt,
    createdAt: inv.createdAt,
    payable: inv.status === 'SENT' || inv.status === 'PARTIAL',
  }))

  return NextResponse.json({ invoices })
}
