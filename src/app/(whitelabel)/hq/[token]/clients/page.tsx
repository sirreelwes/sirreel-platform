/** Clients — the productions that book the partner directly. */
import Link from 'next/link'
import { requireWorkspace, basePath } from '@/lib/hq-white-label/page'
import { loadClients } from '@/lib/hq-white-label/data'
import { CARD, Empty, MUTED, PAGE, PageHead } from '@/components/hq-white-label/ui'

export const dynamic = 'force-dynamic'

export default async function ClientsPage({ params }: { params: { token: string } }) {
  const ws = await requireWorkspace(params.token)
  const base = basePath(params.token)
  const clients = await loadClients(ws)
  return (
    <div className={PAGE}>
      <PageHead title="Clients" sub="The productions and companies that book you directly. SirReel's bookings come in on their own." action={{ href: `${base}/clients/new`, label: '+ Add client' }} />
      {clients.length === 0 ? (
        <Empty>No clients yet. <Link href={`${base}/clients/new`} className="font-semibold text-[var(--hq-accent)]">Add the first one</Link>.</Empty>
      ) : (
        <div className={`${CARD} divide-y divide-[#eef0f3] overflow-hidden`}>
          {clients.map((c) => (
            <Link key={c.id} href={`${base}/clients/${c.id}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 hover:bg-[#fafbfc] no-underline">
              <div className="min-w-0 flex-1">
                <div className="text-[15px] font-semibold text-[#111827]">{c.name}</div>
                <div className={MUTED}>{[c.contactName, c.phone, c.email].filter(Boolean).join(' · ') || 'No contact details yet'}</div>
              </div>
              <div className={MUTED}>{c.bookingCount} booking{c.bookingCount === 1 ? '' : 's'}</div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
