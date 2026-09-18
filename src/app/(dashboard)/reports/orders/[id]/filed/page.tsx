/**
 * /reports/orders/[id]/filed?edge=OUT|IN — what the sheet said.
 *
 * Oliver, 2026-09-14 (via Wes): "the fleet needs to be able to look at
 * past check-in and check-out sheets."
 *
 * READ-ONLY on purpose. The typing screen next door rewrites the order,
 * flags the agent and can re-send the client's quote; looking something
 * up two months later must not be one mis-tap away from any of that. So
 * this renders the filed report — ordered against counted, the
 * substitutions, the notes, the rows the floor added, and the photo of
 * the marked-up paper, which is the only thing that still shows the
 * handwriting once the counts are in.
 */

import Link from 'next/link'
import { Lock, ArrowLeft, Printer } from 'lucide-react'
import { getYardUser } from '@/lib/yard/requireYardAccess'
import { reportDraft } from '@/lib/orders/checkReports'
import { SendCheckInReportButton } from '@/components/reports/SendCheckInReportButton'

export const dynamic = 'force-dynamic'

const CHANGE_LABEL: Record<string, string> = {
  SHORT: 'Short', EXTRA: 'Extra', SUBSTITUTE: 'Swapped', ADDED: 'Added', REMOVED: 'Not sent',
}

function fmtWhen(iso: string): string {
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit', timeZone: 'America/Los_Angeles',
  }).format(new Date(iso))
}

/** A line's byline: time only when it was the filing day, else day + time. */
function fmtBy(iso: string | null, filedIso: string): string {
  if (!iso) return ''
  const tz = 'America/Los_Angeles'
  const day = (x: string) => new Intl.DateTimeFormat('en-US', { dateStyle: 'short', timeZone: tz }).format(new Date(x))
  const time = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone: tz }).format(new Date(iso))
  return day(iso) === day(filedIso)
    ? time
    : `${new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: tz }).format(new Date(iso))} ${time}`
}

function fmtDay(ymd: string | null): string {
  if (!ymd) return '—'
  const [y, m, d] = ymd.split('-').map(Number)
  return new Intl.DateTimeFormat('en-US', {
    month: 'short', day: 'numeric', timeZone: 'UTC',
  }).format(new Date(Date.UTC(y, m - 1, d)))
}

export default async function FiledSheetPage({
  params, searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ edge?: string }>
}) {
  const user = await getYardUser()
  if (!user) {
    return (
      <div className="max-w-sm mx-auto text-center py-16 px-6">
        <Lock size={32} aria-hidden className="mx-auto mb-3 text-lt-fg3" />
        <h1 className="text-lt-fg text-xl font-semibold mb-2">Yard access required</h1>
        <p className="text-lt-fg2 text-[15px]">Check in/out sheets are for fleet and warehouse staff.</p>
      </div>
    )
  }

  const { id } = await params
  const sp = await searchParams
  const edge = sp.edge === 'IN' ? 'IN' : 'OUT'
  const draft = await reportDraft(id, edge)
  if (!draft) {
    return (
      <div className="max-w-sm mx-auto text-center py-16 px-6">
        <h1 className="text-lt-fg text-xl font-semibold mb-2">Order not found</h1>
        <p className="text-lt-fg2 text-[15px]">It may have been deleted since this list was drawn.</p>
      </div>
    )
  }
  const isOut = edge === 'OUT'

  if (!draft.filed) {
    return (
      <div className="max-w-2xl mx-auto px-1 py-2">
        <Back />
        <h1 className="text-lt-fg text-2xl font-bold mb-1">No {isOut ? 'check-out' : 'check-in'} sheet on file</h1>
        <p className="text-lt-fg2 text-[15px]">
          {draft.jobName} · <span className="font-mono">{draft.orderNumber}</span> has nothing filed for this
          edge yet.{' '}
          <Link href={`/reports/orders/${id}?edge=${edge}`} className="text-amber-600 font-semibold">
            Type it in
          </Link>
          .
        </p>
      </div>
    )
  }

  const counted = draft.lines.filter((l) => l.onSheet)
  const held = draft.lines.filter((l) => !l.onSheet)
  const differed = counted.filter((l) => l.change !== 'NONE')

  return (
    <div className="max-w-3xl mx-auto px-1 py-2">
      <Back />

      <header className="mb-4">
        <div className="text-amber-600 text-[13px] font-semibold uppercase tracking-wide mb-1">
          {isOut ? 'Check-out sheet' : 'Check-in sheet'}
        </div>
        <h1 className="text-lt-fg text-2xl font-bold">{draft.jobName}</h1>
        <p className="text-lt-fg2 text-[15px] mt-0.5">
          {draft.company} · <span className="font-mono">{draft.orderNumber}</span> ·{' '}
          {fmtDay(draft.startDate)} → {fmtDay(draft.endDate)}
        </p>
        <p className="text-lt-fg2 text-[14px] mt-2">
          {draft.filed.passes.length > 1 ? 'Last filed' : 'Filed'} {fmtWhen(draft.filed.submittedAt)}
          {draft.filed.passes.length === 0 && draft.filed.preppedBy
            ? ` · prepped & loaded by ${draft.filed.preppedBy}`
            : ''}
          {draft.filed.partial ? ' · partial sheet, still open' : ''}
        </p>
        {/* Everyone who counted part of it — a sheet is often done in
            passes (Wes, 2026-09-15), and the line bylines below say which
            lines were whose. */}
        {draft.filed.passes.length > 0 && (
          <ul className="mt-1 text-[14px] text-lt-fg2 flex flex-wrap gap-x-4 gap-y-0.5">
            {draft.filed.passes.map((p) => (
              <li key={p.name}>
                <b className="text-lt-fg">{p.name}</b> · {p.lines} line{p.lines === 1 ? '' : 's'}
                {p.at ? ` · from ${fmtBy(p.at, draft.filed!.submittedAt)}` : ''}
              </li>
            ))}
          </ul>
        )}
        {draft.filed.changedOrder && (
          <p className="mt-2 text-[14px] text-chip-warn-fg bg-chip-warn-bg border border-chip-warn-fg/25 rounded-lg px-3 py-2">
            This sheet changed the order — {draft.agentName || 'the agent'} was flagged.
          </p>
        )}
      </header>

      <div className="flex items-center gap-3 mb-4">
        <a
          href={`/api/orders/${id}/pick-list-pdf?receipt=1`}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 text-[14px] font-semibold text-lt-fg2 hover:text-lt-fg border border-lt-hairline rounded-lg px-3 py-1.5"
        >
          <Printer size={14} aria-hidden /> Print this sheet
        </a>
        <Link
          href={`/reports/orders/${id}?edge=${edge}`}
          className="text-[14px] text-lt-fg2 hover:text-amber-600"
        >
          Open to correct
        </Link>
      </div>

      <div className="border border-lt-hairline bg-lt-card rounded-xl overflow-hidden mb-4">
        <div className="px-3 py-2 bg-lt-inner border-b border-lt-hairline flex items-center justify-between">
          <span className="text-[12px] uppercase tracking-wide text-lt-fg2 font-semibold">
            {isOut ? 'What went out' : 'What came back'}
          </span>
          <span className="text-[12px] text-lt-fg3">
            {counted.length} line{counted.length === 1 ? '' : 's'}
            {differed.length ? ` · ${differed.length} differed` : ' · all as ordered'}
          </span>
        </div>

        {counted.map((l) => (
          <div
            key={l.orderLineItemId}
            className={`px-3 py-2.5 border-b border-lt-hairline last:border-b-0 ${
              l.change !== 'NONE' || (!isOut && l.damagedQty > 0) ? 'bg-chip-warn-bg' : ''
            }`}
          >
            <div className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <div className="text-lt-fg text-[16px] font-medium truncate">{l.description}</div>
                <div className="text-lt-fg2 text-[13px] truncate">
                  {l.qualifier && <span>{l.qualifier} · </span>}
                  ordered {l.expectedQty}
                  {!isOut && l.damagedQty > 0 && (
                    <span className="text-chip-bad-fg font-semibold"> · {l.damagedQty} back damaged</span>
                  )}
                  {l.lane && <span className="text-lt-fg3"> · {l.lane.toLowerCase()}</span>}
                  {l.countedBy && (
                    <span>
                      {' '}· counted by <b className="font-semibold text-lt-fg">{l.countedBy}</b>
                      {l.countedAt ? ` · ${fmtBy(l.countedAt, draft.filed!.submittedAt)}` : ''}
                    </span>
                  )}
                </div>
                {l.substituteFor && (
                  <div className="text-[13px] text-lt-fg2 mt-0.5">In place of {l.substituteFor}</div>
                )}
                {l.note && <div className="text-[13px] text-lt-fg2 mt-0.5 whitespace-pre-line">{l.note}</div>}
              </div>
              {l.change !== 'NONE' && (
                <span className="flex-none text-[11px] font-bold uppercase tracking-wider rounded px-1.5 py-0.5 border text-chip-warn-fg border-chip-warn-fg/30">
                  {CHANGE_LABEL[l.change] ?? l.change}
                </span>
              )}
              <span className="flex-none text-[15px] text-lt-fg tabular-nums">
                <span className="text-[12px] text-lt-fg3 uppercase tracking-wide mr-1.5">
                  {isOut ? 'Out' : 'In'}
                </span>
                {l.actualQty} <span className="text-lt-fg3">of {l.expectedQty}</span>
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* Rows the floor wrote on that were never on the order. They are
          recorded and flagged, never added as lines — the yard cannot see
          rates, so pricing one is the agent's. */}
      {draft.extras.length > 0 && (
        <div className="border border-lt-hairline bg-lt-card rounded-xl overflow-hidden mb-4">
          <div className="px-3 py-2 bg-lt-inner border-b border-lt-hairline text-[12px] uppercase tracking-wide text-lt-fg2 font-semibold">
            Went {isOut ? 'out' : 'back'} but was not on the order
          </div>
          {draft.extras.map((e, i) => (
            <div key={i} className="px-3 py-2.5 border-b border-lt-hairline last:border-b-0 flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <div className="text-lt-fg text-[16px] font-medium truncate">{e.description}</div>
                {e.note && <div className="text-[13px] text-lt-fg2">{e.note}</div>}
                {e.countedBy && <div className="text-[13px] text-lt-fg3">by {e.countedBy}</div>}
              </div>
              <span className="flex-none text-[15px] text-lt-fg tabular-nums">{e.actualQty}</span>
            </div>
          ))}
        </div>
      )}

      {held.length > 0 && (
        <div className="border border-lt-hairline bg-lt-inner rounded-xl px-3 py-2.5 mb-4">
          <div className="text-[12px] uppercase tracking-wide text-lt-fg2 font-semibold mb-1">
            Nobody has counted these yet · {held.length}
          </div>
          <p className="text-[14px] text-lt-fg2">
            {held.map((l) => `${l.description} (${l.expectedQty})`).join(' · ')}
          </p>
        </div>
      )}

      {/* The report Albert sends, on the record of the sheet he is
          reading (Wes, 2026-09-18). Read-only page, one write — and it is
          the one act this page exists to make easy to repeat, because
          the question "did anyone tell billing" is what brings people
          back here weeks later. */}
      {!isOut && (
        <div className="border border-lt-hairline bg-lt-card rounded-xl px-3 py-4 mb-4 text-center">
          <SendCheckInReportButton
            orderId={id}
            sentAt={draft.filed.reportSentAt}
            sentTo={draft.filed.reportSentTo}
            tone={draft.filed.reportSentAt ? 'secondary' : 'primary'}
            blockedReason={
              draft.filed.partial
                ? `${held.length} line${held.length === 1 ? '' : 's'} on this order still have not been counted — finish the check-in and the report goes out with the whole picture.`
                : null
            }
          />
        </div>
      )}

      {draft.filed.notes && (
        <div className="border border-lt-hairline bg-lt-card rounded-xl px-3 py-2.5 mb-4">
          <div className="text-[12px] uppercase tracking-wide text-lt-fg2 font-semibold mb-1">Notes</div>
          <p className="text-[15px] text-lt-fg whitespace-pre-line">{draft.filed.notes}</p>
        </div>
      )}

      {/* The paper itself. Private blob, streamed behind the yard gate. */}
      {draft.filed.sheetPhotoUrl && (
        <div className="border border-lt-hairline bg-lt-card rounded-xl overflow-hidden mb-8">
          <div className="px-3 py-2 bg-lt-inner border-b border-lt-hairline text-[12px] uppercase tracking-wide text-lt-fg2 font-semibold">
            The sheet as it came off the floor
          </div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`/api/orders/${id}/check-report/photo?edge=${edge}`}
            alt={`Photo of the ${isOut ? 'check-out' : 'check-in'} sheet for ${draft.orderNumber}`}
            className="w-full"
          />
        </div>
      )}
    </div>
  )
}

function Back() {
  return (
    <Link
      href="/reports/orders/history"
      className="inline-flex items-center gap-1.5 text-[13px] text-lt-fg2 hover:text-lt-fg mb-2"
    >
      <ArrowLeft size={14} aria-hidden /> Past sheets
    </Link>
  )
}
