import { notFound } from 'next/navigation'
import { requireWorkspace, basePath } from '@/lib/hq-white-label/page'
import { loadBooking, loadClients, loadUnits } from '@/lib/hq-white-label/data'
import { BookingForm } from '@/components/hq-white-label/BookingForm'
import { PAGE, PageHead, StatusChip } from '@/components/hq-white-label/ui'

export const dynamic = 'force-dynamic'

export default async function EditBookingPage({ params }: { params: { token: string; id: string } }) {
  const ws = await requireWorkspace(params.token)
  const base = basePath(params.token)
  const [b, units, clients] = await Promise.all([loadBooking(ws, params.id), loadUnits(ws, { includeInactive: true }), loadClients(ws)])
  if (!b || b.source !== 'direct') notFound()
  return (
    <div className={`${PAGE} max-w-[760px]`}>
      <div className="flex items-center gap-3 mb-1"><StatusChip status={b.status} /></div>
      <PageHead title={b.title} sub={`${b.vehicleName}`} />
      <BookingForm
        base={base}
        token={params.token}
        bookingId={b.id}
        units={units.map((u) => ({ id: u.id, name: u.name }))}
        clients={clients.map((c) => ({ id: c.id, name: c.name }))}
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
          notes: b.notes ?? '',
        }}
      />
    </div>
  )
}
