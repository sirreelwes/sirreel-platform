'use client'

/**
 * /vermar/workspaces — VerMar Design's list of the partners' HQs: who's
 * on trial, who's paying, who's cut off; the link each one holds; and
 * the flips. Every reader here is a VerMar operator (the (vermar) layout
 * and every /api/vermar route enforce the allowlist), so nothing on the
 * page is read-only by role.
 *
 * Nothing here locks a partner out by accident: CANCELLED and PAST_DUE
 * close the door (the workspace shows a "closed" screen), so both ask
 * for a confirm. Rotating the link kills the one the partner has
 * bookmarked, so that asks too.
 */

import { useCallback, useEffect, useState } from 'react'
import { Copy, ExternalLink, RefreshCw } from 'lucide-react'

type Status = 'INTERESTED' | 'TRIAL' | 'ACTIVE' | 'PAST_DUE' | 'CANCELLED'
type Plan = 'STARTER' | 'PRO'

interface Row {
  id: string
  vendorId: string
  vendorName: string
  vendorContact: string | null
  vendorEmail: string | null
  brandName: string
  slug: string
  status: Status
  plan: Plan
  trialEndsAt: string | null
  trialDaysLeft: number | null
  subscribedAt: string | null
  cancelledAt: string | null
  requestedByName: string | null
  requestedByEmail: string | null
  requestNote: string | null
  url: string | null
  accessTokenMintedAt: string | null
  lastOpenedAt: string | null
  openCount: number
  bookingCount: number
  clientCount: number
  createdAt: string
}
interface VendorWithout { id: string; name: string; contactName: string | null; email: string | null; unitCount: number }
interface Lead { id: string; name: string; company: string; email: string; phone: string | null; fleetSize: string | null; fleetKind: string | null; note: string | null; contactedAt: string | null; contactedBy: string | null; createdAt: string }
interface Payload { workspaces: Row[]; vendorsWithout: VendorWithout[]; leads: Lead[]; operator: string }

const STATUS_LABEL: Record<Status, string> = { INTERESTED: 'Interested', TRIAL: 'Trial', ACTIVE: 'Active', PAST_DUE: 'Past due', CANCELLED: 'Cancelled' }
const STATUS_CHIP: Record<Status, string> = {
  INTERESTED: 'bg-chip-neutral-bg text-chip-neutral-fg',
  TRIAL: 'bg-chip-warn-bg text-chip-warn-fg',
  ACTIVE: 'bg-chip-good-bg text-chip-good-fg',
  PAST_DUE: 'bg-chip-bad-bg text-chip-bad-fg',
  CANCELLED: 'bg-chip-neutral-bg text-chip-neutral-fg',
}
const CLOSES: Status[] = ['PAST_DUE', 'CANCELLED']

const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—')
const ymd = (iso: string | null) => (iso ? new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso)) : '')

const SELECT = 'rounded-md border border-lt-hairline bg-lt-card px-2 py-1.5 text-sm text-lt-fg disabled:opacity-50'
const BTN = 'inline-flex items-center gap-1.5 rounded-md border border-lt-hairline bg-lt-card px-2.5 py-1.5 text-xs font-semibold text-lt-fg hover:bg-lt-inner disabled:opacity-50 disabled:cursor-not-allowed'
const BTN_PRIMARY = 'inline-flex items-center gap-1.5 rounded-md bg-amber-600 hover:bg-amber-500 px-2.5 py-1.5 text-xs font-semibold text-white disabled:opacity-50 disabled:cursor-not-allowed'

async function call(url: string, method: 'PATCH' | 'POST', body?: unknown): Promise<{ ok: boolean; error?: string; url?: string }> {
  const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
  const j = (await r.json().catch(() => ({}))) as { error?: string; url?: string }
  return r.ok ? { ok: true, url: j.url } : { ok: false, error: j.error || `HTTP ${r.status}` }
}

function WorkspaceCard({ w, busy, onPatch, onRotate, toast }: {
  w: Row
  busy: boolean
  onPatch: (id: string, patch: { status?: Status; plan?: Plan; trialEndsAt?: string | null }) => Promise<void>
  onRotate: (id: string) => Promise<void>
  toast: (kind: 'ok' | 'err', msg: string) => void
}) {
  const [trialEnd, setTrialEnd] = useState(ymd(w.trialEndsAt))
  useEffect(() => setTrialEnd(ymd(w.trialEndsAt)), [w.trialEndsAt])

  const changeStatus = async (next: Status) => {
    if (next === w.status) return
    if (CLOSES.includes(next) && !window.confirm(`Set ${w.vendorName}'s Utliiz workspace to ${STATUS_LABEL[next]}? Their workspace shows a "closed" screen until it's reopened. Nothing is deleted.`)) return
    await onPatch(w.id, { status: next })
  }
  const copy = async () => {
    if (!w.url) return
    try {
      await navigator.clipboard.writeText(w.url)
      toast('ok', 'Link copied.')
    } catch {
      toast('err', 'Couldn’t copy — select it from the field.')
    }
  }

  return (
    <div className="bg-lt-card border border-lt-hairline rounded-xl p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-base font-semibold text-lt-fg">
            {w.vendorName}
            {w.brandName !== w.vendorName && <span className="ml-2 text-sm font-normal text-lt-fg2">shown as “{w.brandName}”</span>}
          </div>
          <div className="text-xs text-lt-fg2 mt-0.5">
            {w.vendorContact || 'no contact'}{w.vendorEmail ? ` · ${w.vendorEmail}` : ''} · {w.bookingCount} own booking{w.bookingCount === 1 ? '' : 's'} · {w.clientCount} client{w.clientCount === 1 ? '' : 's'}
          </div>
          <div className="text-xs text-lt-fg2 mt-0.5">
            Started {fmt(w.createdAt)}{w.requestedByName ? ` by ${w.requestedByName}` : ''}{w.requestedByEmail ? ` (${w.requestedByEmail})` : ''}
            {w.lastOpenedAt ? ` · opened ${w.openCount}×, last ${fmt(w.lastOpenedAt)}` : ' · never opened'}
          </div>
          {w.requestNote && <div className="text-xs text-lt-fg2 mt-1 italic">“{w.requestNote}”</div>}
        </div>
        <span className={`text-[11px] font-semibold px-2 py-1 rounded ${STATUS_CHIP[w.status]}`}>
          {STATUS_LABEL[w.status]}
          {w.status === 'TRIAL' && w.trialDaysLeft != null && (w.trialDaysLeft >= 0 ? ` · ${w.trialDaysLeft}d left` : ' · expired')}
          {w.status === 'ACTIVE' && ` · ${w.plan === 'PRO' ? 'Pro' : 'Starter'}`}
        </span>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-[auto_auto_1fr] sm:items-end">
        <label className="text-xs text-lt-fg2">
          <span className="block font-semibold mb-1">Status</span>
          <select className={SELECT} value={w.status} disabled={busy} onChange={(e) => changeStatus(e.target.value as Status)}>
            {(Object.keys(STATUS_LABEL) as Status[]).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
          </select>
        </label>
        <label className="text-xs text-lt-fg2">
          <span className="block font-semibold mb-1">Plan</span>
          <select className={SELECT} value={w.plan} disabled={busy} onChange={(e) => onPatch(w.id, { plan: e.target.value as Plan })}>
            <option value="STARTER">Starter</option>
            <option value="PRO">Pro</option>
          </select>
        </label>
        <label className="text-xs text-lt-fg2">
          <span className="block font-semibold mb-1">Trial ends {w.subscribedAt ? `· subscribed ${fmt(w.subscribedAt)}` : ''}{w.cancelledAt ? `· cancelled ${fmt(w.cancelledAt)}` : ''}</span>
          <span className="flex items-center gap-2">
            <input type="date" className={SELECT} value={trialEnd} disabled={busy} onChange={(e) => setTrialEnd(e.target.value)} />
            <button type="button" className={BTN} disabled={busy || trialEnd === ymd(w.trialEndsAt)} onClick={() => onPatch(w.id, { trialEndsAt: trialEnd || null })}>Save date</button>
          </span>
        </label>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <input readOnly value={w.url ?? 'no link minted'} className="flex-1 min-w-[240px] rounded-md border border-lt-hairline bg-lt-inner px-2 py-1.5 text-xs text-lt-fg font-mono" onFocus={(e) => e.currentTarget.select()} />
        <button type="button" className={BTN} disabled={!w.url} onClick={copy}><Copy className="w-3.5 h-3.5" />Copy</button>
        {w.url && (
          <a href={w.url} target="_blank" rel="noreferrer" className={BTN} title="Opens their workspace with a VerMar support ribbon; not counted as their open."><ExternalLink className="w-3.5 h-3.5" />Open</a>
        )}
        <button
          type="button"
          className={BTN}
          disabled={busy}
          onClick={() => {
            if (window.confirm(`Issue ${w.vendorName} a new link? The one they have bookmarked stops working immediately — you'll need to send them the new one.`)) void onRotate(w.id)
          }}
        >
          <RefreshCw className="w-3.5 h-3.5" />Rotate link
        </button>
        <span className="text-[11px] text-lt-fg3">link minted {fmt(w.accessTokenMintedAt)}</span>
      </div>
    </div>
  )
}

export default function AdminHqWorkspacesPage() {
  const [data, setData] = useState<Payload | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [toast, setToast] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null)

  const say = useCallback((kind: 'ok' | 'err', msg: string) => {
    setToast({ kind, msg })
    window.setTimeout(() => setToast(null), 4000)
  }, [])

  const load = useCallback(async () => {
    setError(null)
    const r = await fetch('/api/vermar/workspaces', { cache: 'no-store' })
    const j = (await r.json().catch(() => ({}))) as Payload & { error?: string }
    if (!r.ok) return setError(j.error || `HTTP ${r.status}`)
    setData(j)
  }, [])
  useEffect(() => { void load() }, [load])

  const patch = async (id: string, body: { status?: Status; plan?: Plan; trialEndsAt?: string | null }) => {
    setBusy(id)
    const r = await call(`/api/vermar/workspaces/${id}`, 'PATCH', body)
    setBusy(null)
    if (!r.ok) return say('err', r.error!)
    say('ok', 'Saved.')
    await load()
  }
  const rotate = async (id: string) => {
    setBusy(id)
    const r = await call(`/api/vermar/workspaces/${id}/rotate`, 'POST')
    setBusy(null)
    if (!r.ok) return say('err', r.error!)
    say('ok', 'New link issued — the old one is dead. Copy it from the field and send it to them.')
    await load()
  }
  const contacted = async (l: Lead, value: boolean) => {
    setBusy(l.id)
    const r = await call(`/api/vermar/leads/${l.id}`, 'PATCH', { contacted: value })
    setBusy(null)
    if (!r.ok) return say('err', r.error!)
    await load()
  }
  const provision = async (v: VendorWithout) => {
    if (!window.confirm(`Start a 30-day Utliiz trial for ${v.name}? ${v.email ? `Their contact (${v.email}) is emailed the link.` : 'They have no email on file, so nobody is emailed — copy the link from the card and send it yourself.'}`)) return
    setBusy(v.id)
    const r = await call('/api/vermar/workspaces/provision', 'POST', { vendorId: v.id })
    setBusy(null)
    if (!r.ok) return say('err', r.error!)
    say('ok', `Workspace started for ${v.name}.`)
    await load()
  }

  return (
    <div>
      <div className="mb-5">
        <h1 className="text-2xl font-semibold text-lt-fg">Workspaces</h1>
        <p className="text-sm text-lt-fg2 mt-1 max-w-[72ch]">
          Every partner running their fleet on Utliiz. Who&apos;s on trial, who&apos;s paying, who&apos;s closed, and the link each one logs in
          with. Status, plan, trial date and link rotation are yours to change here; the partner sees the result immediately.
        </p>
      </div>

      {toast && (
        <div className={`mb-4 rounded-lg px-4 py-2.5 text-sm ${toast.kind === 'ok' ? 'bg-chip-good-bg text-chip-good-fg' : 'bg-chip-bad-bg text-chip-bad-fg'}`}>{toast.msg}</div>
      )}
      {error && <div className="mb-4 rounded-lg bg-chip-bad-bg text-chip-bad-fg text-sm px-4 py-2.5">{error}</div>}
      {!data && !error && <div className="text-sm text-lt-fg2">Loading…</div>}

      {data && (
        <>
          {data.leads.length > 0 && (
            <>
              <h2 className="text-[11px] uppercase font-semibold tracking-[1.6px] text-lt-fg3 mb-3">Requests from utliiz.com · {data.leads.filter((l) => !l.contactedAt).length} open</h2>
              <div className="bg-lt-card border border-lt-hairline rounded-xl divide-y divide-lt-hairline mb-8">
                {data.leads.map((l) => (
                  <div key={l.id} className={`px-4 py-3 flex flex-wrap items-start gap-3 ${l.contactedAt ? 'opacity-60' : ''}`}>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium text-lt-fg">{l.company} <span className="font-normal text-lt-fg2">· {l.name}</span></div>
                      <div className="text-xs text-lt-fg2">
                        <a href={`mailto:${l.email}`} className="underline">{l.email}</a>{l.phone ? ` · ${l.phone}` : ''}{l.fleetSize ? ` · ${l.fleetSize} units` : ''}{l.fleetKind ? ` · ${l.fleetKind}` : ''} · {fmt(l.createdAt)}
                      </div>
                      {l.note && <div className="text-xs text-lt-fg2 mt-1 italic">“{l.note}”</div>}
                      {l.contactedAt && <div className="text-[11px] text-lt-fg3 mt-1">Contacted {fmt(l.contactedAt)}{l.contactedBy ? ` by ${l.contactedBy}` : ''}</div>}
                    </div>
                    <button type="button" className={BTN} disabled={busy === l.id} onClick={() => contacted(l, !l.contactedAt)}>
                      {l.contactedAt ? 'Reopen' : 'Mark contacted'}
                    </button>
                  </div>
                ))}
              </div>
            </>
          )}
          <h2 className="text-[11px] uppercase font-semibold tracking-[1.6px] text-lt-fg3 mb-3">Workspaces · {data.workspaces.length}</h2>
          {data.workspaces.length === 0 ? (
            <div className="bg-lt-card border border-lt-hairline rounded-xl px-5 py-8 text-center text-sm text-lt-fg2">No partner has started one yet.</div>
          ) : (
            <div className="space-y-3">
              {data.workspaces.map((w) => (
                <WorkspaceCard key={w.id} w={w} busy={busy === w.id} onPatch={patch} onRotate={rotate} toast={say} />
              ))}
            </div>
          )}

          <h2 className="text-[11px] uppercase font-semibold tracking-[1.6px] text-lt-fg3 mt-8 mb-3">Partners without one · {data.vendorsWithout.length}</h2>
          <p className="text-sm text-lt-fg2 mb-3 max-w-[72ch]">
            SirReel partners with units on the roster and no workspace yet. Starting one from here does exactly what the partner pressing
            &ldquo;See what Utliiz can do for you&rdquo; does — including emailing their contact the link.
          </p>
          {data.vendorsWithout.length === 0 ? (
            <div className="text-sm text-lt-fg2">Everyone with units has one.</div>
          ) : (
            <div className="bg-lt-card border border-lt-hairline rounded-xl divide-y divide-lt-hairline">
              {data.vendorsWithout.map((v) => (
                <div key={v.id} className="px-4 py-3 flex flex-wrap items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-lt-fg">{v.name}</div>
                    <div className="text-xs text-lt-fg2">{v.unitCount} unit{v.unitCount === 1 ? '' : 's'}{v.contactName ? ` · ${v.contactName}` : ''}{v.email ? ` · ${v.email}` : ' · no email on file'}</div>
                  </div>
                  <button type="button" className={BTN_PRIMARY} disabled={busy === v.id} onClick={() => provision(v)}>
                    Start a trial{v.email ? ' (emails them)' : ''}
                  </button>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
