'use client'

/**
 * "Sub-rentals" on the job page — the partner-sourced units on this job and,
 * above all, whether their owners actually know.
 *
 * Why this exists (2026-08-29): a sub-rental had no HQ surface whatsoever.
 * Rows were created from an order line, the client-approval hook then asked
 * the partner to hold, and none of it was observable outside the database.
 * The failure that matters is silent by construction — the hook keeps the
 * client's yes durable even when the notice fails to send, so a row can read
 * REQUESTED while its owner still believes the unit is free. That state gets
 * the loudest treatment on this panel and a one-click resend, because the
 * cost of missing it is a coach that got rented to someone else.
 *
 * Self-fetching on jobId (like JobDocumentsPanel) rather than fed from the
 * job payload: it has its own mutations and its own refresh cycle, and most
 * jobs have no sub-rentals at all — it renders null then.
 *
 * Money is absent unless the API says seePricing. Hugo (MANAGER) takes
 * custody of these units and needs the panel; he is not to see the rates.
 */

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'

export interface JobSubRental {
  id: string
  status: string
  vehicleName: string
  quantity: number
  startDate: string | null
  endDate: string | null
  receiveMethod: string | null
  poNumber: string | null
  vendorNotifiedAt: string | null
  vendorHoldRequestedAt: string | null
  driverName: string | null
  driverPhone: string | null
  driverEmail: string | null
  relayAddress: string | null
  vendorUrl: string | null
  vendorTotal: number | null
  clientTotal: number | null
  vendor: { id: string; name: string; email: string | null; poEmail: string | null; phone: string | null }
  order: { id: string; orderNumber: string } | null
  orderLineItem: { id: string; description: string } | null
  // ── The conduit (2026-09-05). Optional so older fixtures still type. ──
  callTime?: string | null
  driverNotes?: string | null
  logisticsUpdatedAt?: string | null
  logisticsNotifiedAt?: string | null
  reportToAddress?: string | null
  reportToTime?: string | null
  driverUrl?: string | null
  driverViewedAt?: string | null
  driverAckedAt?: string | null
  driverAckNote?: string | null
  ackStale?: boolean
  hoursTotal?: number
  hoursDays?: number
  vendorConfirmedAt?: string | null
  vendorDeclinedAt?: string | null
  vendorDeclineNote?: string | null
}

const STATUS_CHIP: Record<string, string> = {
  ESTIMATED: 'bg-zinc-100 text-zinc-700 border-zinc-300',
  REQUESTED: 'bg-amber-50 text-amber-700 border-amber-200',
  CONFIRMED: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  PICKED_UP: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  ON_RENT: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  RETURNED: 'bg-zinc-100 text-zinc-600 border-zinc-300',
  CANCELLED: 'bg-white text-zinc-600 border-zinc-200',
}

const STATUS_LABEL: Record<string, string> = {
  ESTIMATED: 'Estimated',
  REQUESTED: 'Hold requested',
  CONFIRMED: 'Confirmed',
  PICKED_UP: 'Picked up',
  ON_RENT: 'On rent',
  RETURNED: 'Returned',
  CANCELLED: 'Cancelled',
}

/** Statuses in which the partner is supposed to be holding the unit. */
const COMMITTED = ['REQUESTED', 'CONFIRMED', 'PICKED_UP', 'ON_RENT']
const DEAD = ['RETURNED', 'CANCELLED']

const ADVANCE_TO = ['CONFIRMED', 'PICKED_UP', 'ON_RENT', 'RETURNED', 'CANCELLED']

const day = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
    : '—'

const stamp = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—'

const money = (n: number | null) =>
  n === null ? '—' : `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

/**
 * The partner was never actually asked. True only once the client has
 * committed — an ESTIMATED row is correctly un-asked, not broken.
 */
export function isUnaskedHold(s: JobSubRental): boolean {
  return COMMITTED.includes(s.status) && !s.vendorHoldRequestedAt
}

export function JobSubRentalsSection({ jobId }: { jobId: string }) {
  const [subs, setSubs] = useState<JobSubRental[] | null>(null)
  const [seePricing, setSeePricing] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)

  const load = useCallback(async () => {
    const r = await fetch(`/api/jobs/${jobId}/sub-rentals`)
    if (!r.ok) {
      setSubs([])
      return
    }
    const d = await r.json()
    setSubs(d.subRentals || [])
    setSeePricing(!!d.seePricing)
  }, [jobId])

  useEffect(() => {
    void load()
  }, [load])

  const resend = useCallback(
    async (s: JobSubRental) => {
      setBusyId(s.id)
      setErr(null)
      setMsg(null)
      try {
        const r = await fetch(`/api/sub-rentals/${s.id}/resend-hold`, { method: 'POST' })
        const j = await r.json().catch(() => ({}))
        if (!r.ok || !j.ok) throw new Error(j.error || `Could not send it (${r.status})`)
        setMsg(`${s.vendor.name} has been asked to hold ${s.vehicleName}.`)
        await load()
      } catch (e) {
        setErr(e instanceof Error ? e.message : 'Could not send it')
      } finally {
        setBusyId(null)
      }
    },
    [load],
  )

  const setStatus = useCallback(
    async (s: JobSubRental, status: string) => {
      if (
        status === 'CANCELLED' &&
        !window.confirm(
          `Cancel ${s.vehicleName} from ${s.vendor.name}?\n\nThis does not tell them — call or email ${s.vendor.name} yourself.`,
        )
      )
        return
      setBusyId(s.id)
      setErr(null)
      setMsg(null)
      try {
        const r = await fetch(`/api/sub-rentals/${s.id}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ status }),
        })
        const j = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(j.error || `Could not update it (${r.status})`)
        setMsg(`${s.vehicleName} → ${STATUS_LABEL[status] ?? status}.`)
        await load()
      } catch (e) {
        setErr(e instanceof Error ? e.message : 'Could not update it')
      } finally {
        setBusyId(null)
      }
    },
    [load],
  )

  const copy = useCallback(async (s: JobSubRental, which: 'vendor' | 'driver' = 'vendor') => {
    const url = which === 'vendor' ? s.vendorUrl : s.driverUrl
    if (!url) return
    try {
      await navigator.clipboard.writeText(url)
      setCopiedId(`${s.id}:${which}`)
      setTimeout(() => setCopiedId((c) => (c === `${s.id}:${which}` ? null : c)), 2000)
    } catch {
      setErr('Could not copy — select the link and copy it by hand.')
    }
  }, [])

  if (subs === null || subs.length === 0) return null

  const live = subs.filter((s) => !DEAD.includes(s.status))
  const unasked = subs.filter(isUnaskedHold)

  return (
    <div
      id="sub-rentals"
      className="bg-gradient-to-b from-white to-zinc-50 border border-zinc-200 rounded-2xl p-4 transition-colors duration-200 hover:border-zinc-400"
    >
      <div className="flex items-center justify-between">
        <h2 className="text-[15px] font-semibold text-zinc-900 flex items-center gap-2.5 before:content-[''] before:w-1 before:h-4 before:rounded-full before:bg-amber-500/80">
          Sub-rentals
        </h2>
        <span className="text-[12px] text-zinc-700">
          {live.length} live{subs.length !== live.length && ` · ${subs.length - live.length} closed`}
        </span>
      </div>

      {unasked.length > 0 && (
        <div className="mt-2.5 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-800">
          <strong className="font-semibold">
            {unasked.length === 1
              ? 'A partner has NOT been asked to hold their unit.'
              : `${unasked.length} partners have NOT been asked to hold their units.`}
          </strong>{' '}
          The client is committed, but the hold request never reached them — so the unit is still
          bookable by someone else. Send it below, or call them.
        </div>
      )}

      {err && (
        <div className="mt-2.5 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-800">
          {err}
        </div>
      )}
      {msg && (
        <div className="mt-2.5 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-[12px] text-emerald-800">
          {msg}
        </div>
      )}

      <div className="mt-3 space-y-2">
        {subs.map((s) => {
          const unaskedRow = isUnaskedHold(s)
          const busy = busyId === s.id
          return (
            <div
              key={s.id}
              className={`rounded-xl border px-3 py-2.5 ${
                unaskedRow ? 'border-red-200 bg-red-50' : 'border-zinc-200 bg-zinc-50'
              } ${DEAD.includes(s.status) ? 'opacity-60' : ''}`}
            >
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[14px] font-semibold text-zinc-900">{s.vehicleName}</span>
                    {s.quantity > 1 && (
                      <span className="text-[12px] text-zinc-600">× {s.quantity}</span>
                    )}
                    <span
                      className={`text-[11px] px-1.5 py-0.5 rounded border ${
                        STATUS_CHIP[s.status] ?? 'bg-zinc-100 text-zinc-700 border-zinc-300'
                      }`}
                    >
                      {STATUS_LABEL[s.status] ?? s.status}
                    </span>
                    {s.order && (
                      <Link
                        href={`/orders/${s.order.id}`}
                        className="text-[11px] px-1.5 py-0.5 rounded border border-violet-200 bg-violet-50 text-violet-700 hover:border-violet-400"
                      >
                        {s.order.orderNumber}
                      </Link>
                    )}
                  </div>
                  <div className="mt-1 text-[12px] text-zinc-600">
                    {s.vendor.name} · {day(s.startDate)} – {day(s.endDate)}
                    {s.poNumber && ` · PO ${s.poNumber}`}
                    {s.receiveMethod && ` · ${s.receiveMethod === 'PICKUP' ? 'we collect' : 'they deliver'}`}
                  </div>
                </div>

                {seePricing && (
                  <div className="text-right shrink-0">
                    <div className="text-[13px] font-semibold text-zinc-900">{money(s.clientTotal)}</div>
                    <div className="text-[11px] text-zinc-600">cost {money(s.vendorTotal)}</div>
                  </div>
                )}
              </div>

              {/* The hold state, said plainly. */}
              <div className="mt-2 text-[12px]">
                {unaskedRow ? (
                  <span className="text-red-700">
                    <strong className="font-semibold">Not asked to hold.</strong>{' '}
                    {s.vendor.poEmail || s.vendor.email
                      ? 'The notice never sent.'
                      : `${s.vendor.name} has no email on file — add one on the vendor record, or call ${s.vendor.phone || 'them'}.`}
                  </span>
                ) : s.vendorHoldRequestedAt ? (
                  <span className="text-zinc-600">
                    Asked to hold{' '}
                    {new Date(s.vendorHoldRequestedAt).toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric',
                    })}
                    .
                  </span>
                ) : s.status === 'ESTIMATED' ? (
                  <span className="text-zinc-600">
                    {s.vendorNotifiedAt
                      ? 'Told we quoted their dates. Nothing held — the client has not accepted.'
                      : 'Not yet told we quoted their dates.'}
                  </span>
                ) : null}
              </div>

              {/* The partner's own word, from their page. */}
              {s.vendorDeclinedAt ? (
                <div className="mt-1 text-[12px] text-red-700">
                  <strong className="font-semibold">{s.vendor.name} says they CAN&rsquo;T hold</strong> ({stamp(s.vendorDeclinedAt)}).
                  {s.vendorDeclineNote && <> &ldquo;{s.vendorDeclineNote}&rdquo;</>} Status unchanged — source a replacement or talk to the client.
                </div>
              ) : s.vendorConfirmedAt ? (
                <div className="mt-1 text-[12px] text-emerald-700">Partner confirmed the hold on their page {stamp(s.vendorConfirmedAt)}.</div>
              ) : null}

              {/* Where and when — what the client set on their portal, and whether it reached the other side. */}
              {COMMITTED.includes(s.status) && (
                <div className="mt-1 text-[12px] text-zinc-600">
                  {s.reportToAddress || s.callTime || s.reportToTime ? (
                    <>
                      {s.reportToAddress && <span className="text-zinc-800">{s.reportToAddress}</span>}
                      {(s.callTime || s.reportToTime) && <> · call <span className="text-zinc-800">{s.callTime ?? s.reportToTime}</span></>}
                      {s.driverNotes && <> · note: <span className="text-zinc-700">{s.driverNotes}</span></>}
                      {' · '}
                      {s.logisticsNotifiedAt && (!s.logisticsUpdatedAt || s.logisticsNotifiedAt >= s.logisticsUpdatedAt) ? (
                        <span>sent to partner{s.driverName ? ' + driver' : ''} {stamp(s.logisticsNotifiedAt)}</span>
                      ) : (
                        <span className="text-amber-700">changed {stamp(s.logisticsUpdatedAt ?? null)} — not yet sent</span>
                      )}
                    </>
                  ) : (
                    <span>Client hasn&rsquo;t set a location or call time yet (they do it under Deliveries on their portal).</span>
                  )}
                </div>
              )}

              {/* Driver — the vendor names their own on the vendor page. */}
              <div className="mt-1 text-[12px] text-zinc-600">
                {s.driverName ? (
                  <>
                    Driver <span className="text-zinc-800">{s.driverName}</span>
                    {s.driverPhone && ` · ${s.driverPhone}`}
                    {s.relayAddress && (
                      <>
                        {' · '}
                        <span className="text-zinc-600">relay {s.relayAddress}</span>
                      </>
                    )}
                    {' · '}
                    {s.driverAckedAt && !s.ackStale ? (
                      <span className="text-emerald-700">confirmed location &amp; call time {stamp(s.driverAckedAt)}</span>
                    ) : s.driverAckedAt && s.ackStale ? (
                      <span className="text-amber-700">confirmed an earlier version — awaiting re-confirm</span>
                    ) : s.driverViewedAt ? (
                      <span>opened their page {stamp(s.driverViewedAt)}, not confirmed</span>
                    ) : s.driverUrl ? (
                      <span>page sent, not opened</span>
                    ) : null}
                    {s.driverAckNote && <> · &ldquo;{s.driverAckNote}&rdquo;</>}
                    {(s.hoursDays ?? 0) > 0 && (
                      <> · <span className="text-zinc-800">{s.hoursTotal} hrs</span> logged over {s.hoursDays} {s.hoursDays === 1 ? 'day' : 'days'}</>
                    )}
                  </>
                ) : COMMITTED.includes(s.status) ? (
                  <span className="text-zinc-600">No driver named yet — the partner names theirs on their page.</span>
                ) : null}
              </div>

              {/* Actions */}
              <div className="mt-2.5 flex items-center gap-2 flex-wrap">
                {unaskedRow && (s.vendor.poEmail || s.vendor.email) && (
                  <button
                    onClick={() => resend(s)}
                    disabled={busy}
                    className="text-[12px] px-2.5 py-1 rounded-lg bg-amber-600 hover:bg-amber-500 text-white font-medium disabled:opacity-50"
                  >
                    {busy ? 'Sending…' : 'Send hold request'}
                  </button>
                )}
                {s.vendorUrl && (
                  <>
                    <button
                      onClick={() => copy(s, 'vendor')}
                      className="text-[12px] px-2.5 py-1 rounded-lg border border-zinc-300 text-zinc-700 hover:border-zinc-400 hover:text-zinc-900"
                    >
                      {copiedId === `${s.id}:vendor` ? 'Copied' : 'Copy partner link'}
                    </button>
                    {/* Preview, not the live link: opening the real page would count
                        as the partner opening it. */}
                    <Link
                      href={`/crm/portals/preview/vendor/${s.id}`}
                      className="text-[12px] px-2.5 py-1 rounded-lg border border-zinc-300 text-zinc-700 hover:border-zinc-400 hover:text-zinc-900"
                    >
                      Vendor view
                    </Link>
                  </>
                )}
                {s.driverUrl && (
                  <>
                    <button
                      onClick={() => copy(s, 'driver')}
                      className="text-[12px] px-2.5 py-1 rounded-lg border border-zinc-300 text-zinc-700 hover:border-zinc-400 hover:text-zinc-900"
                    >
                      {copiedId === `${s.id}:driver` ? 'Copied' : 'Copy driver link'}
                    </button>
                    <Link
                      href={`/crm/portals/preview/driver/${s.id}`}
                      className="text-[12px] px-2.5 py-1 rounded-lg border border-zinc-300 text-zinc-700 hover:border-zinc-400 hover:text-zinc-900"
                    >
                      Driver view
                    </Link>
                  </>
                )}
                {!DEAD.includes(s.status) && (
                  <select
                    value=""
                    disabled={busy}
                    onChange={(e) => {
                      if (e.target.value) void setStatus(s, e.target.value)
                      e.target.value = ''
                    }}
                    className="text-[12px] px-2 py-1 rounded-lg bg-zinc-100 border border-zinc-300 text-zinc-700 disabled:opacity-50"
                  >
                    <option value="">Move to…</option>
                    {ADVANCE_TO.filter((v) => v !== s.status).map((v) => (
                      <option key={v} value={v}>
                        {STATUS_LABEL[v]}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            </div>
          )
        })}
      </div>

      <p className="mt-3 text-[11px] text-zinc-600 leading-relaxed">
        Partners see their own page only — the unit, the dates, the status, our job code, and (since
        Sep 5) the delivery address, access notes and call time the client set. They never learn the
        production, the company or the contacts&rsquo; numbers, and the client never learns whose unit
        it is. Keep that true of anything added here.
      </p>
    </div>
  )
}
