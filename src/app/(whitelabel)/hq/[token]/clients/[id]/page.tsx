import { notFound } from 'next/navigation'
import Link from 'next/link'
import { requireWorkspace, basePath } from '@/lib/hq-white-label/page'
import { loadBookings, loadClient } from '@/lib/hq-white-label/data'
import { fmtRange } from '@/lib/hq-white-label/dates'
import { ClientForm } from '@/components/hq-white-label/ClientForm'
import { CARD, H2, MUTED, PAGE, PageHead, StatusChip } from '@/components/hq-white-label/ui'

export const dynamic = 'force-dynamic'

export default async function ClientPage({ params }: { params: { token: string; id: string } }) {
  const ws = await requireWorkspace(params.token)
  const base = basePath(params.token)
  const c = await loadClient(ws, params.id)
  if (!c) notFound()
  const bookings = (await loadBookings(ws)).filter((b) => b.clientId === c.id).sort((a, b) => (b.startDate ?? '').localeCompare(a.startDate ?? ''))
  return (
    <div className={`${PAGE} max-w-[760px]`}>
      <PageHead title={c.name} />
      <ClientForm base={base} token={params.token} clientId={c.id} initial={{ name: c.name, contactName: c.contactName ?? '', email: c.email ?? '', phone: c.phone ?? '', notes: c.notes ?? '' }} />
      <h2 className={`${H2} mt-8 mb-2`}>Bookings · {bookings.length}</h2>
      {bookings.length === 0 ? (
        <p className={MUTED}>None yet.</p>
      ) : (
        <div className={`${CARD} divide-y divide-[#eef0f3] overflow-hidden`}>
          {bookings.map((b) => (
            <Link key={b.id} href={b.href ?? `${base}/bookings`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 no-underline hover:bg-[#fafbfc]">
              <div className="min-w-0 flex-1">
                <div className="text-[14px] font-semibold text-[#111827]">{b.title}</div>
                <div className={MUTED}>{b.vehicleName} · {fmtRange(b.startDate, b.endDate)}</div>
              </div>
              <StatusChip status={b.status} />
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
