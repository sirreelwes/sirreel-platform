/**
 * POST /api/portal/preview/end — stop previewing a client's portal.
 *
 * Wes 2026-09-12, looking at a client's job page through the staff preview:
 * "there is no back button or close button." There wasn't — the preview
 * dropped you onto the client's page and left you there, on a different host
 * from HQ, with the browser's Back button as the only way out and the preview
 * cookie still live for an hour afterwards.
 *
 * No auth: the only thing this can do is clear a cookie the caller already
 * holds. Clearing someone's own preview is never a privileged act.
 */
import { NextResponse } from 'next/server'
import { buildJobPreviewCookieHeader } from '@/lib/portal/jobPreview'

export const dynamic = 'force-dynamic'

export async function POST() {
  const res = NextResponse.json({ ok: true })
  res.headers.append('Set-Cookie', buildJobPreviewCookieHeader('', { clear: true }))
  return res
}
