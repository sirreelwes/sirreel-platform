/**
 * Shared PDF intake for filed agreements.
 *
 * Extracted from /api/jobs/[id]/agreements when the company-level filing
 * route was added: two routes that accept the same document must validate it
 * the same way, or a master filed from the company page gets weaker checks
 * than the identical file filed from a job.
 */
import { randomUUID } from 'crypto'
import { put } from '@vercel/blob'

export const MAX_AGREEMENT_BYTES = 25 * 1024 * 1024
export const ALLOWED_CONTRACT_TYPES = new Set(['RENTAL_AGREEMENT', 'STAGE_CONTRACT'])

export function safeSeg(s: string): string {
  return s.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120)
}

export async function readAgreementPdf(
  file: unknown,
): Promise<{ buffer: Buffer; name: string; size: number } | { error: string }> {
  if (!(file instanceof File)) return { error: 'Please attach a PDF file.' }
  if (file.size === 0) return { error: 'That file is empty.' }
  if (file.size > MAX_AGREEMENT_BYTES) {
    return {
      error: `That file is too large (max 25 MB). It is ${(file.size / 1024 / 1024).toFixed(1)} MB.`,
    }
  }
  const buffer = Buffer.from(await file.arrayBuffer())
  // Sniff the magic bytes rather than trusting the declared MIME type — the
  // browser's content-type is caller-supplied and a mislabelled file would be
  // stored as a contract nobody can open.
  if (buffer.subarray(0, 5).toString('latin1') !== '%PDF-') {
    return { error: 'That doesn’t look like a PDF.' }
  }
  return { buffer, name: (file.name || 'agreement.pdf').slice(0, 250), size: file.size }
}

/** PRIVATE store — these are signed contracts, never publicly addressable. */
export async function storePrivateAgreementPdf(
  prefix: string,
  filename: string,
  buffer: Buffer,
): Promise<{ fileUrl: string; blobKey: string }> {
  const blobKey = `${prefix}/${randomUUID()}-${safeSeg(filename)}`
  const blob = await put(blobKey, buffer, {
    access: 'private' as 'public',
    contentType: 'application/pdf',
  })
  return { fileUrl: blob.url, blobKey }
}

/** Form-field date parse. Blank → null; unparseable → null. */
export function parseFormDate(form: FormData, key: string): Date | null {
  const raw = (form.get(key) || '').toString().trim()
  if (!raw) return null
  const d = new Date(raw)
  return Number.isNaN(d.getTime()) ? null : d
}
