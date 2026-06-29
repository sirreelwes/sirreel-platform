/**
 * Shared private-image upload to the HQ Vercel Blob store.
 *
 * The HQ Blob store is PRIVATE — a `put` with `access: 'public'` throws
 * `BlobError: Cannot use public access on a private store`. So we use
 * `access: 'private'` (the SDK type only exposes the `'public'` literal,
 * hence the cast; the private store accepts the same call shape) like
 * every other blob writer in the app.
 *
 * The returned URL 403s on a direct fetch — it CANNOT be used as a plain
 * `<img src>`. Callers persist `fileUrl` on their model and serve it back
 * through a session-gated proxy route via `streamPrivateBlobAsResponse`.
 *
 * Key path: `{keyPrefix}/{yyyy}/{mm}/{uuid}-{ownerId}-{filenameSegment}`
 * (e.g. `inventory/...`, `asset-categories/...`).
 */

import { put } from '@vercel/blob'
import { randomUUID } from 'crypto'

export function safeFilenameSegment(name: string): string {
  return (
    name
      .replace(/[\\/\x00-\x1f]+/g, '_')
      .replace(/\s+/g, '_')
      .slice(0, 180) || 'image'
  )
}

export interface UploadPrivateImageArgs {
  /** Blob key namespace, e.g. 'inventory' or 'asset-categories'. */
  keyPrefix: string
  /** The owning record id — embedded in the key for traceability. */
  ownerId: string
  filename: string
  contentType: string
  data: Buffer
}

export async function uploadPrivateImage(
  args: UploadPrivateImageArgs,
): Promise<{ fileUrl: string; blobKey: string }> {
  const now = new Date()
  const yyyy = String(now.getUTCFullYear())
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0')
  const blobKey = `${args.keyPrefix}/${yyyy}/${mm}/${randomUUID()}-${args.ownerId}-${safeFilenameSegment(args.filename)}`
  const blob = await put(blobKey, args.data, {
    // Store is private (see file header). Cast: the SDK type only exposes
    // 'public', but the private store accepts the same call.
    access: 'private' as 'public',
    contentType: args.contentType,
  })
  return { fileUrl: blob.url, blobKey }
}
