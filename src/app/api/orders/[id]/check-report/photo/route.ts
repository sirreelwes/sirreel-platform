/**
 * POST /api/orders/[id]/check-report/photo — read a photo of the paper.
 *
 * Wes, 2026-09-03: "it would be really cool if they could just take a
 * photo of the pick list and have it be so that it is easy for HQ to
 * ingest for the Check in or out."
 *
 * multipart { file, edge } → the photo is stored privately, read against
 * the order's OWN printed lines, and the suggestions come back for a
 * person to confirm. Nothing here writes to the order, the report, or
 * anything else — the only side effect is the stored image. Filing is
 * still POST on the parent route, still by a human.
 *
 * That split is the whole safety story: a misread digit would otherwise
 * rewrite a client's order and email them a corrected quote.
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireYardAccess } from '@/lib/yard/requireYardAccess'
import { uploadPrivateImage } from '@/lib/blob/uploadPrivateImage'
import { readPickSheetPhoto, type PrintedLine } from '@/lib/orders/readPickSheetPhoto'

export const dynamic = 'force-dynamic'
// A vision read of a full page. The license reader uses the same tier
// and lands well inside this; a dense 40-line sheet is the slow case.
export const maxDuration = 60

const MAX_BYTES = 12 * 1024 * 1024
const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp'])

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireYardAccess()
  if (!auth.ok) return auth.response
  const { id } = await params

  const form = await req.formData().catch(() => null)
  if (!form) return NextResponse.json({ error: 'multipart form required' }, { status: 400 })
  const edgeRaw = String(form.get('edge') || '')
  const edge = edgeRaw === 'IN' ? 'IN' : 'OUT'
  const file = form.get('file')
  if (!(file instanceof File)) return NextResponse.json({ error: 'file required' }, { status: 400 })
  if (!ALLOWED.has(file.type)) {
    return NextResponse.json({ error: 'photo must be a JPEG, PNG or WebP' }, { status: 400 })
  }
  if (file.size > MAX_BYTES) {
    // Phone cameras clear 12MB easily on the highest setting. Say the
    // real fix rather than just refusing.
    return NextResponse.json(
      { error: 'that photo is over 12 MB — retake it at a lower resolution' },
      { status: 400 },
    )
  }

  const order = await prisma.order.findUnique({
    where: { id },
    select: {
      id: true,
      orderNumber: true,
      lineItems: {
        select: { id: true, description: true, quantity: true, inventoryItem: { select: { code: true } } },
        orderBy: { sortOrder: 'asc' },
      },
    },
  })
  if (!order) return NextResponse.json({ error: 'order not found' }, { status: 404 })
  if (order.lineItems.length === 0) {
    return NextResponse.json({ error: 'this order has no lines to read against' }, { status: 400 })
  }

  const data = Buffer.from(await file.arrayBuffer())

  // Store first. If the AI read fails we still have the paper, and the
  // supervisor can type it in with the photo attached to the report.
  const stored = await uploadPrivateImage({
    keyPrefix: 'pick-sheets',
    ownerId: order.id,
    filename: file.name || `pick-sheet-${order.orderNumber}.jpg`,
    contentType: file.type,
    data,
  })

  // The printed lines, by the index they carry on the page. The PDF
  // renders lineItems in sortOrder, so this sequence matches the paper.
  const printed: PrintedLine[] = order.lineItems.map((l, i) => ({
    index: i + 1,
    orderLineItemId: l.id,
    description: l.description,
    code: l.inventoryItem?.code ?? null,
    ordered: l.quantity,
  }))

  let read
  try {
    read = await readPickSheetPhoto({ data, mimeType: file.type, lines: printed, edge })
  } catch (err) {
    console.error('[check-report/photo] read failed:', err)
    return NextResponse.json(
      {
        ok: true,
        photoKey: stored.blobKey,
        photoUrl: stored.fileUrl,
        // Not an error response: the photo IS attached, and the
        // supervisor can still type the sheet in. Saying "couldn't
        // read it" beats a 500 that loses the upload.
        read: null,
        error: 'The photo was saved but could not be read — type the sheet in.',
      },
      { status: 200 },
    )
  }

  // Wrong sheet check. A supervisor with a stack of paper WILL photograph
  // the wrong one, and pre-filling one order's counts from another
  // order's sheet is the worst thing this feature could do.
  const seen = (read.orderNumber ?? '').replace(/\s+/g, '').toUpperCase()
  const mine = order.orderNumber.replace(/\s+/g, '').toUpperCase()
  const mismatch = seen && !seen.includes(mine) && !mine.includes(seen) ? read.orderNumber : null

  return NextResponse.json({
    ok: true,
    photoKey: stored.blobKey,
    photoUrl: stored.fileUrl,
    mismatch,
    // Map the model's page indexes back onto real line ids here, so the
    // browser never has to trust an index.
    read: {
      preppedBy: read.preppedBy,
      notes: read.notes,
      unreadable: read.unreadable,
      extras: read.extras,
      lines: read.lines
        .map((l) => {
          const p = printed.find((x) => x.index === l.index)
          return p
            ? {
                orderLineItemId: p.orderLineItemId,
                actualQty: l.actualQty,
                note: l.note,
                confidence: l.confidence,
              }
            : null
        })
        .filter(Boolean),
    },
  })
}
