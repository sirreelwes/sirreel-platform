import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

/**
 * GET /api/bookings/list
 *
 * Powers the /bookings job-card grid. Filters:
 *   - rentalworksOrderId IS NULL — only native bookings (RW-synced rows
 *     are managed in RentalWorks and shouldn't surface in the native
 *     /bookings view).
 *   - archivedAt IS NULL by default. Pass `?archived=1` to fetch the
 *     archived set instead (used by the "Show archived" filter chip).
 *
 * Each returned row carries `_counts` for linked rows that the UI uses
 * to warn before archive ("X portal accesses, Y signed agreements
 * will be hidden along with this booking").
 */
export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const archivedFlag = url.searchParams.get('archived') === '1';

    const bookings = await prisma.booking.findMany({
      where: {
        rentalworksOrderId: null,
        archivedAt: archivedFlag ? { not: null } : null,
      },
      include: {
        company: { select: { name: true } },
        person: { select: { firstName: true, lastName: true, email: true } },
        agent: { select: { name: true } },
        paperworkRequests: {
          orderBy: { sentAt: 'desc' },
          take: 1,
          select: {
            token: true,
            contractType: true,
            rentalAgreement: true,
            lcdwAccepted: true,
            coiReceived: true,
            creditCardAuth: true,
            studioContractSigned: true,
            sentAt: true,
          },
        },
        _count: {
          select: {
            paperworkRequests: true,
            orders: true,
            dispatchTasks: true,
            insuranceClaims: true,
          },
        },
        // Pull signed agreement + portal access counts via Order rows.
        // Prisma doesn't expose nested _count, so we hand-aggregate
        // below from the orders include.
        orders: {
          select: {
            _count: { select: { signedAgreements: true, portalAccesses: true } },
          },
        },
      },
      orderBy: [{ archivedAt: 'desc' }, { createdAt: 'desc' }],
      take: 100,
    });

    // Roll up nested counts so the UI doesn't need to walk orders[].
    const shaped = bookings.map((b) => {
      const signedAgreementCount = b.orders.reduce((s, o) => s + o._count.signedAgreements, 0);
      const portalAccessCount = b.orders.reduce((s, o) => s + o._count.portalAccesses, 0);
      // Drop the orders[] payload — only the rolled-up counts are needed by /bookings.
      const { orders: _orders, ...rest } = b;
      return {
        ...rest,
        relatedCounts: {
          paperworkRequests: b._count.paperworkRequests,
          orders: b._count.orders,
          dispatchTasks: b._count.dispatchTasks,
          insuranceClaims: b._count.insuranceClaims,
          signedAgreements: signedAgreementCount,
          portalAccesses: portalAccessCount,
        },
      };
    });

    return NextResponse.json({ bookings: shaped });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
