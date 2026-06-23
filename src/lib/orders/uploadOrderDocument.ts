/**
 * Order-attached document upload helper. Mirrors
 * src/lib/claims/uploadClaimDocument.ts with an `orders/{yyyy}/{mm}/...`
 * key path. Returns the hosted Blob URL — callers persist it on
 * `OrderDocument.fileUrl`.
 *
 * The HQ Vercel Blob store is configured PRIVATE — `access: 'public'`
 * throws `BlobError: Cannot use public access on a private store`,
 * which was 500ing every order-document upload. So we use
 * `access: 'private'` like the rest of the app (the SDK type only
 * exposes 'public', hence the cast; the private store takes the same
 * call). See the inventory fix in c19e928 for the identical root cause.
 *
 * Display: the returned URL 403s on a direct fetch, so it can NOT be
 * used as a raw `<img src>`/`<a href>`. JOB_PHOTO candids are served
 * back through the public-by-uuid proxy `GET /api/orders/documents/
 * [docId]/photo` (see src/lib/orders/orderPhotoProxy.ts) — public
 * because the thank-you email embeds the photo for an external,
 * unauthenticated recipient (a session-gated proxy would 403 in their
 * inbox); the unguessable OrderDocument.id is the access gate, which
 * matches the original public-by-URL-knowledge posture.
 */

import { put } from '@vercel/blob'
import { randomUUID } from 'crypto'

export function safeOrderFilenameSegment(name: string): string {
  return name
    .replace(/[\\/\x00-\x1f]+/g, '_')
    .replace(/\s+/g, '_')
    .slice(0, 180) || 'attachment'
}

export interface UploadOrderDocumentArgs {
  orderNumber: string
  filename: string
  contentType: string
  data: Buffer | string
  /** Optional suffix that lands in the key — e.g. "jobphoto" for the
   *  thank-you flow's candid uploads. Defaults to "doc". */
  kindSuffix?: string
}

export async function uploadOrderDocument(args: UploadOrderDocumentArgs): Promise<{ fileUrl: string; blobKey: string }> {
  const { orderNumber, filename, contentType, data, kindSuffix = 'doc' } = args
  const now = new Date()
  const yyyy = String(now.getUTCFullYear())
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0')
  const blobKey = `orders/${yyyy}/${mm}/${randomUUID()}-${orderNumber}-${kindSuffix}-${safeOrderFilenameSegment(filename)}`
  const blob = await put(blobKey, data, {
    // Store is private (see file header). Cast: the SDK type only
    // exposes 'public', but the private store accepts the same call.
    access: 'private' as 'public',
    contentType,
  })
  return { fileUrl: blob.url, blobKey }
}
