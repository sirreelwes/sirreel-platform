/**
 * GET /api/portal/job/invoice/[id]/pdf
 *
 * Client-portal access to an Invoice PDF. Cookie-authenticated — the
 * client lands here only after passing through /api/portal/job/[slug]
 * with a valid magic-link token, which sets the JOB_SESSION_COOKIE.
 *
 * Phase 5 commit 2 — reuses the contract magic-link pattern exactly.
 * No new auth model; just gates the invoice fetch on the existing
 * portal session.
 *
 * Authorization: the resolved session's order must own the invoice.
 * 404 (not 403) if the invoice belongs to a different order — the
 * client should never learn whether an invoice id exists outside
 * their context.
 *
 * Modes:
 *   default       → Content-Disposition: inline   (preview)
 *   ?download=1   → Content-Disposition: attachment
 *
 * (No ?meta=1 — client portal doesn't need metadata polling; the
 * portal page UI will get the listing through a separate endpoint
 * once it's extended to surface invoices.)
 */

import { NextRequest, NextResponse } from 'next/server'
import { get as getBlob } from '@vercel/blob'
import { prisma } from '@/lib/prisma'
import {
  JOB_SESSION_COOKIE,
  buildJobSessionCookieHeader,
  verifyJobSessionCookieValue,
} from '@/lib/portal/jobSession'
import { resolveJobSession } from '@/lib/portal/jobMagicLink'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
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

  const invoice = await prisma.invoice.findUnique({
    where: { id: params.id },
    select: {
      orderId: true,
      invoiceNumber: true,
      pdfBlobKey: true,
      status: true,
    },
  })
  // Either-or: a 404 covers both "no such invoice" and "invoice
  // belongs to a different order." Client never learns the
  // distinction.
  if (!invoice || invoice.orderId !== resolved.orderId) {
    return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })
  }
  if (!invoice.pdfBlobKey) {
    return NextResponse.json({ error: 'Invoice PDF not generated' }, { status: 404 })
  }
  // Don't surface DRAFT or VOID invoices to the client.
  if (invoice.status === 'DRAFT' || invoice.status === 'VOID') {
    return NextResponse.json({ error: 'Invoice not available' }, { status: 404 })
  }

  try {
    const blob = await getBlob(invoice.pdfBlobKey, { access: 'private' })
    if (!blob || blob.statusCode !== 200 || !blob.stream) {
      return NextResponse.json({ error: 'PDF blob not retrievable' }, { status: 500 })
    }
    const wantDownload = req.nextUrl.searchParams.get('download') === '1'
    const filename = `Invoice-${invoice.invoiceNumber}.pdf`
    return new Response(blob.stream, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': wantDownload
          ? `attachment; filename="${filename}"`
          : `inline; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (err) {
    console.error('[portal/invoice/pdf] blob fetch failed:', err)
    return NextResponse.json({ error: 'Failed to fetch PDF' }, { status: 500 })
  }
}
