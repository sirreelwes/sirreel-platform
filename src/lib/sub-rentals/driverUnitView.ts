/**
 * What the partner's DRIVER sees on /drive/unit/[token], and the token
 * lookup every route under /api/drive/unit shares.
 *
 * The driver is the partner's employee: they may know their employer's name
 * and the unit. They get the location, access notes, call time and the note
 * the production wrote for them. They do NOT get the production's name,
 * company or contact numbers — see conduit.ts for the ruling.
 */
import { prisma } from '@/lib/prisma'
import { isAckStale, hoursPromptOpen } from '@/lib/drivers/hoursEntry'
import { listHours, type HoursView } from '@/lib/drivers/hoursStore'
import { loadConduit, logisticsFor, unitNameOf, type ConduitRow, type LogisticsView } from '@/lib/sub-rentals/conduit'

export async function subRentalForDriverToken(token: string): Promise<ConduitRow | null> {
  if (!token || token.length < 32) return null
  const hit = await prisma.subRental.findFirst({ where: { driverToken: token }, select: { id: true } })
  if (!hit) return null
  return loadConduit(hit.id)
}

export interface DriverUnitView {
  driverName: string
  vendorName: string
  unitName: string
  status: string
  startDate: string | null
  endDate: string | null
  reference: string | null
  logistics: LogisticsView
  ack: { at: string; note: string | null; stale: boolean } | null
  hours: HoursView
  hoursPromptOpen: boolean
  closed: boolean
}

export async function buildDriverUnitView(row: ConduitRow, today: string): Promise<DriverUnitView> {
  const startDate = row.startDate?.toISOString().slice(0, 10) ?? null
  const endDate = row.endDate?.toISOString().slice(0, 10) ?? null
  return {
    driverName: row.driverName ?? 'Driver',
    vendorName: row.vendor.name,
    unitName: unitNameOf(row),
    status: row.status,
    startDate,
    endDate,
    reference: row.job?.jobCode ?? null,
    logistics: logisticsFor(row),
    ack: row.driverAckedAt
      ? { at: row.driverAckedAt.toISOString(), note: row.driverAckNote, stale: isAckStale(row.driverAckedAt, row.logisticsUpdatedAt) }
      : null,
    hours: await listHours({ subRentalId: row.id }),
    hoursPromptOpen: hoursPromptOpen({ startDate, endDate }, today),
    closed: row.status === 'CANCELLED' || row.status === 'RETURNED',
  }
}

/** Today's date in the yard's time zone, as YYYY-MM-DD. */
export function todayPacific(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
}
