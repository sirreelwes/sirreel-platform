import { categoryNameForLine, catalogClientCode } from '@/lib/catalog/display'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import type { Prisma } from '@prisma/client'
import {
  JOB_SESSION_COOKIE,
  buildJobSessionCookieHeader,
  verifyJobSessionCookieValue,
} from '@/lib/portal/jobSession'
import { resolveJobSession } from '@/lib/portal/jobMagicLink'
import { resolveJobPortalRead } from '@/lib/portal/jobPreview'
import { OFFICE_LINE, supportLines } from '@/lib/support/lines'
import { portalTokenUrl, portalV2Url } from '@/lib/portal/portalUrl'
import { resolveWalletCardForJob } from '@/lib/payments/jobCardOnFile'
import { ensureBaselineRentalDocumentToSign } from '@/lib/orders/signedAgreement'
import { findJobCoverage, coverageSentence } from '@/lib/orders/agreementCoverage'
import {
  applyAnnualCoverage,
  findCompanyAnnualCoverage,
  annualCoverageSentence,
  annualCoverageTitle,
} from '@/lib/orders/annualCoverage'
import { findOpenAnnualRequest } from '@/lib/portal/annualRequest'
import { findPendingAnnual } from '@/lib/portal/companyAnnual'
import { summarizeJobLcdwCoverage, effectiveLcdwDecision } from '@/lib/lcdw/jobElection'
import { resolveJobCoi, coiSourceSentence } from '@/lib/coi/companyCoi'
import {
  getJobCoiConfirmation,
  carriedCoiApplies,
  confirmationQuestion,
  separatePolicySentence,
  NO_CONFIRMATION,
} from '@/lib/coi/jobCoiConfirmation'
import { LCDW_DAILY_RATE } from '@/lib/contracts/fees'
import { evaluateInsuredMatch } from '@/lib/coi/insuredMatch'
import { coiClientDecision } from '@/lib/coi/coiState'
import { loadOrderReplacementValue, toClientReplacementValue } from '@/lib/coi/replacementValue'
import { deriveOrderWindow } from '@/lib/jobs/dateRange'
import { buildBookingTerms, type BookingVehicleLine } from '@/lib/sales/bookingTerms'
import { PUBLIC_VEHICLE_VISIBLE_WHERE } from '@/lib/site/vehicleCatalog'

export const dynamic = 'force-dynamic'

// The office line and AHA's text line — see src/lib/support/lines.ts. Shared
// numbers, not per-person ones, so they come from there rather than any User
// row. Which is which matters: the 888 is business hours, AHA is 24/7.
const AFTER_HOURS_LINE = OFFICE_LINE

// Who a client sees when no rep has been established for their order — which
// is most of them (5 of 107 live orders had a visible rep on 2026-09-12).
//
// This was the COO until Wes saw it on a real portal: "Dani shouldn't default
// as the rep. If anyone defaults as rep it should be Jose." A client with a
// question should land on sales, not on the COO, and a COO card on a hundred
// portals reads as the account's relationship when it is only a placeholder.
//
// The email is a stable handle; everything client-visible (name, title, phone)
// comes from the User row at request time. Swap this string if the default
// ever rotates to someone else.
const FALLBACK_REP_EMAIL = 'jose@sirreel.com'

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
  // A real client session, or a staff preview of one (jobPreview.ts). Reads
  // only: a preview cookie cannot satisfy any write route on this portal.
  const read = await resolveJobPortalRead(req)
  if (!read) {
    const res = NextResponse.json({ error: 'No session' }, { status: 401 })
    res.headers.append('Set-Cookie', buildJobSessionCookieHeader('', { clear: true }))
    return res
  }
  const resolved = read.resolved

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
  // Not while previewing: looking at a client's page must not be the thing
  // that generates their document.
  if (!read.previewBy) {
    await ensureBaselineRentalDocumentToSign(resolved.orderId).catch((err) => {
      console.error('[portal/job/data] baseline doc-to-sign generation failed:', err)
    })
  }

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
        quoteSentAt: true,
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
        // How the non-vehicle lines leave the building. The client picks it
        // themselves now (Wes 2026-09-12: "orders have a drop down — Load on
        // Asset 1, Load on Asset 2, Will Call, Delivery").
        gearHandoff: true,
        gearLoadsOnAssignmentId: true,
        deliveryRequested: true,
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
            // Masthead: only whether a mark exists — the image itself is
            // served by /api/portal/job/company-logo under this session.
            logoUrl: true,
            logoSvg: true,
            // Standing-agreement context for the portal banner. Only
            // the fields the client should see (no raw PDF URL when
            // the order's SignedAgreement already carries it via
            // documentToSignUrl).
            negotiatedTermsApprovedAt: true,
            negotiatedTermsSummary: true,
            negotiatedTermsActiveAsOf: true,
          },
        },
        job: {
          select: {
            id: true, name: true, jobCode: true, productionType: true, status: true,
            // Release flag only — the codes themselves are never on this
            // payload. The after-hours page fetches them from its own
            // route, which re-checks the release and logs the read.
            afterHoursReleasedAt: true,
          },
        },
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
            // The next two feed the BOOKING-DETAILS block only, and are not
            // serialized to the client. `department` picks out the vehicle
            // lines; `subRentals` answers "is this a partner's unit" (never
            // LCDW-eligible) with `select: { id: true }` so no vendor name,
            // cost or PO can reach a client-facing render through it.
            department: true,
            subRentals: { select: { id: true } },
            inventoryItem: { select: { code: true, rwICode: true, description: true, trackingMode: true, isSpecialtyVehicle: true } },
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
  const fallbackRep = await prisma.user.findUnique({
    where: { email: FALLBACK_REP_EMAIL },
    select: { id: true, name: true, email: true, phone: true, displayTitle: true, role: true },
  })

  const paperworkRequestScopes: Prisma.PaperworkRequestWhereInput[] = []
  if (order.bookingId) paperworkRequestScopes.push({ bookingId: order.bookingId })
  if (order.jobId) {
    paperworkRequestScopes.push({
      booking: { jobId: order.jobId, status: { notIn: ['CANCELLED', 'ARCHIVED'] }, archivedAt: null },
    })
  }

  const [latestCoi, paperworkPortal, vehicleAssignments] = await Promise.all([
    // The certificate that governs this job: its own upload, else the
    // account's certificate on file carried forward (Wes, 2026-09-02 — annual
    // COIs). Resolving by jobId alone made an annual account look uninsured
    // on every job after the one they uploaded against.
    order.jobId ? resolveJobCoi(order.jobId) : Promise.resolve(null),
    // The card-authorization link HQ sent for this job. Booking-scoped, so
    // the order's own booking first; but a rebook orphans Order.bookingId
    // (paperwork-link-follows-rebook), so any live booking on the job is
    // a fallback rather than "never asked". A row that already holds a
    // card wins outright — that is the authorization, whichever booking it
    // hangs off.
    paperworkRequestScopes.length > 0
      ? prisma.paperworkRequest
          .findMany({
            where: { OR: paperworkRequestScopes },
            orderBy: { sentAt: 'desc' },
            select: {
              token: true, bookingId: true, sentAt: true, sentTo: true,
              ccCardNumberEncrypted: true, ccCardLast4: true, ccCardType: true,
              ccCardholderFirst: true, ccCardholderLast: true, ccAuthSignedAt: true,
              // The client opened this form themselves — the row must not
              // tell them "we sent you a link" about their own click.
              clientInitiatedAt: true,
            },
          })
          .then((rows) =>
            rows.find((r) => !!r.ccCardNumberEncrypted) ??
            rows.find((r) => r.bookingId === order.bookingId) ??
            rows[0] ??
            null,
          )
      : Promise.resolve(null),
    order.bookingId
      ? prisma.bookingAssignment.findMany({
          where: {
            status: { in: ['ASSIGNED', 'CHECKED_OUT', 'RETURNED'] },
            bookingItem: { bookingId: order.bookingId },
            // Department, never the slug. This read `slug: { contains:
            // 'vehicle' }`, and NOT ONE live VEHICLES slug contains that
            // string — they are popvan, cube-truck, cargo-van-liftgate,
            // proscout-vtr, passenger-van, dlux… So the client's DOT
            // section matched nothing on every job it has ever rendered:
            // present, empty, silent. Same failure shape as the portal's
            // 'COMPLETE'/'CLOSED' lock strings (src/lib/bookings/status.ts)
            // and the reason ensureStagePaperworkRequest detects stages by
            // department too ("the live category is named Studios").
            // src/lib/fleet/dotSheet.ts had it right all along.
            asset: { category: { department: 'VEHICLES' } },
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
                // The class, for the client-facing name ("SuperCube") and to
                // find the catalog photo of it. Both are things we publish.
                category: { select: { id: true, name: true } },
              },
            },
          },
        })
      : Promise.resolve([]),
  ])

  // A catalog photo per reserved vehicle class, for the client's "Assets
  // reserved" tiles (Wes 2026-09-12: "possibly with little icon pictures of
  // the vehicles"). Same PUBLIC proxy the account portal uses — the blob URL
  // itself never reaches a browser (companyOverview.ts). No photo on the
  // class simply means no tile image; the tile still renders.
  const reservedCategoryIds = [
    ...new Set(vehicleAssignments.map((va) => va.asset.category?.id).filter((id): id is string => !!id)),
  ]
  // PUBLIC_VEHICLE_VISIBLE_WHERE is the same gate the proxy enforces, and it
  // already means "has an image" — gallery photo, the row's own photoUrl, or
  // the linked Fleet Pricing category's. Measured 2026-09-12: all nine live
  // classes get theirs from the LAST of those, so testing only the first two
  // (as the first cut did) left every tile a grey placeholder.
  const vehiclePhotoByCategory = new Map<string, string>()
  if (reservedCategoryIds.length > 0) {
    const cats = await prisma.vehicleCategory.findMany({
      where: { assetCategoryId: { in: reservedCategoryIds }, ...PUBLIC_VEHICLE_VISIBLE_WHERE },
      select: { id: true, assetCategoryId: true },
    })
    for (const vc of cats) {
      if (!vc.assetCategoryId || vehiclePhotoByCategory.has(vc.assetCategoryId)) continue
      vehiclePhotoByCategory.set(vc.assetCategoryId, `/api/public/catalog-image/vehicle/${vc.id}`)
    }
  }

  // "Active COI on file — but is it the right one for THIS job?" (Wes,
  // 2026-09-09). Only a CARRIED certificate raises the question; the
  // client's answer is bound to the document they were shown.
  // Card authorization — the row Nancy (Happy Place, SR-JOB-0351,
  // 2026-09-11) could not find: the job portal listed every other piece
  // of paperwork and the card link only ever surfaced through the Rental
  // Agreement row, which stops linking out the moment the agreement is
  // signed. Both stores, always (jobCardOnFile.ts): the portal capture on
  // the paperwork row, else the company wallet. 'REQUESTED' means HQ sent
  // the link and nothing came back — the same condition that stops the
  // yard checking the job out (cardGate.ts), so the client sees it here
  // before the dock does.
  const walletCard =
    paperworkPortal?.ccCardNumberEncrypted || !order.jobId
      ? null
      : await resolveWalletCardForJob(order.company?.id, order.jobId)
  // The v2 paperwork page — the one the card-authorization email itself
  // opens — landed on the card step.
  const cardCaptureUrl = paperworkPortal ? `${portalV2Url(paperworkPortal.token)}?open=cc` : null
  const cardAuth: {
    /** CLIENT_STARTED — the client opened the card form themselves from the
     *  portal (Oliver, 2026-09-12). Same secure form, but nobody sent it and
     *  it does not make the job card-required (lib/payments/cardGate.ts). */
    state: 'ON_FILE' | 'REQUESTED' | 'CLIENT_STARTED' | 'NOT_REQUESTED'
    origin: 'job' | 'account' | null
    last4: string | null
    cardType: string | null
    cardholderName: string | null
    authorizedAt: string | null
    requestedAt: string | null
    requestedTo: string | null
    captureUrl: string | null
  } = paperworkPortal?.ccCardNumberEncrypted
    ? {
        state: 'ON_FILE',
        origin: 'job',
        last4: paperworkPortal.ccCardLast4,
        cardType: paperworkPortal.ccCardType,
        cardholderName:
          [paperworkPortal.ccCardholderFirst, paperworkPortal.ccCardholderLast].filter(Boolean).join(' ') || null,
        authorizedAt: paperworkPortal.ccAuthSignedAt?.toISOString() ?? null,
        requestedAt: paperworkPortal.sentAt.toISOString(),
        requestedTo: paperworkPortal.sentTo,
        captureUrl: cardCaptureUrl,
      }
    : walletCard
      ? {
          state: 'ON_FILE',
          origin: 'account',
          last4: walletCard.last4,
          cardType: walletCard.cardType,
          cardholderName: walletCard.cardholderName,
          authorizedAt: null,
          requestedAt: paperworkPortal?.sentAt.toISOString() ?? null,
          requestedTo: paperworkPortal?.sentTo ?? null,
          captureUrl: cardCaptureUrl,
        }
      : {
          state: paperworkPortal
            ? paperworkPortal.clientInitiatedAt
              ? 'CLIENT_STARTED'
              : 'REQUESTED'
            : 'NOT_REQUESTED',
          origin: null,
          last4: null,
          cardType: null,
          cardholderName: null,
          authorizedAt: null,
          requestedAt: paperworkPortal?.sentAt.toISOString() ?? null,
          requestedTo: paperworkPortal?.sentTo ?? null,
          captureUrl: cardCaptureUrl,
        }

  const coiConfirmation = order.jobId
    ? await getJobCoiConfirmation(order.jobId, latestCoi)
    : NO_CONFIRMATION
  // A production that told us it carries its own insurance is NOT covered by
  // the account cert. Stop it standing in — the row goes back to asking for
  // their certificate, with the reason said out loud.
  const governingCoi = carriedCoiApplies(coiConfirmation) ? latestCoi : null

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
  // Annual master FIRST. An annual account has signed for the year, so the
  // ask is gone from the moment the order exists — before any sibling could
  // have been signed. applyAnnualCoverage also re-stamps (or clears) the
  // pointer on every portal read, so an expired master hands the ask back on
  // the client's next visit rather than at some later batch.
  // applyAnnualCoverage stamps the pointer, but it needs a SignedAgreement
  // row to stamp — and a client can reach the portal before the quote is sent
  // and that row exists. Fall back to the company lookup so the "you're
  // covered, nothing to sign" banner is honest from the FIRST visit rather
  // than appearing later and looking like the rules changed.
  const annualCoverage = ownSigned
    ? null
    : (await applyAnnualCoverage(order.id)) ??
      (order.company?.id ? await findCompanyAnnualCoverage(order.company.id) : null)
  const jobCoverage = ownSigned || annualCoverage ? null : await findJobCoverage(order.id)

  // "Sign once for the year?" — the option, offered on the paperwork row
  // where the thought actually occurs. Three states and no more: OFFER
  // (say the option exists), REQUESTED (their rep has the ask), and
  // PENDING_SIGNATURE (a master is already with their executives). An
  // account already covered gets none of them — it is not an option, it is
  // what they have. Nothing here changes what THIS job must sign.
  const annualOption = await resolveAnnualOption(
    annualCoverage ? null : (order.company?.id ?? null),
  )
  const agreementCoverage = jobCoverage
    ? {
        orderNumber: jobCoverage.orderNumber,
        jobCode: jobCoverage.jobCode,
        signedAt: jobCoverage.signedAt?.toISOString() ?? null,
        signerName: jobCoverage.signerName,
        sentence: coverageSentence(jobCoverage),
      }
    : null

  // ── The one thing an annual account is still asked ────────────────
  //
  // Wes, 2026-09-01: annual companies are "automatically approved on the
  // rental agreement and only asked to elect or deny LCDW". So the LCDW row
  // is surfaced whenever the job has eligible vehicles — the election is a
  // per-job fact for every client, but for an annual account it is the WHOLE
  // paperwork ask, which is why it can no longer live only on the old
  // booking-token portal.
  const [lcdwSummary, lcdwElection] = order.jobId
    ? await Promise.all([
        summarizeJobLcdwCoverage(order.jobId),
        prisma.lcdwElection.findUnique({
          where: { jobId: order.jobId },
          select: {
            decision: true, decidedAt: true, signerName: true,
            acknowledgedAgreementId: true, acknowledgedAt: true,
          },
        }),
      ])
    : [null, null]

  const lcdw = lcdwSummary
    ? {
        // Never offered when nothing on the job can carry it. A client who
        // accepts a waiver covering none of their vehicles has bought
        // nothing — see lcdwEligibility.ts.
        available: lcdwSummary.coveredVehicles.length > 0,
        hasVehicles: lcdwSummary.hasVehicles,
        allExcluded: lcdwSummary.allExcluded,
        ratePerDay: LCDW_DAILY_RATE,
        covered: lcdwSummary.coveredVehicles,
        excluded: lcdwSummary.excludedVehicles,
        election: lcdwElection
          ? {
              decision: lcdwElection.decision,
              decidedAt: lcdwElection.decidedAt.toISOString(),
              signerName: lcdwElection.signerName,
            }
          : null,
        // The governing answer. For an annual account this is usually the
        // standing election signed on the master, so the row reads as
        // ANSWERED with an option to change — not as an outstanding ask the
        // client already dealt with when they signed for the year.
        effective: effectiveLcdwDecision(
          lcdwElection,
          annualCoverage?.standingLcdwDecision ?? null,
        ),
        // Wes, 2026-09-02: a covered client must affirm, per job, that the
        // master is on file and what their waiver status is. Until they do,
        // this row is an OPEN item — coverage is real, but nobody has heard
        // the client say they know about it.
        acknowledgementRequired:
          !!annualCoverage &&
          lcdwElection?.acknowledgedAgreementId !== annualCoverage.companyAgreementId,
        acknowledgedAt: lcdwElection?.acknowledgedAt?.toISOString() ?? null,
      }
    : null

  // One document for this job — the master with this job's addendum stapled
  // on. Only offered once it exists; the gated proxy falls back to the
  // addendum alone if the staple failed.
  const jobAgreementCopy =
    annualCoverage && order.jobId
      ? await prisma.jobAgreementAddendum.findFirst({
          where: { jobId: order.jobId, deletedAt: null },
          select: { combinedFileUrl: true, addendumFileUrl: true },
        })
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
    /** Set only when a staff member is looking — the page wears a banner and
     *  every action on it is inert, because the write routes refuse the
     *  preview cookie. */
    preview: read.previewBy
      ? {
          by: read.previewBy,
          // Where the staff member came from, so the banner can send them
          // back (Wes 2026-09-12: "there is no back button or close button").
          // Built here from ids we already hold — never from anything the
          // request supplies, so it cannot become an open redirect.
          backUrl: `${(process.env.NEXT_PUBLIC_APP_URL || 'https://hq.sirreel.com').replace(/\/$/, '')}${
            order.jobId ? `/jobs/${order.jobId}` : `/orders/${order.id}`
          }`,
        }
      : null,
    company: { id: order.company.id, name: order.company.name, hasLogo: !!(order.company.logoSvg || order.company.logoUrl) },
    standingAgreement,
    /** The annual-agreement option on this account: null when it doesn't
     *  apply (already covered), otherwise the state of the ask. */
    annualOption,
    annualAgreement: annualCoverage
      ? {
          title: annualCoverageTitle(annualCoverage),
          companyName: annualCoverage.companyName,
          effectiveDate: annualCoverage.effectiveDate?.toISOString() ?? null,
          expiryDate: annualCoverage.expiryDate?.toISOString() ?? null,
          sentence: annualCoverageSentence(annualCoverage),
          // Gated proxy, never the raw private blob (it 403s in a browser).
          pdfUrl: '/api/portal/job/agreement/annual',
          // The stapled master + this job's addendum, when one has been cut.
          jobCopyUrl:
            jobAgreementCopy?.combinedFileUrl || jobAgreementCopy?.addendumFileUrl
              ? '/api/portal/job/agreement/job-copy'
              : null,
        }
      : null,
    lcdw,
    order: {
      id: order.id,
      orderNumber: order.orderNumber,
      startDate: orderWindow.start,
      endDate: orderWindow.end,
      status: order.status,
      cadenceState: order.cadenceState,
      total: order.total.toString(),
      // Nothing has been priced or sent on this order yet. True for a job
      // the CLIENT set up themselves on the public agreement page: they
      // hold a portal and may have signed, but no rep has confirmed the
      // vehicles or the dates. The portal says so out loud rather than
      // letting a progress bar reading "Quote" imply a booking
      // (Wes 2026-09-07).
      awaitingConfirmation: order.status === 'DRAFT' && order.quoteSentAt == null,
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
    // Booking details — the same block the quote PDF prints, from the same
    // builder, so the page a client reads and the PDF they were sent cannot
    // drift apart. Resolved server-side: the LCDW half needs to know which
    // lines are partner-fulfilled, and that fact must not travel in the
    // client-facing lineItems DTO above. Only finished sentences cross.
    bookingTerms: buildBookingTerms({
      vehicles: order.lineItems
        // A FEE is a charge, not a vehicle — never judge one (the same rule
        // applyLcdw.ts follows). This mattered the moment driver fees moved
        // into VEHICLES: the driver line counted as an insurable vehicle and
        // flipped an all-partner order back to "waiver available"
        // (S260828-001, 2026-09-08).
        .filter((li) => li.department === 'VEHICLES' && li.type !== 'DISCOUNT' && li.type !== 'FEE')
        .map<BookingVehicleLine>((li) => ({
          description: li.description,
          code: li.inventoryItem?.code ?? null,
          isPartnerVehicle: li.subRentals.length > 0,
          catalogIsSpecialty: li.inventoryItem?.isSpecialtyVehicle ?? false,
        })),
    }),
    /** @deprecated the office line, kept under its old name for anything
     *  still reading it — say what it is with `support` instead. */
    afterHoursLine: AFTER_HOURS_LINE,
    /** Which number to use, and when. AHA answers texts around the clock;
     *  the office line only answers during the day (Wes 2026-09-12). */
    support: supportLines(),
    /** True once an agent has released this job's after-hours instructions
     *  — the portal shows the card, the card links to the page. A boolean,
     *  not the codes: the codes have exactly one route and it audit-logs. */
    afterHoursReleased: !!order.job?.afterHoursReleasedAt,
    /** Shown ONLY when `agent` is null — the person to ask when nobody has
     *  taken the account yet. The page never renders both. */
    defaultRep: fallbackRep
      ? {
          id: fallbackRep.id,
          name: fallbackRep.name,
          email: fallbackRep.email,
          phone: fallbackRep.phone,
          // displayTitle is the canonical client-facing label. The role
          // fallback is defense-in-depth — every @sirreel.com User has a
          // displayTitle as of May 2026, but a new admin-created row with
          // no displayTitle shouldn't blank out the badge in the portal.
          // Internal role names ('ADMIN', 'AGENT') are never exposed —
          // we map to client-safe labels here.
          displayTitle: fallbackRep.displayTitle || defaultDisplayTitleForRole(fallbackRep.role),
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
      coi: governingCoi
        ? {
            id: governingCoi.coi.id,
            fileUrl: governingCoi.coi.fileUrl,
            originalFilename: governingCoi.coi.originalFilename,
            humanDecision: governingCoi.coi.humanDecision,
            // The badge word, its colour and the sentence under it — ONE
            // derivation (lib/coi/coiState). A fix request (COUNTERED) used
            // to fall through the portal's APPROVED/REJECTED check and read
            // "Reviewing" while the desk showed it as rejected.
            decision: coiClientDecision(
              governingCoi.coi.humanDecision,
              governingCoi.coi.coverageVerified,
              governingCoi.coi.humanDecisionAt,
            ),
            aiRiskLevel: governingCoi.coi.aiRiskLevel,
            policyExpiryDate: governingCoi.coi.policyExpiryDate,
            coverageVerified: governingCoi.coi.coverageVerified,
            additionalInsured: governingCoi.coi.additionalInsured,
            uploadedAt: governingCoi.coi.createdAt,
            // Carried from the account rather than uploaded for this job.
            // Said out loud: a client who never sent a certificate for this
            // job should understand why we are not asking for one.
            source: governingCoi.source,
            sourceSentence: coiSourceSentence(governingCoi, order.company?.name),
            // Named when the policy lapses mid-rental. NOT silently treated
            // as coverage — the renewal is still needed before the last day.
            expiresDuringRental: governingCoi.expiresDuringRental?.toISOString() ?? null,
            // The client is told about a name mismatch on their OWN
            // certificate — Wes, 2026-08-25: "flag it for both SirReel and
            // User side". Only the client-safe sentence crosses the wire;
            // the staff wording (which reasons about our records) does not.
            // Empty string means "nothing to say", so the portal never has
            // to know the verdict vocabulary.
            insuredNotice:
              evaluateInsuredMatch(governingCoi.coi.namedInsured, [order.company?.name, order.job?.name])
                .clientMessage || null,
            // The one question only the client can answer. 'NEEDED' means
            // the certificate is on file and unconfirmed for this job —
            // which is an open question, never a coverage failure.
            confirmation: {
              state: coiConfirmation.state,
              aboutSupersededCoi: coiConfirmation.aboutSupersededCoi,
              decidedAt: coiConfirmation.decidedAt?.toISOString() ?? null,
              confirmerName: coiConfirmation.confirmerName,
              question: confirmationQuestion(order.company?.name),
            },
          }
        : null,
      // Said out loud wherever the account certificate has stopped standing
      // in: silence here would read as a client who simply never uploaded.
      coiSeparatePolicyNotice: separatePolicySentence(coiConfirmation) || null,
      // The figure their broker needs for the equipment line of the COI —
      // descriptions, quantities and values only. A floor (complete:false)
      // when a line is still being valued, and said so on the page.
      replacementValue: toClientReplacementValue(await loadOrderReplacementValue(order.id)),
      legacyPaperworkPortalUrl: paperworkPortal
        ? portalTokenUrl(paperworkPortal.token)
        : null,
      cardAuth,
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
          categoryName: va.asset.category?.name ?? null,
          photoPath: va.asset.category?.id ? vehiclePhotoByCategory.get(va.asset.category.id) ?? null : null,
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
    // How the gear leaves the building, and the reserved units it could ride
    // on. Wes 2026-09-12: "orders have a drop down — Load on Asset 1, Load on
    // Asset 2, Will Call, Delivery." DELIVERY is Order.deliveryRequested (the
    // dispatch flag) and wins the read; the other two live on
    // Order.gearHandoff, the same field the order builder writes.
    gearHandoff: {
      kind: order.deliveryRequested
        ? ('DELIVERY' as const)
        : ((order.gearHandoff as 'WILL_CALL' | 'LOAD_ON' | null) ?? null),
      assignmentId: order.gearLoadsOnAssignmentId,
      units: vehicleAssignments.map((va) => ({
        assignmentId: va.id,
        unitName: va.asset.unitName,
        title:
          [va.asset.year ? String(va.asset.year) : '', va.asset.make || '', va.asset.model || '']
            .filter(Boolean)
            .join(' ')
            .trim() || va.asset.unitName,
      })),
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

/**
 * The annual-agreement option for an account that is not already covered.
 *
 * Returns null when there is nothing to say — no company, or the client is
 * on an annual already (the caller passes null for that case, because a
 * covered account is described by the coverage banner instead).
 */
async function resolveAnnualOption(companyId: string | null): Promise<
  | { state: 'OFFER' }
  | { state: 'REQUESTED'; requestedAt: string }
  | { state: 'PENDING_SIGNATURE' }
  | null
> {
  if (!companyId) return null
  const [pending, request] = await Promise.all([
    findPendingAnnual(companyId),
    findOpenAnnualRequest(companyId),
  ])
  if (pending) return { state: 'PENDING_SIGNATURE' }
  if (request) return { state: 'REQUESTED', requestedAt: request.createdAt.toISOString() }
  return { state: 'OFFER' }
}
