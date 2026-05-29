/**
 * POST /api/invoices/[id]/send
 *
 * Phase 5 commit 2 — Sends an invoice via Resend (PDF attached + portal
 * magic link), stamps Invoice.sentAt + status=SENT, advances Order
 * RETURNED → INVOICED (non-blocking), and logs an executed
 * CadenceEvent(INVOICE_DELIVERY) row.
 *
 * Auth: any authenticated session. The order detail UI only renders the
 * Send button when perms.billing is true; server-side this matches the
 * pattern in /api/orders/[id]/book — tighter per-action perms land in
 * their own commits.
 *
 * Body (all optional):
 *   { cc?: string[], overrideContactId?: string }
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { sendInvoice } from '@/lib/invoices/sendInvoice'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession()
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const body = (await req.json().catch(() => ({}))) as {
    cc?: unknown
    overrideContactId?: unknown
  }
  const cc = Array.isArray(body.cc)
    ? (body.cc.filter((v) => typeof v === 'string') as string[])
    : null
  const overrideContactId =
    typeof body.overrideContactId === 'string' ? body.overrideContactId : null

  const result = await sendInvoice({
    invoiceId: params.id,
    cc,
    overrideContactId,
  })

  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: result.status })
  }
  return NextResponse.json(result)
}
