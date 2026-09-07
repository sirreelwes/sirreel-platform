/**
 * Driver-hours provider (DERIVED). A driver has logged their hours and the
 * order still bills the estimate.
 *
 * Wes 2026-09-07: "now wire the actual hours to the invoice." The wiring is
 * a click on the order (DriverTrueUpPrompt); this is what makes sure the
 * click happens before the invoice goes out. An invoice built off a stale
 * driver line is money we quietly gave away, or a surprise the client
 * disputes — both worse than a task in a list.
 *
 * Only the exception escalates: hours logged AND the priced hours differ
 * from the line. A driver who has not logged yet, a line that already
 * matches, or an invoiced order produce nothing.
 *
 * Owner roles: the desk that bills → [ADMIN, MANAGER, AGENT].
 */
import type { UserRole } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import type { ActionItem, ActionItemProvider, ProviderContext } from '@/lib/actionItems/types'
import { driverTrueUpForOrder } from '@/lib/orders/driverTrueUp'

const OWNER: UserRole[] = ['ADMIN', 'MANAGER', 'AGENT']

export const driverHoursUntruedProvider: ActionItemProvider = {
  id: 'driver-hours-untrued',
  kind: 'DERIVED',
  async fetch(_ctx: ProviderContext): Promise<ActionItem[]> {
    // Candidates first, cheaply: orders still open for edits that have a
    // partner booking with logged hours. The pricing pass runs on those
    // few, never on the whole book.
    const rows = await prisma.$queryRaw<Array<{ orderId: string; orderNumber: string; jobId: string | null; jobName: string | null; lastLogged: Date }>>`
      SELECT DISTINCT o.id AS "orderId", o.order_number AS "orderNumber", o.job_id AS "jobId", j.name AS "jobName",
             MAX(h.submitted_at) AS "lastLogged"
      FROM sr_driver_hours h
      JOIN sub_rentals s ON s.id = h.sub_rental_id
      JOIN sr_orders o ON o.id = s.order_id
      LEFT JOIN sr_jobs j ON j.id = o.job_id
      WHERE o.status NOT IN ('CANCELLED', 'INVOICED', 'CLOSED')
        AND s.status <> 'CANCELLED'
      GROUP BY o.id, o.order_number, o.job_id, j.name
      ORDER BY MAX(h.submitted_at) DESC
      LIMIT 50
    `.catch(() => [])

    const items: ActionItem[] = []
    for (const r of rows) {
      const trueUps = await driverTrueUpForOrder(r.orderId).catch(() => [])
      for (const t of trueUps) {
        if (!t.applicable || t.blockedReason) continue
        const money = (n: number) => `$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`
        items.push({
          id: `driver-hours:${t.lineId}`,
          type: 'driver_hours_untrued',
          title: `Driver hours not billed — ${r.jobName || r.orderNumber}`,
          subtitle: `${t.actualHours} hrs logged prices at ${money(t.actualPay)}; the order still bills ${money(t.quoted)} — ${t.delta > 0 ? `${money(t.delta)} short` : `${money(t.delta)} over`}. Apply it before invoicing.`,
          ownerRole: OWNER,
          // Under-billing is money walking out the door; over-billing is a
          // dispute waiting to happen. Both are high.
          priority: 'high',
          href: `/orders/${r.orderId}`,
          occurredAt: r.lastLogged,
          source: 'driver-hours-untrued',
          dismissal: { kind: 'sideRow' },
        })
      }
    }
    return items
  },
}
