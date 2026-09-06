/** Drivers — the partner's roster. Add by email; the driver fills in the rest. */
import { requireWorkspace, basePath } from '@/lib/hq-white-label/page'
import { listWorkspaceDrivers } from '@/lib/hq-white-label/driverFlow'
import { DriverRosterForm } from '@/components/hq-white-label/DriverRosterForm'
import { CARD, Empty, H2, MUTED, PAGE, PageHead } from '@/components/hq-white-label/ui'

export const dynamic = 'force-dynamic'

export default async function DriversPage({ params }: { params: { token: string } }) {
  const ws = await requireWorkspace(params.token)
  const base = basePath(params.token)
  const drivers = await listWorkspaceDrivers(ws.vendorId)
  const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : null)
  return (
    <div className={PAGE}>
      <PageHead title="Drivers" sub="Add a driver by email. They fill in their own name, phone and licence once; after that, putting them on a booking sends them a page with the call time, the address, and where to log the day." />
      <h2 className={`${H2} mb-2`}>Add a driver</h2>
      <DriverRosterForm token={params.token} base={base} />
      <h2 className={`${H2} mt-8 mb-2`}>Your drivers · {drivers.length}</h2>
      {drivers.length === 0 ? (
        <Empty>Nobody yet. Add the first one above.</Empty>
      ) : (
        <div className={`${CARD} divide-y divide-[#eef0f3] overflow-hidden`}>
          {drivers.map((d) => (
            <div key={d.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="text-[15px] font-semibold text-[#111827]">{d.name}</div>
                <div className={MUTED}>{[d.email, d.phone].filter(Boolean).join(' · ')}</div>
              </div>
              <div className={`${MUTED} text-right`}>
                {d.profileComplete ? <span className="text-[#1f6b45] font-semibold">Profile complete</span> : d.profileViewedAt ? 'Opened their page, not finished' : d.invitedAt ? `Invited ${fmt(d.invitedAt)}` : 'Not invited'}
                {d.upcoming > 0 && <div>{d.upcoming} upcoming booking{d.upcoming === 1 ? '' : 's'}</div>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
