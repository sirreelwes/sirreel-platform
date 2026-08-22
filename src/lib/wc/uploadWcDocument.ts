/**
 * Private-Blob upload helper for client-facing Workers' Comp certificates.
 * Mirrors src/lib/coi/uploadCoiDocument.ts — same `put(..., access:'private')`
 * pattern, WC keyspace. A WC cert is an insurance document and just as
 * sensitive as a COI, so the blob is PRIVATE; staff view it through the
 * server-side proxy in src/lib/claims/streamBlob.ts.
 *
 * This replaces the previous storage approach, which inlined the whole
 * file as a base64 `data:` URI in a TEXT column — that both bloated the
 * row and, because the column was never actually created, silently lost
 * every upload.
 */

import { put } from '@vercel/blob'
import { randomUUID } from 'crypto'
import { safeFilenameSegment } from '@/lib/claims/uploadClaimDocument'

export interface UploadWcDocumentArgs {
  filename: string
  contentType: string
  data: Buffer
}

export async function uploadWcDocument(
  args: UploadWcDocumentArgs,
): Promise<{ fileUrl: string; blobKey: string }> {
  const { filename, contentType, data } = args
  const now = new Date()
  const yyyy = String(now.getUTCFullYear())
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0')
  const blobKey = `wc/${yyyy}/${mm}/${randomUUID()}-${safeFilenameSegment(filename)}`
  const blob = await put(blobKey, data, {
    access: 'private' as 'public',
    contentType,
  })
  return { fileUrl: blob.url, blobKey }
}
