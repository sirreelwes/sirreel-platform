/**
 * GET /api/hr/access
 *
 * Cheap "do I have HR access?" probe for the nav gate. Returns
 * 200 { allowed: true } for allowlisted users, 403 for everyone
 * else (including other admins). The sidebar uses this to decide
 * whether to render the "HR" nav entry — strictly cosmetic, since
 * every actual HR data route is independently allowlist-gated; the
 * nav check is a UX layer only, never an authorization layer.
 */

import { NextResponse } from 'next/server'
import { requireHrAccess } from '@/lib/hr/allowlist'

export const dynamic = 'force-dynamic'

export async function GET() {
  const gate = await requireHrAccess()
  if (gate instanceof NextResponse) return gate
  return NextResponse.json({ allowed: true })
}
