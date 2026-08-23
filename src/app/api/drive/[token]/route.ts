import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { evaluateLicenseGate } from '@/lib/drivers/licenseGate'

export const dynamic = 'force-dynamic'

/**
 * GET /api/drive/[token] — everything the driver's job page renders.
 * NO LOGIN: the token is the credential.
 *
 * ── On gate codes ────────────────────────────────────────────────────
 * This route deliberately does NOT return SiteSetting.gateCode or
 * Asset.accessCode. Both are documented in the schema as "released ONLY
 * through server-side driver verification, never rendered on any
 * public/portal surface", and they are SHARED secrets — the lot code is
 * one value for every driver until someone physically reprograms the
 * gate. Printing it on a page that lives in a driver's inbox for 45 days
 * would leak it permanently to everyone who ever drove for us.
 *
 * Instead the page shows the job's assistantAuthCode — the existing,
 * purpose-built high-entropy factor the client portal already surfaces —
 * and points at the assistant, which verifies and releases the real code.
 * That is the pattern already in production for clients.
 *
 * Wes asked for "(eventually their unique) gate code". Per-driver codes
 * are the right answer and this route is where they'd surface once the
 * gate hardware can carry them; until then this is the honest version.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const da = await prisma.driverAssignment.findUnique({
    where: { token },
    select: {
      id: true, status: true, expiresAt: true, firstViewedAt: true,
      driver: {
        select: {
          id: true, firstName: true,
          licenseFrontUrl: true, licenseBackUrl: true,
          licenseExpiry: true, licenseExpired: true, licenseVerified: true,
        },
      },
      bookingAssignment: {
        select: {
          id: true, startDate: true, endDate: true,
          asset: {
            select: {
              unitName: true, make: true, model: true, licensePlate: true,
              category: { select: { name: true } },
            },
          },
          bookingItem: {
            select: {
              booking: {
                select: {
                  jobName: true,
                  company: { select: { name: true } },
                  job: { select: { id: true, assistantAuthCode: true } },
                },
              },
            },
          },
        },
      },
    },
  })

  if (!da) return NextResponse.json({ error: 'invalid link' }, { status: 404 })
  if (da.expiresAt && da.expiresAt < new Date()) {
    return NextResponse.json({ error: 'expired', expired: true }, { status: 410 })
  }

  // First open flips INVITED → VIEWED so staff can see the driver got it.
  if (!da.firstViewedAt) {
    await prisma.driverAssignment.update({
      where: { id: da.id },
      data: { firstViewedAt: new Date(), status: da.status === 'INVITED' ? 'VIEWED' : da.status },
    })
  }

  const asg = da.bookingAssignment
  const booking = asg.bookingItem.booking
  const jobId = booking.job?.id ?? null

  // Pickup / drop-off instructions come from the ORDER, where an agent
  // types them for a blind (unattended) handoff. Pull the job's orders and
  // take whichever carries instructions.
  const orders = jobId
    ? await prisma.order.findMany({
        where: { jobId, status: { not: 'CANCELLED' } },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true, orderNumber: true,
          blindPickup: true, blindReturn: true,
          blindPickupInstructions: true, blindReturnInstructions: true,
          lineItems: {
            where: { type: { not: 'FEE' } },
            orderBy: { sortOrder: 'asc' },
            select: { id: true, description: true, quantity: true },
          },
        },
      })
    : []

  const pickupInstructions =
    orders.find((o) => o.blindPickupInstructions?.trim())?.blindPickupInstructions ?? null
  const returnInstructions =
    orders.find((o) => o.blindReturnInstructions?.trim())?.blindReturnInstructions ?? null
  const isBlindPickup = orders.some((o) => o.blindPickup)
  const isBlindReturn = orders.some((o) => o.blindReturn)

  // What's loaded on the vehicle — the driver's pick list.
  const loadList = orders.flatMap((o) =>
    o.lineItems.map((li) => ({
      id: li.id,
      orderNumber: o.orderNumber,
      description: li.description,
      quantity: li.quantity,
    })),
  )

  const gate = evaluateLicenseGate(da.driver)

  return NextResponse.json({
    ok: true,
    driver: { firstName: da.driver.firstName },
    license: {
      hasFront: !!da.driver.licenseFrontUrl,
      hasBack: !!da.driver.licenseBackUrl,
      ok: gate.ok,
      code: gate.code,
      message: gate.message,
    },
    vehicle: {
      unitName: asg.asset.unitName,
      description: asg.asset.category?.name ?? null,
      makeModel: [asg.asset.make, asg.asset.model].filter(Boolean).join(' ') || null,
      licensePlate: asg.asset.licensePlate,
    },
    job: {
      productionName: booking.jobName,
      companyName: booking.company?.name ?? null,
      startDate: asg.startDate.toISOString().slice(0, 10),
      endDate: asg.endDate.toISOString().slice(0, 10),
    },
    instructions: {
      pickup: pickupInstructions,
      dropoff: returnInstructions,
      unattendedPickup: isBlindPickup,
      unattendedReturn: isBlindReturn,
    },
    // NOT the gate code — the factor the assistant checks before releasing
    // it. See the header comment.
    access: { assistantAuthCode: booking.job?.assistantAuthCode ?? null },
    loadList,
  })
}
