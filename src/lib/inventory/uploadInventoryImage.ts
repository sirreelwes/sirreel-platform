/**
 * Inventory item image upload helper. Mirrors
 * src/lib/orders/uploadOrderDocument.ts — same `access: 'public'`
 * pattern (the returned URL is the only handle to the blob; URL knowledge
 * IS the access gate). Public is right here because inventory thumbs
 * are rendered as plain `<img src>` in lists; a per-image proxy hop
 * would tank list scroll performance for no security benefit (these
 * are pictures of equipment, not COIs).
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
    access: 'public',
    contentType,
  })
  return { fileUrl: blob.url, blobKey }
}
