import { requireWorkspace, basePath } from '@/lib/hq-white-label/page'
import { loadClients, loadUnits } from '@/lib/hq-white-label/data'
import { BookingForm } from '@/components/hq-white-label/BookingForm'
import { PAGE, PageHead } from '@/components/hq-white-label/ui'

export const dynamic = 'force-dynamic'

export default async function NewBookingPage({ params, searchParams }: { params: { token: string }; searchParams: { unit?: string; start?: string } }) {
  const ws = await requireWorkspace(params.token)
  const base = basePath(params.token)
  const [units, clients] = await Promise.all([loadUnits(ws), loadClients(ws)])
  return (
    <div className={`${PAGE} max-w-[760px]`}>
      <PageHead title="New booking" sub="A hold keeps the unit on the calendar; confirm it when the production commits." />
      <BookingForm
        base={base}
        token={params.token}
        units={units.map((u) => ({ id: u.id, name: u.name }))}
        clients={clients.map((c) => ({ id: c.id, name: c.name }))}
        initial={{ vehicleId: searchParams.unit, startDate: searchParams.start, endDate: searchParams.start }}
      />
    </div>
  )
}
