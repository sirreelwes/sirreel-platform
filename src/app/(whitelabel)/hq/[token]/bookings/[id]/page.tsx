import { notFound } from 'next/navigation'
import { requireWorkspace, basePath } from '@/lib/hq-white-label/page'
import { loadBooking, loadClients, loadUnits } from '@/lib/hq-white-label/data'
import { listWorkspaceDrivers } from '@/lib/hq-white-label/driverFlow'
import { BookingForm } from '@/components/hq-white-label/BookingForm'
import { CARD, MUTED, NeedsChip, PAGE, PageHead, StatusChip } from '@/components/hq-white-label/ui'
import { DriverLinkCopy } from '@/components/hq-white-label/DriverLinkCopy'

export const dynamic = 'force-dynamic'

export default async function EditBookingPage({ params }: { params: { token: string; id: string } }) {
  const ws = await requireWorkspace(params.token)
  const base = basePath(params.token)
  const [b, units, clients, drivers] = await Promise.all([loadBooking(ws, params.id), loadUnits(ws, { includeInactive: true }), loadClients(ws), listWorkspaceDrivers(ws.vendorId)])
  if (!b || b.source !== 'direct') notFound()
  return (
    <div className={`${PAGE} max-w-[760px]`}>
      <div className="flex items-center gap-3 mb-1"><StatusChip status={b.status} /></div>
      <PageHead title={b.title} sub={`${b.vehicleName}`} />
      {b.driver && (
        <div className={`${CARD} px-5 py-4 mb-4`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-[15px] font-semibold">{b.driverName}</div>
              <div className={MUTED}>
                {b.driver.back ? 'Back on the lot' : b.driver.rolling ? 'Rolling — out on the job' : b.driver.acked ? (b.driver.ackStale ? 'Confirmed, but hasn’t seen the latest change' : 'Has the call time and location') : 'Emailed their page — hasn’t confirmed yet'}
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {b.needs.filter((n) => /driver/i.test(n)).map((n) => <NeedsChip key={n} text={n} />)}
            </div>
          </div>
          {b.driver.pageUrl && <DriverLinkCopy url={b.driver.pageUrl} />}
        </div>
      )}
      <BookingForm
        base={base}
        token={params.token}
        bookingId={b.id}
        units={units.map((u) => ({ id: u.id, name: u.name }))}
        clients={clients.map((c) => ({ id: c.id, name: c.name }))}
        drivers={drivers.map((d) => ({ id: d.id, name: d.name }))}
        initial={{
          vehicleId: b.vehicleId ?? undefined,
          clientId: b.clientId ?? '',
          title: b.title,
          startDate: b.startDate ?? '',
          endDate: b.endDate ?? '',
          status: b.status === 'QUOTED' ? 'HOLD' : b.status,
          dailyRate: b.dailyRate != null ? String(b.dailyRate) : '',
          location: b.location ?? '',
          callTime: b.callTime ?? '',
          driverName: b.driverName ?? '',
          vendorDriverId: b.driver?.id ?? '',
          notes: b.notes ?? '',
        }}
      />
    </div>
  )
}
