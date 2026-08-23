import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

/**
 * GET /api/drivers/list — the staff Guest Drivers roster. Separate from
 * GET /api/drivers, which stays a lean name-only picker for the dispatch
 * assign modal; this one carries licence state for the roster table.
 *
 * Licence NUMBER is deliberately not returned. Staff who need to read the
 * card open the image through the authed proxy; there is no reason for a
 * list view to spray licence numbers across the page.
 */
export async function GET() {
  const session = await getServerSession()
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  }
  const drivers = await prisma.driver.findMany({
    orderBy: [{ isActive: 'desc' }, { lastName: 'asc' }, { firstName: 'asc' }],
    select: {
      id: true, firstName: true, lastName: true, phone: true, email: true,
      type: true, isActive: true, flagged: true, flagReason: true,
      totalCheckouts: true, damageIncidents: true,
      licenseState: true, licenseExpiry: true, licenseExpired: true,
      licenseClass: true, licenseUploadedAt: true,
      licenseFrontUrl: true, licenseBackUrl: true,
      licenseVerified: true, licenseVerifiedAt: true,
      portalToken: true, portalExpiresAt: true,
      company: { select: { id: true, name: true } },
    },
  })
  return NextResponse.json({
    drivers: drivers.map((d) => ({
      id: d.id,
      name: `${d.firstName} ${d.lastName}`.trim(),
      phone: d.phone, email: d.email, type: d.type,
      isActive: d.isActive, flagged: d.flagged, flagReason: d.flagReason,
      totalCheckouts: d.totalCheckouts, damageIncidents: d.damageIncidents,
      companyName: d.company?.name ?? null,
      licenseState: d.licenseState,
      licenseExpiry: d.licenseExpiry,
      licenseExpired: d.licenseExpired,
      licenseClass: d.licenseClass,
      licenseUploadedAt: d.licenseUploadedAt,
      // Booleans, never URLs — the images are fetched through the proxy.
      hasFront: !!d.licenseFrontUrl,
      hasBack: !!d.licenseBackUrl,
      licenseVerified: d.licenseVerified,
      licenseVerifiedAt: d.licenseVerifiedAt,
      hasLiveLink: !!d.portalToken && (!d.portalExpiresAt || d.portalExpiresAt > new Date()),
    })),
  })
}
