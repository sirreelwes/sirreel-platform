/**
 * /reports/vehicles/history — every walk-around that has been filed.
 *
 * Wes, 2026-09-14: "for vehicle check in and check out forms, they need
 * to be able to go back and see previous check in check out forms.
 * Essentially a history."
 *
 * /reports/vehicles is a work queue two days back and six forward; a
 * truck drops off it as soon as the week moves on, and the 22 photos
 * taken at each end become unreachable. This is the record — what went
 * out and what came back, newest first, searchable by unit, show,
 * client, booking number or whoever walked it.
 *
 * Rows open the READ-ONLY view, never a capture screen. Same rule the
 * order sheets got: looking something up months later must not be one
 * mis-tap from re-filing it.
 */

import Link from 'next/link'
import { Lock, ArrowLeft, ArrowRight, Camera, AlertTriangle } from 'lucide-react'
import { getYardUser } from '@/lib/yard/requireYardAccess'
import { listFiledInspections, type FiledInspectionRow } from '@/lib/fleet/inspectionHistory'

export const dynamic = 'force-dynamic'

function fmtWhen(d: Date): string {
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    timeZone: 'America/Los_Angeles',
  }).format(d)
}

/** The Pacific day a form was filed — the headings group on it. */
function pacificDay(d: Date): string {
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'America/Los_Angeles',
  }).format(d)
}

export default async function VehicleInspectionHistoryPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>
}) {
  const user = await getYardUser()
  if (!user) {
    return (
      <div className="max-w-sm mx-auto text-center py-16 px-6">
        <Lock size={32} aria-hidden className="mx-auto mb-3 text-lt-fg3" />
        <h1 className="text-lt-fg text-xl font-semibold mb-2">Yard access required</h1>
        <p className="text-lt-fg2 text-[15px]">
          Vehicle check in/out is for fleet and warehouse staff. Ask Wes or Hugo if you need it.
        </p>
      </div>
    )
  }

  const { q } = await searchParams
  const rows = await listFiledInspections({ q })
  const days = [...new Set(rows.map((r) => pacificDay(r.inspectedAt)))]

  return (
    <div className="max-w-4xl mx-auto px-1 py-2">
      <header className="mb-5">
        <Link
          href="/reports/vehicles"
          className="inline-flex items-center gap-1.5 text-[13px] text-lt-fg2 hover:text-lt-fg mb-2"
        >
          <ArrowLeft size={14} aria-hidden /> Check In/Out
        </Link>
        <h1 className="text-lt-fg text-2xl font-bold">Past walk-arounds</h1>
        <p className="text-lt-fg2 text-[15px] mt-0.5 max-w-[70ch]">
          Every vehicle check-out and check-in that has been filed, newest first. Opening one shows
          the photos and readings as they were captured — it does not re-open the form.
        </p>
      </header>

      {/* A plain GET form: no client state, and the search survives a
          refresh or a link somebody pastes into Slack. */}
      <form method="GET" className="mb-5 flex items-center gap-2">
        <input
          type="search"
          name="q"
          defaultValue={q ?? ''}
          placeholder="Unit, show, client, booking number, or who walked it"
          className="flex-1 bg-lt-card border border-lt-hairline rounded-lg px-3 py-2 text-[15px] text-lt-fg placeholder:text-lt-fg3"
        />
        <button
          type="submit"
          className="px-4 py-2 bg-amber-600 hover:bg-amber-500 text-white text-[15px] font-semibold rounded-lg"
        >
          Search
        </button>
        {q ? (
          <Link href="/reports/vehicles/history" className="text-[14px] text-lt-fg2 hover:text-lt-fg px-2">
            Clear
          </Link>
        ) : null}
      </form>

      {rows.length === 0 ? (
        <p className="border border-lt-hairline bg-lt-card rounded-xl px-4 py-8 text-center text-[15px] text-lt-fg3">
          {q ? `No walk-around matches “${q}”.` : 'No vehicle check-outs or check-ins have been filed yet.'}
        </p>
      ) : (
        days.map((day) => (
          <section key={day} className="mb-6">
            <h2 className="text-lt-fg2 text-[13px] font-semibold uppercase tracking-wide mb-2">{day}</h2>
            <div className="border border-lt-hairline bg-lt-card rounded-xl overflow-hidden">
              {rows.filter((r) => pacificDay(r.inspectedAt) === day).map((r) => (
                <Row key={r.inspectionId} row={r} />
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  )
}

function Row({ row }: { row: FiledInspectionRow }) {
  return (
    <Link
      href={`/reports/vehicles/${row.inspectionId}`}
      className="flex items-center gap-3 px-3 py-2.5 border-b border-lt-hairline last:border-b-0 hover:bg-lt-inner"
    >
      <span
        className={`flex-none text-[11px] font-bold uppercase tracking-wider rounded px-1.5 py-0.5 border ${
          row.edge === 'OUT'
            ? 'text-chip-warn-fg border-chip-warn-fg/30 bg-chip-warn-bg'
            : 'text-chip-good-fg border-chip-good-fg/30 bg-chip-good-bg'
        }`}
      >
        {row.edge === 'OUT' ? 'Out' : 'In'}
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-lt-fg text-[16px] font-medium truncate">
          {row.unitName} <span className="text-lt-fg3 font-normal">· {row.category}</span>
        </div>
        <div className="text-lt-fg2 text-[13px] truncate">
          {row.jobName ?? 'No booking'}
          {row.company ? ` · ${row.company}` : ''} · {fmtWhen(row.inspectedAt)}
          {row.inspectorName
            ? ` · ${row.inspectorName}${row.byDriver ? ' (driver)' : ''}`
            : ''}
        </div>
      </div>
      <div className="flex-none flex items-center gap-2">
        {row.newDamageCount > 0 && (
          <span
            title={`${row.newDamageCount} damage row${row.newDamageCount === 1 ? '' : 's'} logged`}
            className="inline-flex items-center gap-1 text-[11px] font-semibold rounded px-1.5 py-0.5 border text-chip-bad-fg border-chip-bad-fg/30 bg-chip-bad-bg"
          >
            <AlertTriangle size={11} aria-hidden />
            {row.newDamageCount}
          </span>
        )}
        <span className="inline-flex items-center gap-1 text-[13px] text-lt-fg3 whitespace-nowrap">
          <Camera size={14} aria-hidden />
          {row.photoCount}
        </span>
        {row.mileage != null && (
          <span className="text-[13px] text-lt-fg3 tabular-nums whitespace-nowrap">
            {row.mileage.toLocaleString()} mi
          </span>
        )}
        <ArrowRight size={15} aria-hidden className="text-lt-fg3" />
      </div>
    </Link>
  )
}
