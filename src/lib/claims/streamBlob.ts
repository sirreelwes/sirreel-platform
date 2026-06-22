/**
 * Shared private-blob → HTTP-stream helper for claims/incidents/COI
 * downloads. The SirReel-HQ canonical pattern for serving private
 * Vercel blobs is server-side proxy (the SDK has no signed-URL API as
 * of @vercel/blob 1.x — `getDownloadUrl` is a URL rewriter, not a
 * credential miner). Mirrors src/app/api/portal/job/invoice/[id]/pdf
 * and the contract-review file routes.
 *
 * Inline vs attachment disposition:
 *   - PDFs + images → inline (open in a new tab as expected)
 *   - everything else → attachment (force-download)
 * The inline-friendly set is conservative on purpose. Anything we're
 * not sure renders cleanly in-browser becomes an explicit download.
 */

import { NextResponse } from 'next/server'
import { get as getBlob } from '@vercel/blob'

const INLINE_CONTENT_TYPES = new Set<string>([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/svg+xml',
  'image/heic',
  'image/heif',
])

function sanitizeFilename(name: string): string {
  // Strip path separators + control chars so a downstream
  // Content-Disposition header can't be tricked into anything weird.
  // RFC 6266 only cares about the file part — strip CR/LF + quotes,
  // collapse the rest. Allow common punctuation.
  return name.replace(/[\r\n"\\]/g, '').slice(0, 200) || 'document'
}

/**
 * Stream a private blob back to the caller. `fileUrl` is the full
 * Vercel Blob URL stored on ClaimDocument.fileUrl / CoiCheck.fileUrl;
 * `@vercel/blob`'s `get()` accepts either a full URL or a pathname.
 *
 * Returns a Response that callers can return directly from a route.
 * 404 on a missing blob, 502 on an unexpected blob-service error —
 * we deliberately don't leak the underlying SDK error message to the
 * client.
 */
export async function streamPrivateBlobAsResponse(args: {
  fileUrl: string
  /** Display filename used in Content-Disposition. */
  filename: string
}): Promise<Response> {
  let blob
  try {
    blob = await getBlob(args.fileUrl, { access: 'private' })
  } catch {
    return NextResponse.json({ error: 'blob unreachable' }, { status: 502 })
  }
  if (!blob || blob.statusCode !== 200 || !blob.stream) {
    return NextResponse.json({ error: 'blob not found' }, { status: 404 })
  }
  const contentType = blob.blob.contentType || 'application/octet-stream'
  const disposition = INLINE_CONTENT_TYPES.has(contentType.toLowerCase()) ? 'inline' : 'attachment'
  const safeName = sanitizeFilename(args.filename)
  return new Response(blob.stream, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Content-Disposition': `${disposition}; filename="${safeName}"`,
      // Matches the invoice/contract proxy pattern: never let the
      // browser cache a private-blob proxy response — the URL is
      // session-scoped and we don't want a CDN to learn it.
      'Cache-Control': 'no-store',
    },
  })
}
