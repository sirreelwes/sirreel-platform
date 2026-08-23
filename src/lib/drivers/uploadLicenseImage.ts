/**
 * Private-Blob upload helper for driver's licence images. Mirrors
 * src/lib/coi/uploadCoiDocument.ts and src/lib/wc/uploadWcDocument.ts.
 *
 * A licence image is among the most sensitive things this system holds —
 * name, DOB, address and licence number on one card — so the blob is
 * PRIVATE and is only ever served back through the authed staff proxy at
 * /api/drivers/[id]/license/[side]. The blob URL is never sent to a
 * browser, not even to staff.
 */

import { put } from '@vercel/blob'
import { randomUUID } from 'crypto'
import { safeFilenameSegment } from '@/lib/claims/uploadClaimDocument'

export type LicenseSide = 'front' | 'back'

export interface UploadLicenseImageArgs {
  driverId: string
  side: LicenseSide
  filename: string
  contentType: string
  data: Buffer
}

export async function uploadLicenseImage(
  args: UploadLicenseImageArgs,
): Promise<{ fileUrl: string; blobKey: string }> {
  const { driverId, side, filename, contentType, data } = args
  const blobKey = `driver-license/${driverId}/${side}-${randomUUID()}-${safeFilenameSegment(filename)}`
  const blob = await put(blobKey, data, { access: 'private' as 'public', contentType })
  return { fileUrl: blob.url, blobKey }
}
