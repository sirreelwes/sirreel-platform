import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import {
  JOB_SESSION_COOKIE,
  buildJobSessionCookieHeader,
  verifyJobSessionCookieValue,
} from '@/lib/portal/jobSession'
import { resolveJobSession } from '@/lib/portal/jobMagicLink'

export const dynamic = 'force-dynamic'

// INTENTIONALLY HARDCODED — this is a real shared after-hours line, not a
// per-person number. Unlike rep/ops contact info (which now comes from
// the User table), this string is the canonical operations contact and
// doesn't belong on any single User row.
const AFTER_HOURS_LINE = '(888) 477-7335'

// The senior-leadership card on the portal "Your SirReel Team" section
// looks up this email in the User table at request time. The email itself
// is a stable handle; everything client-visible (name, displayTitle, phone)
// comes from the User row. Swap this string if leadership-visibility ever
// rotates to another person.
const LEADERSHIP_EMAIL = 'dani@sirreel.com'

/**
 * GET /api/portal/job/data
 *
 * Cookie-authenticated read of the entire Job Page payload — order header,
 * schedule, equipment, agreement/COI status, contacts (client team + SirReel
 * team), activity feed. Phase 3.2 covers the read-only sections; per-state
 * quick actions and paperwork uploads (Phase 3.3) consume this same data.
 *
 * NEVER exposes internal-only fields:
 *   - Vehicle.insuranceCardUrl / insurancePolicyNumber (when those exist)
 *   - Internal line-item cost data (we surface daily rate, never internal cost)
 *   - Driver assignments, maintenance records
 * The Prisma select clauses below are the audit checkpoint — any new field
 * surfaced here must be reviewed against brief §7 "What is NEVER surfaced".
 */
export async function GET(req: NextRequest) {
  const session = verifyJobSessionCookieValue(req.cookies.get(JOB_SESSION_COOKIE)?.value)
  if (!session) {
    return NextResponse.json({ error: 'No session' }, { status: 401 })
  }
  const resolved = await resolveJobSession({ portalAccessId: session.portalAccessId })
  if (!resolved) {
    const res = NextResponse.json({ error: 'Session no longer valid' }, { status: 401 })
    res.headers.append('Set-Cookie', buildJobSessionCookieHeader('', { clear: true }))
    return res
  }

  const [order, otherAccesses] = await Promise.all([
    prisma.order.findUnique({
      where: { id: resolved.orderId },
      select: {
        id: true,
        orderNumber: true,
        startDate: true,
        endDate: true,
        status: true,
        cadenceState: true,
        portalSlug: true,
        portalSunsetAt: true,
        createdAt: true,
        sentAt: true,
        total: true,
        quotePdfUrl: true,
        quotePdfGeneratedAt: true,
        bookingId: true,
        jobId: true,
        company: { select: { id: true, name: true } },
        job: { select: { id: true, name: true, jobCode: true, productionType: true } },
        agent: {
          select: { id: true, name: true, email: true, phone: true, avatarUrl: true, displayTitle: true },
        },
        lineItems: {
          select: {
            id: true,
            sortOrder: true,
            type: true,
            description: true,
            rateType: true,
            rate: true,
            quantity: true,
            billableDays: true,
            startDate: true,
            endDate: true,
            inventoryItem: { select: { code: true, description: true } },
            assetCategory: { select: { name: true } },
          },
          orderBy: { sortOrder: 'asc' },
        },
        signedAgreement: {
          select: {
            status: true,
            documentType: true,
            signedAt: true,
            signerName: true,
            documentToSignUrl: true,
            signedDocumentUrl: true,
          },
        },
      },
    }),
    prisma.portalAccess.findMany({
      where: { orderId: resolved.orderId, revokedAt: null },
      orderBy: { createdAt: 'asc' },
      include: {
        contact: { select: { id: true, firstName: true, lastName: true, email: true } },
      },
    }),
  ])

  if (!order) {
    return NextResponse.json({ error: 'Order not found' }, { status: 404 })
  }

  // Paperwork status — pulled in parallel where it doesn't depend on `order`.
  // The legacy paperwork-portal magic link (per booking) is included so the
  // page can deep-link the client to the existing rental-agreement signing
  // flow from the May 2026 paperwork portal work.
  //
  // Per-vehicle DOT paperwork comes off the order's booking via
  // BookingAssignment → Asset. We deliberately ONLY select the four DOT
  // fields + display fields here; insuranceCardUrl, insurancePolicyNum,
  // and any other Asset internals are not in this select clause. This is
  // the audit checkpoint for CRH brief §7 "What is NEVER surfaced".
  const leadership = await prisma.user.findUnique({
    where: { email: LEADERSHIP_EMAIL },
    select: { id: true, name: true, email: true, phone: true, displayTitle: true },
  })

  const [latestCoi, paperworkPortal, vehicleAssignments] = await Promise.all([
    order.jobId
      ? prisma.coiCheck.findFirst({
          where: { jobId: order.jobId, deletedAt: null },
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            fileUrl: true,
            originalFilename: true,
            humanDecision: true,
            aiRiskLevel: true,
            policyExpiryDate: true,
            coverageVerified: true,
            additionalInsured: true,
            createdAt: true,
          },
        })
      : Promise.resolve(null),
    order.bookingId
      ? prisma.paperworkRequest.findFirst({
          where: { bookingId: order.bookingId },
          orderBy: { sentAt: 'desc' },
          select: { token: true },
        })
      : Promise.resolve(null),
    order.bookingId
      ? prisma.bookingAssignment.findMany({
          where: {
            status: { in: ['ASSIGNED', 'CHECKED_OUT', 'RETURNED'] },
            bookingItem: { bookingId: order.bookingId },
            asset: { category: { slug: { contains: 'vehicle' } } },
          },
          select: {
            id: true,
            startDate: true,
            endDate: true,
            asset: {
              // AUDIT CHECKPOINT — fields below are the entire client-visible
              // surface for an Asset. Do NOT add insuranceCardUrl,
              // insurancePolicyNum, mileage, currentValue, or anything from
              // the internal-only set called out in CRH brief §7.
              select: {
                id: true,
                unitName: true,
                year: true,
                make: true,
                model: true,
                licensePlate: true,
                registrationUrl: true,
                registrationExpiresAt: true,
                bitCertificateUrl: true,
                bitCertificateExpiresAt: true,
              },
            },
          },
        })
      : Promise.resolve([]),
  ])

  // Activity feed — synthesised from order milestones + portal access events.
  // No dedicated history table yet; this is good enough for the brief's
  // collapsed-by-default surface and trivially upgradable once we add one.
  type ActivityEvent = { at: string; kind: string; label: string }
  const activity: ActivityEvent[] = []
  if (order.createdAt) {
    activity.push({ at: order.createdAt.toISOString(), kind: 'order_created', label: 'Order created' })
  }
  if (order.sentAt) {
    activity.push({ at: order.sentAt.toISOString(), kind: 'quote_sent', label: `Quote sent by ${order.agent?.name || 'SirReel'}` })
  }
  if (order.signedAgreement?.signedAt && order.signedAgreement.signerName) {
    activity.push({
      at: order.signedAgreement.signedAt.toISOString(),
      kind: 'agreement_signed',
      label: `Rental agreement signed by ${order.signedAgreement.signerName}`,
    })
  }
  for (const a of otherAccesses) {
    if (a.lastAccessedAt && a.contactId !== resolved.contactId) {
      const name = a.contact ? `${a.contact.firstName} ${a.contact.lastName}` : 'A teammate'
      activity.push({
        at: a.lastAccessedAt.toISOString(),
        kind: 'portal_viewed',
        label: `${name} opened the portal`,
      })
    }
  }
  activity.sort((a, b) => b.at.localeCompare(a.at))

  const portalCountdownMs = order.startDate
    ? Math.max(0, order.startDate.getTime() - Date.now())
    : null

  return NextResponse.json({
    contact: resolved.contact,
    portalAccessId: resolved.portalAccessId,
    company: order.company,
    order: {
      id: order.id,
      orderNumber: order.orderNumber,
      startDate: order.startDate,
      endDate: order.endDate,
      status: order.status,
      cadenceState: order.cadenceState,
      total: order.total.toString(),
    },
    job: order.job,
    countdown: portalCountdownMs != null ? { msUntilPickup: portalCountdownMs } : null,
    agent: order.agent,
    afterHoursLine: AFTER_HOURS_LINE,
    leadership: leadership
      ? {
          id: leadership.id,
          name: leadership.name,
          email: leadership.email,
          phone: leadership.phone,
          displayTitle: leadership.displayTitle,
        }
      : null,
    lineItems: order.lineItems.map((li) => ({
      id: li.id,
      type: li.type,
      description: li.description,
      rateType: li.rateType,
      rate: li.rate.toString(),
      quantity: li.quantity,
      days: li.billableDays,
      startDate: li.startDate,
      endDate: li.endDate,
      inventoryCode: li.inventoryItem?.code || null,
      categoryName: li.assetCategory?.name || null,
    })),
    paperwork: {
      quotePdfUrl: order.quotePdfUrl,
      quotePdfGeneratedAt: order.quotePdfGeneratedAt,
      agreement: order.signedAgreement,
      coi: latestCoi
        ? {
            id: latestCoi.id,
            fileUrl: latestCoi.fileUrl,
            originalFilename: latestCoi.originalFilename,
            humanDecision: latestCoi.humanDecision,
            aiRiskLevel: latestCoi.aiRiskLevel,
            policyExpiryDate: latestCoi.policyExpiryDate,
            coverageVerified: latestCoi.coverageVerified,
            additionalInsured: latestCoi.additionalInsured,
            uploadedAt: latestCoi.createdAt,
          }
        : null,
      legacyPaperworkPortalUrl: paperworkPortal
        ? `https://hq.sirreel.com/portal/${paperworkPortal.token}`
        : null,
      // Vehicles assigned to this order via the booking. Each entry carries
      // make/model/plate + registration + BIT links/expiries. Internal-only
      // fields are not in the source select.
      vehicles: vehicleAssignments.map((va) => {
        const titleParts = [va.asset.year ? String(va.asset.year) : '', va.asset.make || '', va.asset.model || '']
          .filter(Boolean)
          .join(' ')
          .trim()
        return {
          assetId: va.asset.id,
          unitName: va.asset.unitName,
          title: titleParts || va.asset.unitName,
          licensePlate: va.asset.licensePlate,
          assignmentStartDate: va.startDate,
          assignmentEndDate: va.endDate,
          registrationUrl: va.asset.registrationUrl,
          registrationExpiresAt: va.asset.registrationExpiresAt,
          bitCertificateUrl: va.asset.bitCertificateUrl,
          bitCertificateExpiresAt: va.asset.bitCertificateExpiresAt,
        }
      }),
    },
    agreement: order.signedAgreement,
    team: otherAccesses
      .filter((a) => a.contactId !== resolved.contactId && a.contact)
      .map((a) => ({
        id: a.contact!.id,
        firstName: a.contact!.firstName,
        lastName: a.contact!.lastName,
        email: a.contact!.email,
        lastAccessedAt: a.lastAccessedAt,
      })),
    activity,
  })
}
