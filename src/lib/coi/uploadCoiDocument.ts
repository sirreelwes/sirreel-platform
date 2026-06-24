/**
 * Private-Blob upload helper for client-facing COI PDFs. Mirrors
 * src/lib/claims/uploadClaimDocument.ts — same `put(..., access:'private')`
 * pattern, COI keyspace. COIs are sensitive (insurance certs), so the blob
 * is PRIVATE; the team views it via the server-side proxy in
 * src/lib/claims/streamBlob.ts (streamPrivateBlobAsResponse).
 */

import { put } from '@vercel/blob'
import { randomUUID } from 'crypto'
import { safeFilenameSegment } from '@/lib/claims/uploadClaimDocument'

export interface UploadCoiDocumentArgs {
  filename: string
  contentType: string
  data: Buffer
}

export async function uploadCoiDocument(
  args: UploadCoiDocumentArgs,
): Promise<{ fileUrl: string; blobKey: string }> {
  const { filename, contentType, data } = args
  const now = new Date()
  const yyyy = String(now.getUTCFullYear())
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0')
  const blobKey = `coi/${yyyy}/${mm}/${randomUUID()}-${safeFilenameSegment(filename)}`
  const blob = await put(blobKey, data, {
    access: 'private' as 'public',
    contentType,
  })
  return { fileUrl: blob.url, blobKey }
}
