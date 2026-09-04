import { NextRequest, NextResponse } from 'next/server'
import { put } from '@vercel/blob'
import { randomUUID } from 'crypto'
import { requireCollectionsUser } from '@/lib/collections/access'
import { safeFilenameSegment } from '@/lib/claims/uploadClaimDocument'

export const dynamic = 'force-dynamic'

/**
 * POST /api/collections/upload — stash a document an operator drops into the
 * collections screen.
 *
 * Two kinds, because they are different documents with different senders:
 *   invoice    (default) the RentalWorks invoice PDF, attached to a charge.
 *   remittance the proof the CLIENT sent that they have paid — an ACH advice,
 *              a wire confirmation, a screenshot of their AP portal. Images
 *              are allowed here and nowhere else: what arrives is whatever
 *              their accounting department could export, and refusing a PNG
 *              would just send it back to living in Ana's inbox.
 *
 * PRIVATE blob, same pattern as COI and claim documents. These are financial
 * documents naming clients and amounts; a public blob URL is guessable-adjacent
 * and permanent, so they go behind the server-side proxy like every other
 * sensitive upload here.
 *
 * The returned url/key are stored on the row they belong to — the
 * RwCollectionCharge for an invoice, the JobFinalInvoice for a remittance — so
 * a payment can always be traced back to its paperwork.
 */

const MAX_BYTES = 15 * 1024 * 1024

/** What a remittance advice actually arrives as. */
const REMITTANCE_TYPES = [
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/heic',
  'image/heif',
  'image/webp',
]

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
  const kind = form?.get('kind') === 'remittance' ? 'remittance' : 'invoice'

  // RW exports PDFs. Accepting arbitrary types here would let a stray upload
  // land in the same keyspace as financial records.
  if (kind === 'invoice' && file.type && file.type !== 'application/pdf') {
    return NextResponse.json({ ok: false, error: 'PDF only' }, { status: 400 })
  }
  if (kind === 'remittance' && file.type && !REMITTANCE_TYPES.includes(file.type)) {
    return NextResponse.json(
      { ok: false, error: 'a remittance proof must be a PDF or an image' },
      { status: 400 },
    )
  }

  const now = new Date()
  const yyyy = now.getUTCFullYear()
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0')
  const prefix = kind === 'remittance' ? 'collections/remittance' : 'collections'
  const fallbackName = kind === 'remittance' ? 'remittance.pdf' : 'invoice.pdf'
  const blobKey = `${prefix}/${yyyy}/${mm}/${randomUUID()}-${safeFilenameSegment(file.name || fallbackName)}`

  try {
    const blob = await put(blobKey, file, { access: 'private' as 'public' })
    // pdfUrl/pdfKey are the names the charge panel has always read; url/key
    // are the honest ones now that this route also takes images.
    return NextResponse.json({
      ok: true,
      pdfUrl: blob.url,
      pdfKey: blobKey,
      url: blob.url,
      key: blobKey,
      name: file.name || fallbackName,
    })
  } catch (err) {
    console.error('[collections] upload failed:', err)
    return NextResponse.json({ ok: false, error: 'upload failed' }, { status: 500 })
  }
}
