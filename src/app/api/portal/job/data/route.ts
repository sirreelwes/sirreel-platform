import { categoryNameForLine, catalogClientCode } from '@/lib/catalog/display'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import {
  JOB_SESSION_COOKIE,
  buildJobSessionCookieHeader,
  verifyJobSessionCookieValue,
} from '@/lib/portal/jobSession'
import { resolveJobSession } from '@/lib/portal/jobMagicLink'
import { portalTokenUrl } from '@/lib/portal/portalUrl'
import { ensureBaselineRentalDocumentToSign } from '@/lib/orders/signedAgreement'
import { findJobCoverage, coverageSentence } from '@/lib/orders/agreementCoverage'
import { evaluateInsuredMatch } from '@/lib/coi/insuredMatch'
import { deriveOrderWindow } from '@/lib/jobs/dateRange'

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

// Client-safe labels when User.displayTitle is null. Internal role names
// ('ADMIN', 'AGENT') must never leak to the portal — these are the only
// strings a client ever sees as a role badge fallback.
function defaultDisplayTitleForRole(role: string): string {
  switch (role) {
    case 'ADMIN':
      return 'Leadership'
    case 'MANAGER':
      return 'Manager'
    case 'AGENT':
      return 'Team Member'
    default:
      return 'Team Member'
  }
}

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

  // The session cookie names an order; the URL the client is standing on
  // names another. Until 2026-09-01 this route read the cookie ALONE, so a
  // client who had opened one portal and then followed a link to a second
  // job — a forwarded email, a shared laptop on a production, a rep pasting
  // the address-bar URL after the token is stripped — was served the FIRST
  // job's order, schedule, equipment and invoices under the second job's
  // address. Refusing here (rather than silently swapping jobs) drops the
  // page onto its recovery screen, where "Email me a secure link" mints a
  // link for the job actually being asked for.
  const wantSlug = req.nextUrl.searchParams.get('slug')
  if (wantSlug && resolved.order.portalSlug !== wantSlug) {
    return NextResponse.json({ error: 'Session is for a different job' }, { status: 401 })
  }

  // Render the BASELINE approved-clause "document to sign" up front so the
  // client reviews the approved text (and can sign) the moment they land in
  // the portal — not only after an operator opens the dashboard agreement
  // view. Renders from the SAME contractClauses source as the signed PDF
  // (via generateCounterPdf → ContractDocument). Idempotent (no-op once
  // filled / for negotiated / for signed rows) and best-effort so a blob or
  // render hiccup never breaks the portal read. Runs before the order read
  // below so the freshly-populated documentToSignUrl is picked up in-band.
  await ensureBaselineRentalDocumentToSign(resolved.orderId).catch((err) => {
    console.error('[portal/job/data] baseline doc-to-sign generation failed:', err)
  })

  const [order, otherAccesses] = await Promise.all([
    prisma.order.findUnique({
      where: { id: resolved.orderId },
      select: {
        id: true,
        orderNumber: true,
        startDate: true,
        endDate: true,
        // The hold this order hangs off — dates when the order has no lines
        // yet (deriveOrderWindow's last fallback).
        booking: { select: { startDate: true, endDate: true, status: true } },
        status: true,
        cadenceState: true,
        portalSlug: true,
        portalSunsetAt: true,
        createdAt: true,
        sentAt: true,
        total: true,
        quotePdfUrl: true,
        quotePdfGeneratedAt: true,
        dotSheetGeneratedAt: true,
        bookingId: true,
        jobId: true,
        // Blind handoff — client-facing self-service instructions.
        // Selected explicitly per the CRH §7 audit checkpoint: only
        // surface fields the client should see. Toggle gates whether
        // the matching instructions text is rendered downstream.
        blindPickup: true,
        blindReturn: true,
        blindPickupInstructions: true,
        blindReturnInstructions: true,
        company: {
          select: {
            id: true,
            name: true,
            // Standing-agreement context for the portal banner. Only
            // the fields the client should see (no raw PDF URL when
            // the order's SignedAgreement already carries it via
            // documentToSignUrl).
            negotiatedTermsApprovedAt: true,
            negotiatedTermsSummary: true,
            negotiatedTermsActiveAsOf: true,
          },
        },
        job: { select: { id: true, name: true, jobCode: true, productionType: true, status: true } },
        agent: {
          select: { id: true, name: true, email: true, phone: true, avatarUrl: true, displayTitle: true },
        },
        repVisibleToClient: true,
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
            // The pair that is actually populated — line startDate/endDate is
            // null on 172 of 176 rows, pickup/return never is. Feeds the
            // order window below.
            pickupDate: true,
            returnDate: true,
            // Client-facing small print. Carries the partner-fee estimate
            // wording ("actual usage will be invoiced"), which the client must
            // see here as well as on the quote PDF — the portal is where they
            // actually read the order.
            notes: true,
            usageEstimated: true,
            parentLineItemId: true,
            autoKitPieceId: true,
            inventoryItem: { select: { code: true, rwICode: true, description: true, trackingMode: true } },
          },
          orderBy: { sortOrder: 'asc' },
        },
        // Pull both contract types in one round trip. Rental and stage are
        // surfaced as separate cards on the portal paperwork section; the
        // .find() helpers below partition this array by contractType.
        signedAgreements: {
          select: {
            contractType: true,
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
    select: { id: true, name: true, email: true, phone: true, displayTitle: true, role: true },
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
            namedInsured: true,
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
  // Partition signedAgreements by contractType — one entry can fire per type.
  const rentalAgreement = order.signedAgreements.find((a) => a.contractType === 'RENTAL_AGREEMENT') ?? null
  const stageContract = order.signedAgreements.find((a) => a.contractType === 'STAGE_CONTRACT') ?? null
  if (rentalAgreement?.signedAt && rentalAgreement.signerName) {
    activity.push({
      at: rentalAgreement.signedAt.toISOString(),
      kind: 'agreement_signed',
      label: `Rental agreement signed by ${rentalAgreement.signerName}`,
    })
  }
  if (stageContract?.signedAt && stageContract.signerName) {
    activity.push({
      at: stageContract.signedAt.toISOString(),
      kind: 'stage_contract_signed',
      label: `Stage contract signed by ${stageContract.signerName}`,
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

  // The window this order covers. The header dates are optional and often
  // blank, and the client should never read "—" for gear we are holding on
  // specific days (Wes 2026-09-01) — the Schedule block and the pickup
  // countdown both run off this.
  const orderWindow = deriveOrderWindow({
    startDate: order.startDate,
    endDate: order.endDate,
    lineItems: order.lineItems,
    booking: order.booking,
  })

  const portalCountdownMs = orderWindow.start
    ? Math.max(0, orderWindow.start.getTime() - Date.now())
    : null

  // Standing-agreement banner context. Only fires when the company
  // has an approved + active standing agreement AND the order's
  // signed-agreement row is on the NEGOTIATED side (i.e. auto-applied
  // by ensureSignedAgreementForOrder). Orders that were papered on
  // baseline before the company recorded standing terms keep their
  // baseline + don't surface the banner.
  // Papered by a sibling order on the same job? Then this order asks for
  // nothing — see lib/orders/agreementCoverage. Only consulted when this
  // order has no signature of its own; its own signature always wins.
  const ownSigned =
    rentalAgreement?.status === 'SIGNED_BASELINE' ||
    rentalAgreement?.status === 'SIGNED_NEGOTIATED' ||
    rentalAgreement?.status === 'SIGNED_OFFLINE'
  const jobCoverage = ownSigned ? null : await findJobCoverage(order.id)
  const agreementCoverage = jobCoverage
    ? {
        orderNumber: jobCoverage.orderNumber,
        jobCode: jobCoverage.jobCode,
        signedAt: jobCoverage.signedAt?.toISOString() ?? null,
        signerName: jobCoverage.signerName,
        sentence: coverageSentence(jobCoverage),
      }
    : null

  const now = new Date()
  const standingAgreementActive =
    !!order.company.negotiatedTermsApprovedAt &&
    (order.company.negotiatedTermsActiveAsOf == null ||
      order.company.negotiatedTermsActiveAsOf <= now)
  const standingAgreement =
    standingAgreementActive && rentalAgreement?.documentType === 'NEGOTIATED'
      ? {
          companyName: order.company.name,
          approvedAt: order.company.negotiatedTermsApprovedAt!.toISOString(),
          summary: order.company.negotiatedTermsSummary,
        }
      : null

  return NextResponse.json({
    contact: resolved.contact,
    portalAccessId: resolved.portalAccessId,
    company: { id: order.company.id, name: order.company.name },
    standingAgreement,
    order: {
      id: order.id,
      orderNumber: order.orderNumber,
      startDate: orderWindow.start,
      endDate: orderWindow.end,
      status: order.status,
      cadenceState: order.cadenceState,
      total: order.total.toString(),
      // Blind handoff — only emit the instructions text when the
      // matching toggle is true. Defense-in-depth so a sales-side
      // toggle-off doesn't accidentally leak the prior text to the
      // client even though the column may still hold it server-side.
      blindPickup: order.blindPickup,
      blindReturn: order.blindReturn,
      blindPickupInstructions: order.blindPickup ? order.blindPickupInstructions : null,
      blindReturnInstructions: order.blindReturn ? order.blindReturnInstructions : null,
    },
    job: order.job,
    countdown: portalCountdownMs != null ? { msUntilPickup: portalCountdownMs } : null,
    // Opt-in. Every order HAS an agent — self-serve jobs get one assigned
    // automatically — but an automatic assignment is not a relationship, and
    // presenting one as "Your SirReel rep" showed clients the wrong name,
    // phone and email. Withheld unless someone actually took the account.
    agent: order.repVisibleToClient ? order.agent : null,
    afterHoursLine: AFTER_HOURS_LINE,
    leadership: leadership
      ? {
          id: leadership.id,
          name: leadership.name,
          email: leadership.email,
          phone: leadership.phone,
          // displayTitle is the canonical client-facing label. The role
          // fallback is defense-in-depth — every @sirreel.com User has a
          // displayTitle as of May 2026, but a new admin-created row with
          // no displayTitle shouldn't blank out the badge in the portal.
          // Internal role names ('ADMIN', 'AGENT') are never exposed —
          // we map to client-safe labels here.
          displayTitle: leadership.displayTitle || defaultDisplayTitleForRole(leadership.role),
        }
      : null,
    // CLIENT-FACING — sub-rental fields (vendor, vendor*, PO #, status,
    // receiveMethod) must NEVER be added to this serializer. The client
    // sees only their own line as they signed it. The internal sub-rental
    // surfaces read OrderLineItem.subRentals directly and never come
    // through this DTO.
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
      inventoryCode: catalogClientCode(li),
      categoryName: categoryNameForLine(li),
      notes: li.notes,
      usageEstimated: li.usageEstimated,
      isSubItem: !!li.parentLineItemId,
      // An included accessory. The client is accountable for bringing it
      // back even though it was never charged for, so the portal names it
      // rather than showing a $0.00 rate next to a real piece of gear.
      isIncluded: !!li.autoKitPieceId,
    })),
    paperwork: {
      // The GATED route, never the raw blob URL. quotePdfUrl is a private
      // blob that 403s in the client's browser — same contract as the DOT
      // sheet below. The value stays truthy/null so the "Available" vs
      // "Pending" status on the paperwork row is unchanged.
      quotePdfUrl: order.quotePdfUrl ? '/api/portal/job/quote-pdf' : null,
      quotePdfGeneratedAt: order.quotePdfGeneratedAt,
      // DOT info packet — served through the gated portal proxy (never the
      // raw private-blob URL). Present only once generated.
      dotSheetUrl: order.dotSheetGeneratedAt ? '/api/portal/job/dot-sheet' : null,
      dotSheetGeneratedAt: order.dotSheetGeneratedAt,
      agreement: rentalAgreement,
      stageContract,
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
            // The client is told about a name mismatch on their OWN
            // certificate — Wes, 2026-08-25: "flag it for both SirReel and
            // User side". Only the client-safe sentence crosses the wire;
            // the staff wording (which reasons about our records) does not.
            // Empty string means "nothing to say", so the portal never has
            // to know the verdict vocabulary.
            insuredNotice:
              evaluateInsuredMatch(latestCoi.namedInsured, [order.company?.name, order.job?.name])
                .clientMessage || null,
          }
        : null,
      legacyPaperworkPortalUrl: paperworkPortal
        ? portalTokenUrl(paperworkPortal.token)
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
    agreement: rentalAgreement,
    agreementCoverage,
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
