import { NextRequest, NextResponse } from 'next/server'
import { put } from '@vercel/blob'
import { randomUUID } from 'crypto'
import { requireCollectionsUser } from '@/lib/collections/access'
import { safeFilenameSegment } from '@/lib/claims/uploadClaimDocument'

export const dynamic = 'force-dynamic'

/**
 * POST /api/collections/upload — stash the RentalWorks invoice PDF that an
 * operator drops in before taking a payment.
 *
 * PRIVATE blob, same pattern as COI and claim documents. These are financial
 * documents naming clients and amounts; a public blob URL is guessable-adjacent
 * and permanent, so they go behind the server-side proxy like every other
 * sensitive upload here.
 *
 * The returned url/key are stored on the RwCollectionCharge row so a payment
 * can always be traced back to the invoice it settled.
 */

const MAX_BYTES = 15 * 1024 * 1024

export async function POST(req: NextRequest) {
  const user = await requireCollectionsUser()
  if (!user) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 403 })

  const form = await req.formData().catch(() => null)
  const file = form?.get('file')
  if (!(file instanceof File)) {
    return NextResponse.json({ ok: false, error: 'file required' }, { status: 400 })
  }
  if (file.size === 0 || file.size > MAX_BYTES) {
    return NextResponse.json(
      { ok: false, error: `file must be between 1 byte and ${MAX_BYTES / 1024 / 1024}MB` },
      { status: 400 },
    )
  }
  // RW exports PDFs. Accepting arbitrary types here would let a stray upload
  // land in the same keyspace as financial records.
  if (file.type && file.type !== 'application/pdf') {
    return NextResponse.json({ ok: false, error: 'PDF only' }, { status: 400 })
  }

  const now = new Date()
  const yyyy = now.getUTCFullYear()
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0')
  const blobKey = `collections/${yyyy}/${mm}/${randomUUID()}-${safeFilenameSegment(file.name || 'invoice.pdf')}`

  try {
    const blob = await put(blobKey, file, { access: 'private' as 'public' })
    return NextResponse.json({ ok: true, pdfUrl: blob.url, pdfKey: blobKey })
  } catch (err) {
    console.error('[collections] upload failed:', err)
    return NextResponse.json({ ok: false, error: 'upload failed' }, { status: 500 })
  }
}
