/**
 * Shared Gmail-attachment plumbing.
 *
 * Both the claims onboarding pipeline (src/lib/claims/onboardFromEmail)
 * and the HR ingest pipeline (src/lib/hr/onboardFromHrEmail) need to:
 *   1. Authenticate to a watched inbox via the DWD service account
 *   2. Walk the Gmail MIME tree to enumerate attachments
 *   3. Download each attachment's bytes
 *   4. Upload those bytes to Vercel Blob under a domain-specific key
 *
 * The per-attachment side effect (create a ClaimDocument vs an
 * HrAttachment row) is domain-specific and stays in the caller — the
 * helper just hands back the downloaded buffer + uploaded URL via a
 * callback. This keeps the lift behavior-neutral for the claims path:
 * the same Gmail call, same Blob write, same byte-for-byte upload key
 * convention. Tested against the existing NEEDS_REVIEW fixture before
 * the HR pipeline builds on top.
 */

import { google } from 'googleapis'
import { extractBodyFromGmailPayload, type GmailMessagePart } from '@/lib/email/body'

const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024

export interface GmailAttachmentMeta {
  filename: string
  mimeType: string
  attachmentId: string
  size: number
}

export interface FetchedGmailMessage {
  bodyText: string | null
  attachments: GmailAttachmentMeta[]
  payload: GmailMessagePart | undefined
}

/** DWD-impersonating Gmail client for a watched inbox. */
export function getGmailClientForInbox(impersonate: string) {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_KEY || '{}'
  const creds = JSON.parse(raw)
  const auth = new google.auth.JWT(
    creds.client_email,
    undefined,
    creds.private_key,
    ['https://www.googleapis.com/auth/gmail.readonly'],
    impersonate,
  )
  return google.gmail({ version: 'v1', auth })
}

function walkForAttachments(
  payload: GmailMessagePart | undefined | null,
  out: GmailAttachmentMeta[],
): void {
  if (!payload) return
  if (payload.filename && payload.body?.attachmentId) {
    out.push({
      filename: payload.filename,
      mimeType: payload.mimeType || 'application/octet-stream',
      attachmentId: payload.body.attachmentId,
      size: payload.body.size || 0,
    })
  }
  if (payload.parts) {
    for (const child of payload.parts) walkForAttachments(child, out)
  }
}

/**
 * Fetch a Gmail message with format=full, return body text + attachment
 * metadata + the raw payload. Used by both the claims body re-fetch and
 * the HR ingest. Returns null on any error so callers can fall back to
 * whatever they have stored locally.
 */
export async function fetchGmailMessageFull(
  inbox: string,
  gmailMessageId: string,
): Promise<FetchedGmailMessage | null> {
  try {
    const gmail = getGmailClientForInbox(inbox)
    const res = await gmail.users.messages.get({
      userId: 'me',
      id: gmailMessageId,
      format: 'full',
    })
    const payload = res.data.payload as GmailMessagePart | undefined
    const body = extractBodyFromGmailPayload(payload)
    const attachments: GmailAttachmentMeta[] = []
    walkForAttachments(payload, attachments)
    return { bodyText: body.bodyText, attachments, payload }
  } catch (err) {
    console.warn('[persistGmailAttachments] fetch failed for', inbox, gmailMessageId, err instanceof Error ? err.message : err)
    return null
  }
}

export interface DownloadedAttachment {
  filename: string
  mimeType: string
  /** Bytes downloaded from Gmail and uploaded to Blob. */
  buf: Buffer
  /** Public-but-private-access blob URL. Persist on the domain row. */
  fileUrl: string
  bytes: number
}

/**
 * Download one attachment from Gmail and upload it to Vercel Blob.
 * Caller supplies the blob-key builder so each domain (claims vs HR)
 * can keep its own key convention. Returns null when the attachment is
 * over the size cap, Gmail returns no data, or any error fires — the
 * caller treats null as "skip this one and keep going".
 */
export async function downloadAndUploadAttachment(args: {
  inbox: string
  gmailMessageId: string
  attachment: GmailAttachmentMeta
  buildBlobKey: (att: GmailAttachmentMeta) => string
  /** Lazy because we only need it when the helper actually uploads —
   *  avoids forcing every caller to import @vercel/blob at the top. */
  put: (key: string, data: Buffer, opts: { access: string; contentType: string }) => Promise<{ url: string }>
}): Promise<DownloadedAttachment | null> {
  const { inbox, gmailMessageId, attachment, buildBlobKey, put } = args
  if (attachment.size > MAX_ATTACHMENT_BYTES) {
    console.warn(`[persistGmailAttachments] attachment too large (${attachment.size} bytes): ${attachment.filename}`)
    return null
  }
  try {
    const gmail = getGmailClientForInbox(inbox)
    const res = await gmail.users.messages.attachments.get({
      userId: 'me',
      messageId: gmailMessageId,
      id: attachment.attachmentId,
    })
    const data = res.data.data
    if (!data) return null
    const buf = Buffer.from(data, 'base64url')
    const blobKey = buildBlobKey(attachment)
    const blob = await put(blobKey, buf, {
      access: 'private',
      contentType: attachment.mimeType,
    })
    return {
      filename: attachment.filename,
      mimeType: attachment.mimeType,
      buf,
      fileUrl: blob.url,
      bytes: buf.length,
    }
  } catch (err) {
    console.warn(`[persistGmailAttachments] download/upload failed for ${attachment.filename}:`, err instanceof Error ? err.message : err)
    return null
  }
}

/**
 * Iterate every attachment on a Gmail message: download, upload to
 * Blob, hand the downloaded buffer + blob URL to the caller's
 * per-attachment callback. The callback creates the domain-specific
 * row (ClaimDocument vs HrAttachment) and decides what to do with the
 * buffer (e.g. pass through to a classifier).
 *
 * Returns the count of attachments the callback successfully
 * processed (callback's resolved-truthy count). One failure doesn't
 * abort the loop.
 */
export async function forEachInboxAttachment<T>(args: {
  inbox: string
  gmailMessageId: string
  attachments: GmailAttachmentMeta[]
  buildBlobKey: (att: GmailAttachmentMeta) => string
  put: (key: string, data: Buffer, opts: { access: string; contentType: string }) => Promise<{ url: string }>
  onAttachment: (downloaded: DownloadedAttachment) => Promise<T | null>
}): Promise<number> {
  const { inbox, gmailMessageId, attachments, buildBlobKey, put, onAttachment } = args
  if (attachments.length === 0) return 0
  let processed = 0
  for (const att of attachments) {
    const downloaded = await downloadAndUploadAttachment({
      inbox, gmailMessageId, attachment: att, buildBlobKey, put,
    })
    if (!downloaded) continue
    try {
      const out = await onAttachment(downloaded)
      if (out !== null && out !== undefined) processed += 1
    } catch (err) {
      console.warn(`[persistGmailAttachments] onAttachment threw for ${att.filename}:`, err instanceof Error ? err.message : err)
    }
  }
  return processed
}
