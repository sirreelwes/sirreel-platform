'use client'

/**
 * One show on the Jobs pane of Portals: who has its paperwork portal, what
 * they can see there, and the two controls that matter — revoke, resend.
 *
 * "What they see" is not a toggle panel here: visibility in the job portal
 * is driven by what the desk has RELEASED (quote sent, agreement released,
 * invoice sent for review), and those releases live on the order. The
 * chips tell the truth about the current state and the link goes to where
 * it changes. Who sees it IS controlled here.
 */

import { useState } from 'react'
import Link from 'next/link'
import { Loader2, RefreshCw, Trash2 } from 'lucide-react'

export interface JobPortalPerson {
  accessId: string
  contactId: string
  name: string
  email: string
  sentAt: string
  lastAccessedAt: string | null
  accessCount: number
  expired: boolean
}

export interface JobPortalOrder {
  orderId: string
  orderNumber: string
  quoteSent: boolean
  agreement: 'none' | 'released' | 'signed' | 'covered'
  invoicesVisible: number
  people: JobPortalPerson[]
}

export interface JobPortalJobProps {
  jobId: string
  jobCode: string
  jobName: string
  companyName: string | null
  orders: JobPortalOrder[]
  canEdit: boolean
}

function fmt(d: string | null): string {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

const AGREEMENT_CHIP: Record<JobPortalOrder['agreement'], { label: string; cls: string }> = {
  none: { label: 'agreement not released', cls: 'bg-chip-neutral-bg text-chip-neutral-fg' },
  released: { label: 'agreement to sign', cls: 'bg-chip-warn-bg text-chip-warn-fg' },
  signed: { label: 'agreement signed', cls: 'bg-chip-good-bg text-chip-good-fg' },
  covered: { label: 'covered by annual', cls: 'bg-chip-good-bg text-chip-good-fg' },
}

export function JobPortalRow(props: JobPortalJobProps) {
  const [busy, setBusy] = useState<string | null>(null)
  const [gone, setGone] = useState<Set<string>>(new Set())
  const [notice, setNotice] = useState<string | null>(null)

  async function revoke(orderId: string, accessId: string) {
    if (!confirm('Revoke this person’s link to the job portal?')) return
    setBusy(accessId)
    try {
      const res = await fetch(`/api/orders/${orderId}/portal-access`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ portalAccessId: accessId }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || 'Revoke failed')
      setGone((g) => new Set(g).add(accessId))
      setNotice('Revoked.')
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'Revoke failed')
    } finally {
      setBusy(null)
    }
  }

  async function resend(orderId: string, contactId: string, accessId: string) {
    setBusy(accessId)
    try {
      const res = await fetch(`/api/orders/${orderId}/portal-access`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contactId, regenerate: true }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || 'Resend failed')
      setNotice('New link issued and sent.')
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'Resend failed')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="bg-lt-card border border-lt-hairline rounded-xl p-4">
      <div className="flex flex-col sm:flex-row sm:items-baseline sm:justify-between gap-1">
        <div className="min-w-0">
          <Link href={`/jobs/${props.jobId}`} className="text-[15px] font-semibold text-lt-fg hover:underline">
            {props.jobName}
          </Link>
          <span className="ml-2 text-xs font-mono text-lt-fg3">{props.jobCode}</span>
          {props.companyName && <div className="text-xs text-lt-fg2">{props.companyName}</div>}
        </div>
        {notice && <div className="text-xs text-lt-fg2">{notice}</div>}
      </div>

      <div className="mt-3 space-y-3">
        {props.orders.map((o) => (
          <div key={o.orderId} className="border border-lt-hairline rounded-lg p-3">
            <div className="flex flex-wrap items-center gap-2">
              <Link href={`/orders/${o.orderId}`} className="text-xs font-mono text-lt-fg hover:underline">{o.orderNumber}</Link>
              <span className="text-[11px] text-lt-fg3">they can see:</span>
              <span className={`text-[11px] font-semibold px-2 py-0.5 rounded ${o.quoteSent ? 'bg-chip-good-bg text-chip-good-fg' : 'bg-chip-neutral-bg text-chip-neutral-fg'}`}>
                {o.quoteSent ? 'quote' : 'no quote yet'}
              </span>
              <span className={`text-[11px] font-semibold px-2 py-0.5 rounded ${AGREEMENT_CHIP[o.agreement].cls}`}>
                {AGREEMENT_CHIP[o.agreement].label}
              </span>
              <span className={`text-[11px] font-semibold px-2 py-0.5 rounded ${o.invoicesVisible > 0 ? 'bg-chip-good-bg text-chip-good-fg' : 'bg-chip-neutral-bg text-chip-neutral-fg'}`}>
                {o.invoicesVisible > 0 ? `${o.invoicesVisible} invoice${o.invoicesVisible === 1 ? '' : 's'}` : 'no invoices yet'}
              </span>
              <Link href={`/orders/${o.orderId}`} className="ml-auto text-[11px] text-lt-fg2 hover:text-lt-fg underline">
                change on the order
              </Link>
            </div>

            <div className="mt-2 divide-y divide-lt-hairline">
              {o.people.filter((p) => !gone.has(p.accessId)).length === 0 && (
                <div className="text-xs text-lt-fg3 py-1">Nobody has a link to this order&apos;s portal.</div>
              )}
              {o.people.filter((p) => !gone.has(p.accessId)).map((p) => (
                <div key={p.accessId} className="py-2 flex flex-col sm:flex-row sm:items-center gap-1.5 sm:gap-3">
                  <div className="min-w-0 flex-1">
                    <span className="text-sm text-lt-fg">{p.name}</span>
                    <span className="ml-2 text-xs text-lt-fg2">{p.email}</span>
                  </div>
                  <div className="flex items-center gap-2 text-[11px] font-semibold">
                    <span className="px-2 py-0.5 rounded bg-chip-neutral-bg text-chip-neutral-fg">sent {fmt(p.sentAt)}</span>
                    <span className={`px-2 py-0.5 rounded ${p.lastAccessedAt ? 'bg-chip-good-bg text-chip-good-fg' : 'bg-chip-warn-bg text-chip-warn-fg'}`}>
                      {p.lastAccessedAt ? `opened ${fmt(p.lastAccessedAt)} (${p.accessCount}×)` : 'never opened'}
                    </span>
                    {p.expired && <span className="px-2 py-0.5 rounded bg-chip-neutral-bg text-chip-neutral-fg">link expired</span>}
                    {props.canEdit && (
                      <>
                        <button
                          onClick={() => resend(o.orderId, p.contactId, p.accessId)}
                          disabled={busy === p.accessId}
                          className="inline-flex items-center gap-1 border border-lt-hairline rounded-md px-2 py-1 text-lt-fg hover:text-black"
                          title="Issue a fresh link and email it"
                        >
                          {busy === p.accessId ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />} Resend
                        </button>
                        <button
                          onClick={() => revoke(o.orderId, p.accessId)}
                          disabled={busy === p.accessId}
                          className="text-lt-fg3 hover:text-chip-bad-fg"
                          title="Revoke"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
