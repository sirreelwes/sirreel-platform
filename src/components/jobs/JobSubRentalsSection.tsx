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
  /** The CLIENT has said yes — the linked order (or, for a job-level row,
   *  any order on the job) is APPROVED or beyond. Computed server-side. */
  clientCommitted: boolean
  vendor: { id: string; name: string; email: string | null; poEmail: string | null; phone: string | null }
  order: { id: string; orderNumber: string; status?: string } | null
  orderLineItem: { id: string; description: string } | null
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

const money = (n: number | null) =>
  n === null ? '—' : `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

/**
 * The partner was never actually asked. True only once the client has
 * committed — an ESTIMATED row on an un-approved order is correctly
 * un-asked, not broken.
 *
 * Two ways to get here:
 *   · the row is REQUESTED (or later) but the notice never left — the
 *     approval hook's durable-flip / best-effort-mail posture;
 *   · the row is still ESTIMATED while the ORDER is approved or booked —
 *     the client said yes through HQ and, before 2026-09-05, nothing on
 *     that path asked the partner. The row's own status can't see this;
 *     only the order can, which is why `clientCommitted` rides along.
 */
export function isUnaskedHold(s: JobSubRental): boolean {
  if (s.vendorHoldRequestedAt) return false
  if (COMMITTED.includes(s.status)) return true
  return s.status === 'ESTIMATED' && s.clientCommitted
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

  const copy = useCallback(async (s: JobSubRental) => {
    if (!s.vendorUrl) return
    try {
      await navigator.clipboard.writeText(s.vendorUrl)
      setCopiedId(s.id)
      setTimeout(() => setCopiedId((c) => (c === s.id ? null : c)), 2000)
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
                    {!(s.vendor.poEmail || s.vendor.email)
                      ? `${s.vendor.name} has no email on file — add one on the vendor record, or call ${s.vendor.phone || 'them'}.`
                      : s.status === 'ESTIMATED'
                        ? 'The client is committed, but the partner only ever got the estimate notice — which says this is not a booking.'
                        : 'The notice never sent.'}
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
                      onClick={() => copy(s)}
                      className="text-[12px] px-2.5 py-1 rounded-lg border border-zinc-300 text-zinc-700 hover:border-zinc-400 hover:text-zinc-900"
                    >
                      {copiedId === s.id ? 'Copied' : 'Copy partner link'}
                    </button>
                    <a
                      href={s.vendorUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-[12px] px-2.5 py-1 rounded-lg border border-zinc-300 text-zinc-700 hover:border-zinc-400 hover:text-zinc-900"
                    >
                      Open their page ↗
                    </a>
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
        Partners see their own page only — the unit, the dates, the status and our job code. They
        never learn the production, the company or the contacts, and the client never learns whose
        unit it is. Keep that true of anything added here.
      </p>
    </div>
  )
}
