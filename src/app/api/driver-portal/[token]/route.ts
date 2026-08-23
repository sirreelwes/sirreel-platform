import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

/**
 * GET /api/driver-portal/[token] — what the driver portal needs to render
 * itself. NO LOGIN: the token is the credential, so this returns the bare
 * minimum and never echoes back licence numbers, DOB or image URLs — a
 * driver who already uploaded should not be able to re-read their own
 * data off a link someone else may now hold.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const driver = await prisma.driver.findUnique({
    where: { portalToken: token },
    select: {
      id: true, firstName: true, portalExpiresAt: true,
      licenseFrontUrl: true, licenseBackUrl: true, licenseUploadedAt: true,
    },
  })
  if (!driver) return NextResponse.json({ error: 'invalid link' }, { status: 404 })
  if (driver.portalExpiresAt && driver.portalExpiresAt < new Date()) {
    return NextResponse.json({ error: 'expired', expired: true }, { status: 410 })
  }
  return NextResponse.json({
    ok: true,
    firstName: driver.firstName,
    // Booleans only — never the URLs.
    hasFront: !!driver.licenseFrontUrl,
    hasBack: !!driver.licenseBackUrl,
    uploadedAt: driver.licenseUploadedAt,
  })
}
