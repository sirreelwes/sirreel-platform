/**
 * Single upload helper for ClaimDocument blob writes. Centralizes the
 * `claims/{yyyy}/{mm}/{uuid}-{claimNumber}-...` key convention so the
 * drag-drop upload route, the email-attachment loop in
 * onboardFromEmail, and the paste-document route all produce identical
 * paths.
 *
 * Returns the public blob URL — callers persist it on
 * ClaimDocument.fileUrl. Throws on blob failure (callers decide how
 * to handle: the drag-drop route surfaces a per-file error; the email
 * loop logs + skips the attachment).
 */

import { put } from '@vercel/blob'
import { randomUUID } from 'crypto'

// Sanitize a user-supplied filename so it's safe to use as a blob key
// segment. Strips path separators + control chars; collapses whitespace.
export function safeFilenameSegment(name: string): string {
  return name
    .replace(/[\\/\x00-\x1f]+/g, '_')
    .replace(/\s+/g, '_')
    .slice(0, 180) || 'attachment'
}

export interface UploadClaimDocumentArgs {
  claimNumber: string
  filename: string
  contentType: string
  data: Buffer | string
  /** Optional suffix that lands in the key — e.g. "email-<gmailId>" for
   *  email body uploads, "att" for attachments. Defaults to "doc". */
  kindSuffix?: string
}

export async function uploadClaimDocument(args: UploadClaimDocumentArgs): Promise<{ fileUrl: string; blobKey: string }> {
  const { claimNumber, filename, contentType, data, kindSuffix = 'doc' } = args
  const now = new Date()
  const yyyy = String(now.getUTCFullYear())
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0')
  const blobKey = `claims/${yyyy}/${mm}/${randomUUID()}-${claimNumber}-${kindSuffix}-${safeFilenameSegment(filename)}`
  const blob = await put(blobKey, data, {
    access: 'private' as 'public',
    contentType,
  })
  return { fileUrl: blob.url, blobKey }
}
