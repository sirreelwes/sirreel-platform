/**
 * Server-side fetch of the payment-info email's PRIVATE-Blob PDF
 * attachments (Wes ruled A). These files exist ONLY in private Blob
 * storage and are attached to the outbound email — there is NO public
 * route or proxy that serves them.
 *
 * Fetch failure must NEVER block the email: a slot that errors is
 * dropped and named in `dropped[]` so the caller can send inline
 * details anyway and notify billing@. Never logs file contents —
 * filenames only.
 */

import { get as getBlob } from '@vercel/blob'

export interface PaymentAttachmentSlots {
  achFormKey: string | null
  achFormFilename: string | null
  bankInfoKey: string | null
  bankInfoFilename: string | null
}

export interface FetchedAttachments {
  attachments: Array<{ filename: string; content: Buffer }>
  /** Human labels of slots that were populated but failed to fetch. */
  dropped: string[]
}

async function fetchBlobBuffer(key: string): Promise<Buffer> {
  const blob = await getBlob(key, { access: 'private' })
  if (!blob || blob.statusCode !== 200 || !blob.stream) {
    throw new Error(`blob not retrievable (status ${blob?.statusCode ?? 'none'})`)
  }
  const chunks: Buffer[] = []
  const reader = blob.stream.getReader()
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    if (value) chunks.push(Buffer.from(value))
  }
  return Buffer.concat(chunks)
}

export async function fetchPaymentAttachments(
  slots: PaymentAttachmentSlots,
): Promise<FetchedAttachments> {
  const attachments: Array<{ filename: string; content: Buffer }> = []
  const dropped: string[] = []

  const jobs: Array<{ label: string; key: string; filename: string }> = []
  if (slots.achFormKey) {
    jobs.push({
      label: 'ACH Payment Information Form (bank)',
      key: slots.achFormKey,
      filename: slots.achFormFilename?.trim() || 'ACH-Payment-Information-Form.pdf',
    })
  }
  if (slots.bankInfoKey) {
    jobs.push({
      label: 'ACH / Wire Banking Information (SirReel)',
      key: slots.bankInfoKey,
      filename: slots.bankInfoFilename?.trim() || 'SirReel-Banking-Information.pdf',
    })
  }

  for (const j of jobs) {
    try {
      const content = await fetchBlobBuffer(j.key)
      attachments.push({ filename: j.filename, content })
    } catch (err) {
      // Filename only — never the contents.
      console.error(`[payment-info] attachment fetch failed (${j.filename}):`, err instanceof Error ? err.message : err)
      dropped.push(j.label)
    }
  }

  return { attachments, dropped }
}
