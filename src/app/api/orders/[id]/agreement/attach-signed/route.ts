import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { put } from '@vercel/blob'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

const MAX_BYTES = 25 * 1024 * 1024 // 25 MB
const ALLOWED_TYPES = new Set(['RENTAL_AGREEMENT', 'STAGE_CONTRACT'])

/**
 * POST /api/orders/[id]/agreement/attach-signed — internal, authed attach
 * of an executed agreement that was signed OUTSIDE the portal (email,
 * broker, RentalWorks, wet signature). The offline/backfill analog of the
 * portal sign flow: it lands the countersigned PDF on the order's
 * SignedAgreement so HQ reads "Signed" without forcing a re-sign.
 *
 * Mirrors the portal sign route's storage (private Blob under
 * signed-agreements/<orderId>/) and the SIGNED_BASELINE terminal state,
 * but is agent-driven. SignedAgreement has no `source` column, so offline
 * provenance (who attached, when, any note) is recorded in
 * acknowledgmentText. Refuses to overwrite a row that is already signed —
 * there's nothing to backfill there, and clobbering an executed copy would
 * be destructive.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession()
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const order = await prisma.order.findUnique({
    where: { id: params.id },
    select: { id: true },
  })
  if (!order) {
    return NextResponse.json({ error: 'Order not found' }, { status: 404 })
  }

  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return NextResponse.json({ error: 'Could not read the upload. Please try again.' }, { status: 400 })
  }

  const contractType = (form.get('contractType') || 'RENTAL_AGREEMENT').toString()
  if (!ALLOWED_TYPES.has(contractType)) {
    return NextResponse.json({ error: 'Invalid contract type.' }, { status: 400 })
  }

  const file = form.get('file')
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'Please attach a PDF file.' }, { status: 400 })
  }
  if (file.size === 0) {
    return NextResponse.json({ error: 'That file is empty. Please attach the signed PDF.' }, { status: 400 })
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: `That file is too large (max 25 MB). It is ${(file.size / 1024 / 1024).toFixed(1)} MB.` },
      { status: 400 },
    )
  }

  const buffer = Buffer.from(await file.arrayBuffer())
  const isPdf = buffer.subarray(0, 5).toString('latin1') === '%PDF-'
  if (!isPdf) {
    return NextResponse.json(
      { error: 'That doesn’t look like a PDF. Please attach the signed agreement as a PDF.' },
      { status: 400 },
    )
  }

  // Never clobber an already-executed agreement.
  const existing = await prisma.signedAgreement.findUnique({
    where: { orderId_contractType: { orderId: order.id, contractType: contractType as 'RENTAL_AGREEMENT' | 'STAGE_CONTRACT' } },
    select: { id: true, status: true },
  })
  if (existing && (existing.status === 'SIGNED_BASELINE' || existing.status === 'SIGNED_NEGOTIATED')) {
    return NextResponse.json(
      { error: 'This order already has a signed agreement on file. Nothing to attach.' },
      { status: 409 },
    )
  }

  const signerName = (form.get('signerName') || '').toString().trim().slice(0, 200) || null
  const note = (form.get('note') || '').toString().trim().slice(0, 2000)
  const signedRaw = (form.get('signedDate') || '').toString().trim()
  const signedAt = signedRaw ? new Date(signedRaw) : new Date()
  if (Number.isNaN(signedAt.getTime())) {
    return NextResponse.json({ error: 'Signed date is not a valid date.' }, { status: 400 })
  }

  let blobUrl: string
  try {
    const blobKey = `signed-agreements/${order.id}/attached-${signedAt.getTime()}.pdf`
    const uploaded = await put(blobKey, buffer, { access: 'private' as 'public', contentType: 'application/pdf' })
    blobUrl = uploaded.url
  } catch (err) {
    console.error('[agreement attach-signed] blob write failed:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Upload failed while saving. Please try again.' }, { status: 502 })
  }

  const provenance = `Signed copy attached offline by ${session.user.name || session.user.email} on ${new Date().toISOString().slice(0, 10)}.${note ? ` Note: ${note}` : ''}`

  const saved = await prisma.signedAgreement.upsert({
    where: { orderId_contractType: { orderId: order.id, contractType: contractType as 'RENTAL_AGREEMENT' | 'STAGE_CONTRACT' } },
    create: {
      orderId: order.id,
      contractType: contractType as 'RENTAL_AGREEMENT' | 'STAGE_CONTRACT',
      documentType: 'BASELINE',
      status: 'SIGNED_BASELINE',
      signedDocumentUrl: blobUrl,
      signedAt,
      signerName,
      acknowledgmentText: provenance,
    },
    update: {
      status: 'SIGNED_BASELINE',
      signedDocumentUrl: blobUrl,
      signedAt,
      signerName,
      acknowledgmentText: provenance,
    },
    select: { id: true },
  })

  return NextResponse.json({ ok: true, agreementId: saved.id })
}
