import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth-admin'
import { rwCredentialStatus } from '@/lib/rentalworks/credential'

export const dynamic = 'force-dynamic'

/**
 * GET /api/integrations/rw/status — the RentalWorks connection, as the
 * /collections card and anything else needs it.
 *
 * Readable by BILLING, ADMIN and MANAGER: collections works off the RW
 * mirror, so whether that mirror is being fed is their business. It NEVER
 * returns the token, the ciphertext, or anything derived from either.
 */

const READ_ROLES = new Set(['BILLING', 'ADMIN', 'MANAGER'])

export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  if (!READ_ROLES.has(user.role)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const status = await rwCredentialStatus()
  return NextResponse.json({
    ok: true,
    ...status,
    // Paste + Verify are ADMIN-only; the card uses this to decide whether to
    // render the controls at all, and the write routes enforce it again.
    canManage: user.role === 'ADMIN',
  })
}
