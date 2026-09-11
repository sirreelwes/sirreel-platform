/**
 * POST /api/crm/companies/[id]/portal-access/[accessId]/invite/preview
 *
 * What the company-portal invite will say, before it goes — the rep
 * reads it, edits the prose, and only then sends (Wes 2026-09-11: "I'd
 * like to be able to preview and modify the invite email to Nancy and
 * people like her"). Same composer as the send, so the two cannot
 * disagree. Body: { customBody?: string }. Never writes.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireCompanyTermsEditor } from '@/lib/portal/companyTermsEditors'
import { composeCompanyPortalInvite } from '@/lib/portal/composeCompanyInvite'

export const dynamic = 'force-dynamic'

function portalBase(req: NextRequest): string {
  const fromEnv = process.env.NEXT_PUBLIC_APP_URL || process.env.PORTAL_BASE_URL
  if (fromEnv) return fromEnv.replace(/\/$/, '')
  return req.nextUrl.origin.replace(/\/$/, '')
}

export async function POST(req: NextRequest, { params }: { params: { id: string; accessId: string } }) {
  const g = await requireCompanyTermsEditor()
  if ('error' in g) return g.error
  const user = g.user

  const body = (await req.json().catch(() => ({}))) as { customBody?: unknown }
  const customBody =
    typeof body.customBody === 'string' && body.customBody.trim() ? body.customBody.trim().slice(0, 5000) : null

  const composition = await composeCompanyPortalInvite({
    companyId: params.id,
    accessId: params.accessId,
    base: portalBase(req),
    fallbackRep: { name: user.name ?? null, email: user.email ?? null },
    customBody,
  })
  if (!composition.ok) return NextResponse.json({ error: composition.error }, { status: composition.status })
  return NextResponse.json(composition)
}
