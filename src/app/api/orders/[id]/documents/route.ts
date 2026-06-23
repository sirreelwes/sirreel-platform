/**
 * POST /api/orders/[id]/documents — upload a typed document to an
 * order. Today the only consumer is the thank-you compose view
 * uploading a JOB_PHOTO candid; the OTHER bucket is here for the
 * future without a schema migration.
 *
 * Body: multipart/form-data with fields
 *   file:    File (required)
 *   type:    OrderDocType (default JOB_PHOTO)
 *   title:   string (optional — defaults to filename)
 *
 * Auth: getServerSession; uploads stamp uploadedById from the session
 * user so the audit trail shows who shot the photo.
 *
 * GET /api/orders/[id]/documents — list typed attachments for the
 * compose view's "choose existing photo" picker.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { OrderDocType } from '@prisma/client'
import { uploadOrderDocument } from '@/lib/orders/uploadOrderDocument'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

const VALID_TYPES = new Set<string>(Object.values(OrderDocType))

export async function POST(req: NextRequest, { params }: Params) {
  const session = await getServerSession()
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true },
  })
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { id } = await params
  const order = await prisma.order.findUnique({
    where: { id },
    select: { id: true, orderNumber: true },
  })
  if (!order) return NextResponse.json({ error: 'order not found' }, { status: 404 })

  const form = await req.formData().catch(() => null)
  if (!form) return NextResponse.json({ error: 'invalid form' }, { status: 400 })
  const file = form.get('file')
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'file required' }, { status: 400 })
  }
  const typeRaw = String(form.get('type') ?? OrderDocType.JOB_PHOTO)
  if (!VALID_TYPES.has(typeRaw)) {
    return NextResponse.json({ error: 'invalid type' }, { status: 400 })
  }
  const type = typeRaw as OrderDocType
  const title = String(form.get('title') ?? '') || file.name || 'Document'

  // Blob upload + persist. Any failure (e.g. a blob-store config
  // problem) must surface as a clean, specific error — never a bare 500
  // that the compose view renders as an opaque "upload failed".
  try {
    const buf = Buffer.from(await file.arrayBuffer())
    const kindSuffix = type === OrderDocType.JOB_PHOTO ? 'jobphoto' : 'doc'
    const { fileUrl, blobKey } = await uploadOrderDocument({
      orderNumber: order.orderNumber,
      filename: file.name,
      contentType: file.type || 'application/octet-stream',
      data: buf,
      kindSuffix,
    })

    const row = await prisma.orderDocument.create({
      data: {
        orderId: id,
        type,
        title,
        fileUrl,
        blobKey,
        mimeType: file.type || null,
        sizeBytes: buf.byteLength,
        uploadedById: user.id,
      },
      include: {
        uploadedBy: { select: { id: true, name: true } },
      },
    })
    return NextResponse.json(row, { status: 201 })
  } catch (err) {
    console.error('[orders documents POST] upload failed:', err)
    return NextResponse.json(
      { error: 'Document storage upload failed — please retry; if it persists, the blob store may be misconfigured.' },
      { status: 502 },
    )
  }
}

export async function GET(_req: NextRequest, { params }: Params) {
  const session = await getServerSession()
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const { id } = await params
  const rows = await prisma.orderDocument.findMany({
    where: { orderId: id },
    orderBy: { createdAt: 'desc' },
    include: {
      uploadedBy: { select: { id: true, name: true } },
    },
  })
  return NextResponse.json({ rows })
}
