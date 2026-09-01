import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { RW_VOID } from '@/lib/rentalworks/arStatus'
import { pickPrimaryContact } from '@/lib/jobs/primaryContact'
import { recomputeMostCommonProductionTypeProfile } from '@/lib/companies/recomputeMostCommonProductionTypeProfile'
import { rollupCadence, cadenceDays } from '@/lib/jobs/cadence'

export const dynamic = 'force-dynamic'

// GET /api/jobs/:id
//
// Phase 7 Pass A — expanded payload so /jobs/[id] can render as the
// agent's live-engagement command center without 3-click drilldowns:
//   - orders.lineItems (booked scope)
//   - orders.signedAgreements (rental + stage state)
//   - orders.invoices (paid / due rollup)
//   - orders.stageBookingTerms (delivery/pickup specifics)
//   - bookings (per-vehicle start/end dates via BookingItem→BookingAssignment)
//   - activity[] (AuditLog rows scoped to this job + its orders +
//     payments/invoices/picklists on those orders), newest first
//
// After-hours-arrangement data lives in two free-text places today:
// Order.notes (per-order) and StageBookingTerms.salesNotes (per-stage
// order). Both are surfaced so the UI can render whatever the agent
// typed. A structured field for after-hours is a Pass-B parking lot;
// flagged in the audit but not built this round.
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const job = await prisma.job.findUnique({
      where: { id: params.id },
      include: {
        company: true,
        agent: { select: { id: true, name: true, email: true } },
        // Physical-return attribution (Job.returnedAt is a scalar and
        // flows through the spread; the relation needs the include).
        returnedBy: { select: { id: true, name: true } },
        jobContacts: {
          include: { person: true },
          orderBy: [{ isPrimary: 'desc' }, { role: 'asc' }],
        },
        coiChecks: {
          where: { deletedAt: null },
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            coverageVerified: true,
            policyExpiryDate: true,
            humanDecision: true,
            // Dates the "Complete" state on the job's COI row.
            humanDecisionAt: true,
            source: true,
            originalFilename: true,
            aiRiskLevel: true,
            aiRecommendation: true,
            namedInsured: true,
            createdAt: true,
          },
        },
        // Job-level agreement coverage — a job is attached as an addendum
        // to an on-file (often annual) master. This is the job's rental /
        // stage agreement truth, separate from the order-native flow.
        agreementAddenda: {
          where: { deletedAt: null },
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            note: true,
            addendumFileUrl: true,
            createdAt: true,
            companyAgreement: {
              select: {
                id: true,
                contractType: true,
                title: true,
                isAnnual: true,
                effectiveDate: true,
                expiryDate: true,
                originalFilename: true,
              },
            },
          },
        },
        orders: {
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            orderNumber: true,
            status: true,
            subtotal: true,
            total: true,
            startDate: true,
            endDate: true,
            createdAt: true,
            notes: true,
            // Booked snapshot — Phase 1 commit 2. Surface for rollup.
            bookedTotal: true,
            fleetReadyAt: true,
            // Phase 1b — set on Orders created via the inquiry add-on
            // triage path. Drives the "Add-on" chip on the job detail
            // order row.
            addedToJobAt: true,
            // Booked scope — Pass A core ask.
            lineItems: {
              orderBy: { sortOrder: 'asc' },
              select: {
                id: true,
                sortOrder: true,
                type: true,
                department: true,
                description: true,
                quantity: true,
                rate: true,
                billableDays: true,
                lineTotal: true,
                pickupDate: true,
                returnDate: true,
                fulfillmentLane: true,
                pickStatus: true,
                qualifier: true,
                notes: true,
                inventoryItem: { select: { code: true, description: true, slug: true, trackingMode: true } },
              },
            },
            signedAgreements: {
              select: {
                id: true,
                contractType: true,
                status: true,
                signedAt: true,
                signerName: true,
                signedDocumentUrl: true,
                updatedAt: true,
              },
            },
            invoices: {
              orderBy: { createdAt: 'desc' },
              select: {
                id: true,
                invoiceNumber: true,
                type: true,
                status: true,
                total: true,
                amountPaid: true,
                balanceDue: true,
                sentAt: true,
                paidAt: true,
                dueDate: true,
                createdAt: true,
              },
            },
            stageBookingTerms: {
              select: {
                id: true,
                rentalDates: true,
                dailyRate: true,
                productionOfficeRental: true,
                specificSpaces: true,
                securityGuardRequired: true,
                salesNotes: true,
              },
            },
          },
        },
        // Per-vehicle scheduling truth — when a specific asset is
        // assigned to a BookingItem the dates live on the assignment.
        // Allows the Job page to show "Cargo Van #3 · 5/29 → 6/2".
        bookings: {
          select: {
            id: true,
            bookingNumber: true,
            startDate: true,
            endDate: true,
            status: true,
            // Where this booking came from. Native bookings are the ones
            // the team works in through the cutover; a non-null cart id
            // means the daily Planyo import created it, and the two can
            // describe the SAME real rental (the importer keys idempotency
            // on planyoCartId, so it cannot see a native twin).
            planyoCartId: true,
            items: {
              select: {
                id: true,
                quantity: true,
                // Feeds the five-check readiness strip (REQUESTED = gear
                // not picked yet) — src/lib/jobs/readiness.ts.
                status: true,
                holdRank: true,
                category: { select: { id: true, name: true, slug: true } },
                catalogItem: { select: { id: true, slug: true } },
                assignments: {
                  select: {
                    id: true,
                    startDate: true,
                    endDate: true,
                    status: true,
                    asset: { select: { id: true, unitName: true } },
                    // Who's been named to drive this unit. Licence state
                    // rides along so the job page can show a rep whether
                    // the vehicle can actually leave — booleans only, no
                    // licence numbers or image URLs on a list surface.
                    driverAssignments: {
                      where: { status: { not: 'CANCELLED' } },
                      orderBy: { invitedAt: 'desc' },
                      select: {
                        id: true,
                        status: true,
                        emailSentTo: true,
                        firstViewedAt: true,
                        invitedBySource: true,
                        driver: {
                          select: {
                            id: true, firstName: true, lastName: true, phone: true,
                            licenseFrontUrl: true, licenseBackUrl: true,
                            licenseExpired: true, licenseVerified: true,
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        // Phase 1.5: surface the originating Inquiry on the Job detail
        // page header when one exists. Back-relation on the existing
        // "ConvertedFromInquiry" named relation; no extra column.
        fromInquiry: {
          select: { id: true, source: true, createdAt: true, title: true },
        },
      },
    })

    if (!job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    }

    const primaryContact = pickPrimaryContact(job.jobContacts)

    // Phase 7 Pass A — activity feed scoped to this Job + its Orders
    // + every Payment / Invoice / PickList rooted at those Orders, plus
    // PickListItem actions on order line items. We don't have a
    // JobId column on AuditLog (entries are entityType+entityId
    // generic); the cheapest scope is by entity id set.
    const orderIds = job.orders.map((o) => o.id)
    const invoiceIds = job.orders.flatMap((o) => o.invoices.map((i) => i.id))
    const pickListIdsRows = orderIds.length
      ? await prisma.pickList.findMany({
          where: { orderId: { in: orderIds } },
          select: { id: true, items: { select: { id: true } } },
        })
      : []
    const pickListIds = pickListIdsRows.map((p) => p.id)
    const pickListItemIds = pickListIdsRows.flatMap((p) => p.items.map((i) => i.id))
    const paymentIds = invoiceIds.length
      ? (
          await prisma.payment.findMany({
            where: { invoiceId: { in: invoiceIds } },
            select: { id: true },
          })
        ).map((p) => p.id)
      : []

    // Cap to a sane batch. The expected steady-state for a job is
    // dozens of audit rows; 200 is generous and bounded.
    const activity = await prisma.auditLog.findMany({
      where: {
        OR: [
          { entityType: 'Job', entityId: job.id },
          ...(orderIds.length ? [{ entityType: 'Order', entityId: { in: orderIds } }] : []),
          ...(invoiceIds.length ? [{ entityType: 'Invoice', entityId: { in: invoiceIds } }] : []),
          ...(pickListIds.length ? [{ entityType: 'PickList', entityId: { in: pickListIds } }] : []),
          ...(pickListItemIds.length
            ? [{ entityType: 'PickListItem', entityId: { in: pickListItemIds } }]
            : []),
          ...(paymentIds.length
            ? [{ entityType: 'Payment', entityId: { in: paymentIds } }]
            : []),
        ],
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: {
        user: { select: { id: true, name: true } },
      },
    })

    // Job-level paperwork (card-on-file + LCDW) lives on
    // paperwork_requests, which is booking-scoped. Pull the job's
    // bookings' paperwork to surface card-auth status and per-booking
    // LCDW on the detail page. The raw CardSecure token is NEVER
    // returned — only display fields.
    const jobBookingIds = job.bookings.map((b) => b.id)
    const paperwork = jobBookingIds.length
      ? await prisma.paperworkRequest.findMany({
          where: { bookingId: { in: jobBookingIds } },
          orderBy: { sentAt: 'desc' },
          select: {
            id: true,
            bookingId: true,
            ccCardNumberEncrypted: true,
            ccCardLast4: true,
            ccCardType: true,
            ccCardholderFirst: true,
            ccCardholderLast: true,
            ccPaymentPreference: true,
            lcdwAccepted: true,
            lcdwDecision: true,
            // Workers' Comp certificate — metadata + AI verdict only. The
            // file itself is a private blob served by /api/wc/download/[id];
            // the URL never leaves the server.
            wcReceived: true,
            wcOriginalFilename: true,
            wcUploadedAt: true,
            wcAiReview: true,
            wcFileUrl: true,
          },
        })
      : []
    const cardRow = paperwork.find((p) => !!p.ccCardNumberEncrypted)
    const cardAuth = cardRow
      ? {
          onFile: true,
          last4: cardRow.ccCardLast4 ?? null,
          cardType: cardRow.ccCardType ?? null,
          cardholderName:
            [cardRow.ccCardholderFirst, cardRow.ccCardholderLast].filter(Boolean).join(' ').trim() ||
            null,
          paymentPreference:
            cardRow.ccPaymentPreference === 'CHECK_WIRE'
              ? 'CHECK_WIRE'
              : cardRow.ccPaymentPreference === 'CARD'
                ? 'CARD'
                : null,
        }
      : { onFile: false, last4: null, cardType: null, cardholderName: null, paymentPreference: null }
    // Three states, not two. A vehicle whose client DECLINED the waiver and
    // one nobody has asked yet both used to send `false`, so the badge read
    // "LCDW not accepted" for both and the team could not tell a refusal
    // from an open question — on a $24/day/vehicle line.
    const lcdwByBooking: Record<string, 'ACCEPTED' | 'DECLINED' | 'UNANSWERED'> = {}
    for (const p of paperwork) {
      // ordered sentAt desc → the first row seen per booking is the latest
      if (p.bookingId in lcdwByBooking) continue
      lcdwByBooking[p.bookingId] =
        p.lcdwDecision === 'ACCEPTED' || p.lcdwAccepted
          ? 'ACCEPTED'
          : p.lcdwDecision === 'DECLINED'
            ? 'DECLINED'
            : 'UNANSWERED'
    }
    // Workers' Comp certificates actually on file for this job's bookings.
    // `wcFileUrl` decides — wcReceived alone can be true on legacy rows
    // whose upload predates real storage. Only the download id is exposed.
    const wcCerts = paperwork
      .filter((p) => !!p.wcFileUrl)
      .map((p) => {
        const r = (p.wcAiReview ?? null) as Record<string, unknown> | null
        const str = (k: string) => (typeof r?.[k] === 'string' ? (r[k] as string) : null)
        return {
          id: p.id,
          bookingId: p.bookingId,
          filename: p.wcOriginalFilename || 'Workers Comp certificate',
          uploadedAt: p.wcUploadedAt,
          pass: typeof r?.pass === 'boolean' ? (r.pass as boolean) : null,
          provider: str('provider') || str('payrollProviderName'),
          insuredName: str('insuredName'),
          expiryDate: str('expiryDate'),
          expired: typeof r?.expired === 'boolean' ? (r.expired as boolean) : null,
          issues: Array.isArray(r?.issues) ? (r.issues as unknown[]).filter((i): i is string => typeof i === 'string') : [],
        }
      })

    // Deal value from RentalWorks: total invoiced (non-VOID) across the
    // RW orders linked to this job. Used as the header Deal Value when the
    // job has no HQ-native orders — during the transition, RW is where the
    // real dollars live.
    const rwLinks = await prisma.jobRwOrder.findMany({
      where: { jobId: job.id },
      select: { rwOrderNumber: true },
    })
    let rwInvoicedTotal = 0
    if (rwLinks.length) {
      const rwAgg = await prisma.rwInvoice.aggregate({
        where: {
          orderNumber: { in: rwLinks.map((l) => l.rwOrderNumber) },
          status: { not: RW_VOID },
        },
        _sum: { invoiceTotal: true },
      })
      rwInvoicedTotal = Number(rwAgg._sum.invoiceTotal ?? 0)
    }

    // Rollup: prefer bookedTotal sum (locked-in dollars) and fall
    // back to subtotal for un-booked orders; CANCELLED still excluded.
    const orderTotal = job.orders
      .filter((o) => o.status !== 'CANCELLED')
      .reduce(
        (sum, o) => sum + Number((o.bookedTotal ?? o.subtotal) || 0),
        0,
      )

    // Operational cadence — the SAME rollup the /jobs board renders, so
    // the detail header and the board card can't tell different stories
    // about the same job. Derived from the orders; Job.status only gets
    // a say through the HOLD / LOST / WRAPPED off-ramps.
    const { today, tomorrow } = cadenceDays()
    const cadence = rollupCadence(
      job.status,
      job.orders.filter((o) => o.status !== 'CANCELLED'),
      today,
      tomorrow,
    )

    return NextResponse.json({
      job: {
        ...job,
        estimatedValue: job.estimatedValue == null ? null : Number(job.estimatedValue),
        orderTotal,
        cadence,
        rwInvoicedTotal,
        rwOrderCount: rwLinks.length,
        orders: job.orders.map((o) => ({
          ...o,
          subtotal: Number(o.subtotal || 0),
          total: Number(o.total || 0),
          bookedTotal: o.bookedTotal == null ? null : Number(o.bookedTotal),
          lineItems: o.lineItems.map((li) => ({
            ...li,
            rate: Number(li.rate),
            lineTotal: Number(li.lineTotal),
          })),
          invoices: o.invoices.map((inv) => ({
            ...inv,
            total: Number(inv.total),
            amountPaid: Number(inv.amountPaid),
            balanceDue: Number(inv.balanceDue),
          })),
          stageBookingTerms: o.stageBookingTerms
            ? { ...o.stageBookingTerms, dailyRate: Number(o.stageBookingTerms.dailyRate) }
            : null,
        })),
        primaryContact,
        activity,
        cardAuth,
        lcdwByBooking,
        wcCerts,
      },
    })
  } catch (error) {
    console.error(`GET /api/jobs/${params.id} error:`, error)
    return NextResponse.json({ error: 'Failed to fetch job' }, { status: 500 })
  }
}

// PATCH /api/jobs/:id
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  // Session-required for mutations. Matches the guard pattern applied
  // across CRM, orders, and the API mutation audit (Tier 1).
  const session = await getServerSession()
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await req.json()
    const {
      name,
      status,
      productionType,
      productionTypeProfileId,
      agentId,
      notes,
      estimatedValue,
      tags,
    } = body

    const job = await prisma.job.update({
      where: { id: params.id },
      data: {
        ...(name !== undefined && { name }),
        ...(status !== undefined && { status }),
        ...(productionType !== undefined && { productionType }),
        // Accept null or empty string to explicitly clear; otherwise
        // treat as the new FK value. Empty-string-to-null matches the
        // create-flow defensive normalization.
        ...(productionTypeProfileId !== undefined && {
          productionTypeProfileId:
            typeof productionTypeProfileId === 'string' && productionTypeProfileId
              ? productionTypeProfileId
              : null,
        }),
        ...(agentId !== undefined && { agentId }),
        ...(notes !== undefined && { notes }),
        // Job tags (e.g. 'ART_DEPT') — full-array replace, strings only.
        ...(Array.isArray(tags) && {
          tags: tags.filter((t: unknown): t is string => typeof t === 'string' && t.trim() !== ''),
        }),
        // No startDate/endDate here or anywhere else: a job has no dates of
        // its own (lib/jobs/dateRange). A caller that still sends them is
        // ignored rather than 400'd.
        ...(estimatedValue !== undefined && {
          estimatedValue:
            estimatedValue == null || estimatedValue === '' ? null : Number(estimatedValue),
        }),
      },
    })

    // Refresh the Company's most-common-profile cache when the FK was
    // in the body — whether it changed value or not. The helper is
    // one indexed findMany + one update; cheap enough to always run
    // rather than case-analysing "did it actually change?" Skipped
    // when productionTypeProfileId wasn't in the body at all — name/
    // notes/dates edits don't change the company's profile
    // distribution. companyId comes off the updated row (prisma
    // update returns all scalars by default).
    if (productionTypeProfileId !== undefined) {
      try {
        await recomputeMostCommonProductionTypeProfile(job.companyId)
      } catch (err) {
        console.warn('[jobs PATCH] recompute most-common profile failed:', err)
      }
    }

    return NextResponse.json({
      job: {
        ...job,
        estimatedValue: job.estimatedValue == null ? null : Number(job.estimatedValue),
      },
    })
  } catch (error) {
    console.error(`PATCH /api/jobs/${params.id} error:`, error)
    return NextResponse.json({ error: 'Failed to update job' }, { status: 500 })
  }
}
