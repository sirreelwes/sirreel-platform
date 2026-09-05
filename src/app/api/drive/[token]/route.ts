import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { evaluateLicenseGate } from '@/lib/drivers/licenseGate'
import { listHours } from '@/lib/drivers/hoursStore'
import { hoursPromptOpen } from '@/lib/drivers/hoursEntry'
import { todayPacific } from '@/lib/sub-rentals/driverUnitView'

export const dynamic = 'force-dynamic'

/**
 * GET /api/drive/[token] — everything the driver's job page renders.
 * NO LOGIN: the token is the credential.
 *
 * ── On gate codes (Wes 2026-08-22) ───────────────────────────────────
 * A named driver DOES get the real lot gate code here. They were named by
 * the production or an agent, they hold a personal token, and they cannot
 * do the job without getting through the gate — routing them via the
 * assistant just adds a step to a task we already authorised.
 *
 * The job's assistantAuthCode is deliberately NOT sent to the driver. It
 * is the PRODUCTION's auth factor: handing it over would let a driver
 * present themselves to the assistant as the client. Job code stays with
 * production and the agent; gate code goes to the driver. Different
 * secrets, different holders.
 *
 * The lockbox code for the assigned vehicle is released only when the
 * pickup is unattended — the instructions in that case are literally
 * "keys are in the lockbox" and nobody is there to open it. Never for a
 * vehicle they aren't driving.
 *
 * Every release is stamped on DriverAssignment.gateCodeViewedAt: the lot
 * code is still a shared secret, so if it walks, there is a list of who
 * held it and from when.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const da = await prisma.driverAssignment.findUnique({
    where: { token },
    select: {
      id: true, status: true, expiresAt: true, firstViewedAt: true, gateCodeViewedAt: true,
      driver: {
        select: {
          id: true, firstName: true, lastName: true, phone: true, email: true,
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
              // Released only on an unattended pickup — see the header.
              accessCode: true,
              category: { select: { name: true } },
            },
          },
          bookingItem: {
            select: {
              booking: {
                select: {
                  jobName: true,
                  company: { select: { name: true } },
                  // assistantAuthCode deliberately NOT selected — it is the
                  // production's factor, not the driver's. See the header.
                  job: { select: { id: true } },
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
            // THIS RUN ONLY. A job's order carries a line per rental
            // WINDOW — a client asking for the same truck on Aug 27–28
            // and again on Sep 2–3 is two lines, correctly. Handing the
            // driver every line on the job therefore doubled the kit on
            // their screen: the Aug 27 driver was told to expect two
            // trucks and 30 straps for a run that is one truck and 15.
            //
            // Overlap, not equality: a line may legitimately span more
            // than the assignment's own window (a strap kit out for the
            // fortnight), and that kit IS on this truck.
            where: {
              type: { not: 'FEE' },
              pickupDate: { lte: asg.endDate },
              returnDate: { gte: asg.startDate },
            },
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

  // What's loaded on the vehicle — the driver's pick list, scoped to this
  // run's dates by the query above.
  //
  // KNOWN LIMIT: order lines carry dates but no assignment FK, so on a job
  // running two vehicles over the SAME window both drivers still see the
  // job's whole kit. Splitting that needs a line→assignment link, which is
  // a schema change; the dates are the half that can be fixed today, and
  // they were the half producing visibly doubled rows.
  const loadList = orders.flatMap((o) =>
    o.lineItems.map((li) => ({
      id: li.id,
      orderNumber: o.orderNumber,
      description: li.description,
      quantity: li.quantity,
    })),
  )

  // Real gate code for a named driver. Read late so the cheap failure
  // paths (bad token, expired) never touch the secret at all.
  const site = await prisma.siteSetting.findFirst({ select: { gateCode: true } })
  const gateCode = site?.gateCode ?? null
  if (gateCode && !da.gateCodeViewedAt) {
    await prisma.driverAssignment.update({
      where: { id: da.id },
      data: { gateCodeViewedAt: new Date() },
    })
  }

  const gate = evaluateLicenseGate(da.driver)
  const startDate = asg.startDate.toISOString().slice(0, 10)
  const endDate = asg.endDate.toISOString().slice(0, 10)

  return NextResponse.json({
    ok: true,
    // Hours the driver logs on this page (Wes 2026-09-05). Their own record;
    // the production sees the total on their portal.
    hours: await listHours({ driverAssignmentId: da.id }),
    hoursPromptOpen: hoursPromptOpen({ startDate, endDate }, todayPacific()),
    driver: {
      firstName: da.driver.firstName,
      lastName: da.driver.lastName,
      phone: da.driver.phone,
      // An invite only carries an email, so the name we hold may just be
      // the address's local part. The form nags until they confirm it.
      needsDetails: !da.driver.lastName || !da.driver.phone,
    },
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
    access: {
      gateCode,
      // Only for the vehicle they're driving, only when nobody will be
      // there to hand over keys.
      lockboxCode: isBlindPickup ? (asg.asset.accessCode ?? null) : null,
    },
    loadList,
  })
}
