/**
 * Order-attached document upload helper. Mirrors
 * src/lib/claims/uploadClaimDocument.ts with an `orders/{yyyy}/{mm}/...`
 * key path. Returns the hosted Blob URL — callers persist it on
 * `OrderDocument.fileUrl`.
 *
 * Why hosted (not data: URI)? Gmail blocks `data:` URIs in client-
 * facing email; the candid would render as a broken box for a large
 * share of recipients. Vercel Blob's effective access for `put()`
 * uploads makes the returned URL fetchable by URL knowledge, which
 * is exactly what an `<img src>` needs.
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
    access: 'public',
    contentType,
  })
  return { fileUrl: blob.url, blobKey }
}
