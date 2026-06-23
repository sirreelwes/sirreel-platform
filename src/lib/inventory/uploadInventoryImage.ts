/**
 * Inventory item image upload helper.
 *
 * The HQ Vercel Blob store is configured PRIVATE — a `put` with
 * `access: 'public'` throws `BlobError: Cannot use public access on a
 * private store`, which is what surfaced as a hard 500 on every photo
 * upload. So we use `access: 'private'` like every other blob writer in
 * the app (invoices, claims, gmail attachments). The `@vercel/blob`
 * types only expose the `'public'` literal, hence the cast; the private
 * store accepts the same call shape.
 *
 * Because the store is private, the returned URL 403s on a direct
 * fetch — it CANNOT be used as a plain `<img src>`. Inventory photos
 * are served back through the gated proxy `GET /api/inventory/items/
 * [id]/image`, which streams the blob via `streamPrivateBlobAsResponse`.
 *
 * Key path: `inventory/{yyyy}/{mm}/{uuid}-{itemId}-{filenameSegment}`
 * Callers persist the returned `fileUrl` on `InventoryItem.imageUrl`.
 */

import { put } from '@vercel/blob'
import { randomUUID } from 'crypto'

export function safeInventoryFilenameSegment(name: string): string {
  return name
    .replace(/[\\/\x00-\x1f]+/g, '_')
    .replace(/\s+/g, '_')
    .slice(0, 180) || 'image'
}

export interface UploadInventoryImageArgs {
  itemId: string
  filename: string
  contentType: string
  data: Buffer
}

export async function uploadInventoryImage(args: UploadInventoryImageArgs): Promise<{ fileUrl: string; blobKey: string }> {
  const { itemId, filename, contentType, data } = args
  const now = new Date()
  const yyyy = String(now.getUTCFullYear())
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0')
  const blobKey = `inventory/${yyyy}/${mm}/${randomUUID()}-${itemId}-${safeInventoryFilenameSegment(filename)}`
  const blob = await put(blobKey, data, {
    // Store is private (see file header). Cast: the SDK type only
    // exposes 'public', but the private store accepts the same call.
    access: 'private' as 'public',
    contentType,
  })
  return { fileUrl: blob.url, blobKey }
}
