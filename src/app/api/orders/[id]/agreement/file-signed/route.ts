/**
 * POST /api/orders/[id]/agreement/file-signed — file a signed agreement that
 * was executed OUTSIDE the portal, so the client's paperwork stops asking
 * for it.
 *
 * Wes, 2026-08-13: a client signed a rental agreement on paper (or in the
 * Cognito form) and staff need it attached to the job. Uploading it on the
 * job page filed a CompanyAgreement + addendum, which is the right home for
 * the document — but the PORTAL reads SignedAgreement, per order. So the
 * client kept seeing "Ready to sign" for an agreement they had already
 * signed, and would reasonably have signed it twice.
 *
 * This writes the record the portal actually reads.
 *
 * Status is SIGNED_OFFLINE, not SIGNED_BASELINE. The client sees "Signed"
 * either way — from their side it is signed — but the distinction is kept
 * because there is no in-portal signature behind this: no signer IP, no
 * captured signature image, no acknowledgment text. Recording it as a portal
 * signature would overstate what SirReel holds if the agreement is ever
 * disputed.
 *
 * Signer name is taken from the operator if they supply it and left NULL
 * otherwise — never invented. The portal's activity feed skips an entry
 * without a name, which is the correct outcome: we know it is signed, we do
 * not know by whom unless someone tells us.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { put } from '@vercel/blob'
import { randomUUID } from 'crypto'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

const MAX_BYTES = 25 * 1024 * 1024
const TYPES = new Set(['RENTAL_AGREEMENT', 'STAGE_CONTRACT'])

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  }

  const order = await prisma.order.findUnique({
    where: { id: params.id },
    select: { id: true, orderNumber: true, jobId: true },
  })
  if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 })

  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return NextResponse.json({ error: 'Could not read the form.' }, { status: 400 })
  }

  const contractType = (form.get('contractType') || 'RENTAL_AGREEMENT').toString()
  if (!TYPES.has(contractType)) {
    return NextResponse.json(
      { error: 'contractType must be RENTAL_AGREEMENT or STAGE_CONTRACT' },
      { status: 400 },
    )
  }
  const signerName = (form.get('signerName') || '').toString().trim().slice(0, 120) || null
  const signedAtRaw = (form.get('signedAt') || '').toString().trim()
  const signedAt = signedAtRaw ? new Date(signedAtRaw) : new Date()
  if (Number.isNaN(signedAt.getTime())) {
    return NextResponse.json({ error: 'signedAt is not a valid date.' }, { status: 400 })
  }

  const file = form.get('file')
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: 'Please attach the signed PDF.' }, { status: 400 })
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: 'That file is too large (max 25 MB).' }, { status: 400 })
  }
  const buffer = Buffer.from(await file.arrayBuffer())
  // Header check, not the extension — a .pdf that isn't one would be filed as
  // a signed contract and only discovered when someone needed it.
  if (buffer.subarray(0, 5).toString('latin1') !== '%PDF-') {
    return NextResponse.json({ error: 'That doesn’t look like a PDF.' }, { status: 400 })
  }

  const safeName = (file.name || 'signed-agreement.pdf').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120)
  // PRIVATE, matching every other agreement PDF in the codebase. A signed
  // contract carries the client's signature and terms; a public blob URL is
  // guessable-forever and needs no auth. The portal streams it back through
  // streamPrivateBlobAsResponse, which only works for a private blob anyway.
  //
  // `'private' as 'public'` is the codebase's existing workaround for the SDK
  // type not exposing the private literal — see jobs/[id]/agreements.
  let stored: { url: string }
  try {
    stored = await put(`agreements/signed/${randomUUID()}/${safeName}`, buffer, {
      access: 'private' as 'public',
      contentType: 'application/pdf',
    })
  } catch (err) {
    // Surfacing the real reason: a generic "could not file" sent the operator
    // back to the file picker with nothing to act on.
    console.error('[file-signed] blob upload failed:', err)
    return NextResponse.json(
      { error: `Could not store the file: ${err instanceof Error ? err.message : 'upload failed'}` },
      { status: 502 },
    )
  }

  // Upsert on (orderId, contractType) — the compound unique. An order that
  // already has a portal-signed agreement is NOT overwritten: a real
  // signature outranks a filed copy, and silently replacing it would destroy
  // the stronger record.
  const existing = await prisma.signedAgreement.findUnique({
    where: { orderId_contractType: { orderId: order.id, contractType: contractType as never } },
    select: { id: true, status: true, signedAt: true },
  })
  if (existing?.signedAt && existing.status !== 'SIGNED_OFFLINE') {
    return NextResponse.json(
      {
        error:
          'That agreement is already signed through the portal. Filing a copy over it would replace a stronger record — contact an admin if it needs correcting.',
      },
      { status: 409 },
    )
  }

  const saved = await prisma.signedAgreement.upsert({
    where: { orderId_contractType: { orderId: order.id, contractType: contractType as never } },
    create: {
      orderId: order.id,
      contractType: contractType as never,
      status: 'SIGNED_OFFLINE',
      signedAt,
      signerName,
      signedDocumentUrl: stored.url,
    },
    update: {
      status: 'SIGNED_OFFLINE',
      signedAt,
      signerName,
      signedDocumentUrl: stored.url,
    },
    select: { id: true, status: true, signedAt: true },
  })

  await prisma.auditLog.create({
    data: {
      userId: null,
      action: 'order.agreement_filed_offline',
      entityType: 'Order',
      entityId: order.id,
      newValues: {
        contractType,
        signedAt: signedAt.toISOString(),
        signerName,
        filedBy: session.user.email,
        filename: safeName,
      },
    },
  }).catch((e) => console.error('[file-signed] audit write failed:', e))

  return NextResponse.json({ ok: true, agreement: saved })
}
