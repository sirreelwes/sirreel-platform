import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth-admin'
import { prisma } from '@/lib/prisma'
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

  // updatedBy is a User id (or the literal 'system' for an automatic
  // renewal). Rendering it raw put "6b1d11bd-96ef-4e3c-86d3-adf37792e2eb"
  // on the card where a person's name belongs.
  let updatedByName: string | null = null
  if (status.updatedBy === 'system') {
    updatedByName = 'HQ, automatically'
  } else if (status.updatedBy) {
    const u = await prisma.user
      .findUnique({ where: { id: status.updatedBy }, select: { name: true, email: true } })
      .catch(() => null)
    updatedByName = u?.name || u?.email || null
  }

  return NextResponse.json({
    ok: true,
    ...status,
    updatedByName,
    // Paste + Verify are ADMIN-only; the card uses this to decide whether to
    // render the controls at all, and the write routes enforce it again.
    canManage: user.role === 'ADMIN',
  })
}
