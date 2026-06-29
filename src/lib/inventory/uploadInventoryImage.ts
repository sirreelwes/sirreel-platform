/**
 * Inventory item image upload helper.
 *
 * Thin wrapper over the shared private-image uploader
 * (`src/lib/blob/uploadPrivateImage.ts`) — the HQ Vercel Blob store is
 * PRIVATE, so the returned URL 403s on a direct fetch and inventory photos
 * are served back through the gated proxy `GET /api/inventory/items/[id]/image`
 * via `streamPrivateBlobAsResponse`.
 *
 * Key path: `inventory/{yyyy}/{mm}/{uuid}-{itemId}-{filenameSegment}`
 * Callers persist the returned `fileUrl` on `InventoryItem.imageUrl`.
 */

import { uploadPrivateImage, safeFilenameSegment } from '@/lib/blob/uploadPrivateImage'

/** @deprecated use `safeFilenameSegment` from `@/lib/blob/uploadPrivateImage`. */
export const safeInventoryFilenameSegment = safeFilenameSegment

export interface UploadInventoryImageArgs {
  itemId: string
  filename: string
  contentType: string
  data: Buffer
}

export async function uploadInventoryImage(args: UploadInventoryImageArgs): Promise<{ fileUrl: string; blobKey: string }> {
  return uploadPrivateImage({
    keyPrefix: 'inventory',
    ownerId: args.itemId,
    filename: args.filename,
    contentType: args.contentType,
    data: args.data,
  })
}
