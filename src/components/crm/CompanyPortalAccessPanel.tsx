'use client'

/**
 * Who at this client can open the account portal — plus their logo.
 *
 * Wes 2026-09-04: "I would like to have the ability to add multiple emails
 * (titles optional) who can view company portal" and "let's add a logo
 * upload for each company too so it looks good on their side."
 *
 * The add form takes ROWS, because that is how the information arrives: a
 * rep gets four names in one email from the client and adds four people in
 * one pass. Titles are optional on every row, per the ask — a title
 * improves the greeting and nothing else, so requiring it would block a
 * grant for no benefit.
 *
 * "Granted" and "told" are separate states and the panel shows both.
 * Granting quietly (before a deal closes) is legitimate; a row with no
 * invite sent says so plainly, so nobody assumes the client knows.
 */

import { useCallback, useEffect, useState } from 'react'
import { Check, FileSignature, ImageIcon, Loader2, Mail, Plus, Trash2, Upload, X } from 'lucide-react'

const ROLES: { value: string; label: string }[] = [
  { value: 'EXECUTIVE', label: 'Executive' },
  { value: 'HEAD_OF_PRODUCTION', label: 'Head of Production' },
  { value: 'FINANCE', label: 'Finance' },
  { value: 'OTHER', label: 'Other' },
]

interface AccessRow {
  id: string
  role: string
  title: string | null
  grantedAt: string
  revokedAt: string | null
  invitedAt: string | null
  lastAccessedAt: string | null
  accessCount: number
  person: { id: string; firstName: string; lastName: string; email: string }
}

interface DraftRow {
  email: string
  name: string
  title: string
  role: string
}

function emptyRow(): DraftRow {
  return { email: '', name: '', title: '', role: 'EXECUTIVE' }
}

function fmt(d: string | null): string {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export function CompanyPortalAccessPanel({
  companyId,
  companyName,
  hasLogo,
  canEdit,
}: {
  companyId: string
  companyName: string
  hasLogo: boolean
  canEdit: boolean
}) {
  const [rows, setRows] = useState<AccessRow[] | null>(null)
  const [drafts, setDrafts] = useState<DraftRow[]>([emptyRow()])
  const [adding, setAdding] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  // Logo state. `logoVersion` busts the <img> cache after an upload —
  // the URL is stable, so without it the browser shows the old mark.
  const [logoPresent, setLogoPresent] = useState(hasLogo)
  const [logoVersion, setLogoVersion] = useState(0)
  const [logoBusy, setLogoBusy] = useState(false)
  const [logoError, setLogoError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const res = await fetch(`/api/crm/companies/${companyId}/portal-access`)
    const json = await res.json().catch(() => ({}))
    setRows(json.access || [])
  }, [companyId])

  useEffect(() => {
    load()
  }, [load])

  async function submit() {
    const grants = drafts
      .map((d) => ({
        email: d.email.trim(),
        name: d.name.trim() || null,
        title: d.title.trim() || null,
        role: d.role,
      }))
      .filter((d) => d.email)
    if (grants.length === 0) return

    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const res = await fetch(`/api/crm/companies/${companyId}/portal-access`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ grants }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json?.error || 'Could not grant access')
      const bits: string[] = []
      if (json.granted) bits.push(`${json.granted} granted`)
      if (json.restored) bits.push(`${json.restored} restored`)
      if (json.alreadyHad) bits.push(`${json.alreadyHad} already had access`)
      setNotice(bits.join(' · ') || 'Done.')
      setDrafts([emptyRow()])
      setAdding(false)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not grant access')
    } finally {
      setBusy(false)
    }
  }

  async function sendInvite(accessId: string) {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const res = await fetch(`/api/crm/companies/${companyId}/portal-access/${accessId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sendInvite: true }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json?.error || 'Send failed')
      setNotice('Invite sent.')
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Send failed')
    } finally {
      setBusy(false)
    }
  }

  async function offerAnnual() {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const res = await fetch(`/api/crm/companies/${companyId}/agreements/offer-annual`, { method: 'POST' })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json?.error || 'Could not file the annual')
      setNotice(`Annual agreement offered in their portal: ${json.pending?.title ?? ''}. Auto-cover turns on when they sign; each job still logs a one-page addendum under it.`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not file the annual')
    } finally {
      setBusy(false)
    }
  }

  async function revoke(accessId: string) {
    setBusy(true)
    await fetch(`/api/crm/companies/${companyId}/portal-access/${accessId}`, { method: 'DELETE' })
    await load()
    setBusy(false)
  }

  async function uploadLogo(file: File) {
    setLogoBusy(true)
    setLogoError(null)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch(`/api/crm/companies/${companyId}/logo`, { method: 'POST', body: fd })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json?.error || 'Upload failed')
      setLogoPresent(true)
      setLogoVersion((v) => v + 1)
    } catch (e) {
      setLogoError(e instanceof Error ? e.message : 'Upload failed')
    } finally {
      setLogoBusy(false)
    }
  }

  async function removeLogo() {
    setLogoBusy(true)
    await fetch(`/api/crm/companies/${companyId}/logo`, { method: 'DELETE' })
    setLogoPresent(false)
    setLogoBusy(false)
  }

  const live = (rows || []).filter((r) => !r.revokedAt)
  const revoked = (rows || []).filter((r) => r.revokedAt)

  return (
    <div className="bg-lt-card border border-lt-hairline rounded-xl p-5">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-lt-fg">Account portal access</h2>
          <p className="text-xs text-lt-fg2 mt-0.5 max-w-[62ch] leading-relaxed">
            Executives and heads of production who can see the whole {companyName} account — every
            show, the invoices, the agreements and the standing discounts. They sign in with their
            own email; this only decides what they may see.
          </p>
        </div>
        {canEdit && !adding && (
          <div className="shrink-0 flex flex-wrap items-center gap-x-3 gap-y-1">
            {/* Wes 2026-09-04: "Make their default Annual Rental Agreement" —
                files the annual UNSIGNED, offered in their portal; auto-cover
                turns on only when an executive signs it there. */}
            <button
              onClick={offerAnnual}
              disabled={busy}
              className="inline-flex items-center gap-1 text-xs font-semibold text-lt-fg hover:text-black"
              title="File the annual rental agreement for signature in their portal"
            >
              <FileSignature className="w-3.5 h-3.5" /> Offer annual agreement
            </button>
            <button
              onClick={() => setAdding(true)}
              className="inline-flex items-center gap-1 text-xs font-semibold text-lt-fg hover:text-black"
            >
              <Plus className="w-3.5 h-3.5" /> Add people
            </button>
          </div>
        )}
      </div>

      {/* ── Logo ──────────────────────────────────────────────────────── */}
      <div className="mt-4 flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4 border border-lt-hairline rounded-lg p-3">
        <div className="w-24 h-14 bg-white border border-lt-hairline rounded flex items-center justify-center shrink-0 overflow-hidden">
          {logoPresent ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={`/api/crm/companies/${companyId}/logo?v=${logoVersion}`}
              alt=""
              className="max-h-12 max-w-[88px] object-contain"
            />
          ) : (
            <ImageIcon className="w-5 h-5 text-lt-fg3" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-lt-fg">Their logo</div>
          <p className="text-xs text-lt-fg2 mt-0.5">
            Sits in the masthead of their portal beside ours, on a white band. PNG, JPG, WEBP or
            SVG, up to 5&nbsp;MB — a vector is best; it's stored inline and stays crisp.
          </p>
          {logoError && <p className="text-xs text-chip-bad-fg mt-1">{logoError}</p>}
        </div>
        {canEdit && (
          <div className="flex items-center gap-2 sm:shrink-0">
            <label className="inline-flex items-center gap-1.5 text-xs font-semibold text-lt-fg hover:text-black cursor-pointer border border-lt-hairline rounded-lg px-2.5 py-1.5">
              {logoBusy ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Upload className="w-3.5 h-3.5" />
              )}
              {logoPresent ? 'Replace' : 'Upload'}
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp,image/svg+xml"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) uploadLogo(f)
                  e.target.value = ''
                }}
              />
            </label>
            {logoPresent && (
              <button
                onClick={removeLogo}
                disabled={logoBusy}
                className="text-lt-fg3 hover:text-chip-bad-fg"
                title="Remove logo"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            )}
          </div>
        )}
      </div>

      {notice && <p className="text-xs text-chip-good-fg mt-3">{notice}</p>}
      {error && <p className="text-xs text-chip-bad-fg mt-3">{error}</p>}

      {/* ── Add rows ──────────────────────────────────────────────────── */}
      {adding && (
        <div className="mt-4 border-t border-lt-hairline pt-4">
          <div className="flex items-center justify-between mb-2">
            <div className="text-xs font-semibold uppercase tracking-wider text-lt-fg3">
              Add people — title optional
            </div>
            <button
              onClick={() => {
                setDrafts([emptyRow()])
                setAdding(false)
              }}
              className="text-lt-fg3 hover:text-lt-fg"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="space-y-2">
            {drafts.map((d, i) => (
              <div key={i} className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-center">
                <input
                  value={d.email}
                  onChange={(e) =>
                    setDrafts((prev) =>
                      prev.map((r, j) => (j === i ? { ...r, email: e.target.value } : r)),
                    )
                  }
                  placeholder="email@production.com"
                  className="sm:col-span-4 text-sm border border-lt-hairline rounded-lg px-2.5 py-2 bg-lt-card text-lt-fg"
                />
                <input
                  value={d.name}
                  onChange={(e) =>
                    setDrafts((prev) =>
                      prev.map((r, j) => (j === i ? { ...r, name: e.target.value } : r)),
                    )
                  }
                  placeholder="Name (optional)"
                  className="sm:col-span-3 text-sm border border-lt-hairline rounded-lg px-2.5 py-2 bg-lt-card text-lt-fg"
                />
                <input
                  value={d.title}
                  onChange={(e) =>
                    setDrafts((prev) =>
                      prev.map((r, j) => (j === i ? { ...r, title: e.target.value } : r)),
                    )
                  }
                  placeholder="Title (optional)"
                  className="sm:col-span-3 text-sm border border-lt-hairline rounded-lg px-2.5 py-2 bg-lt-card text-lt-fg"
                />
                <select
                  value={d.role}
                  onChange={(e) =>
                    setDrafts((prev) =>
                      prev.map((r, j) => (j === i ? { ...r, role: e.target.value } : r)),
                    )
                  }
                  className="sm:col-span-2 text-sm border border-lt-hairline rounded-lg px-2 py-2 bg-lt-card text-lt-fg"
                >
                  {ROLES.map((r) => (
                    <option key={r.value} value={r.value}>
                      {r.label}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>

          <div className="flex items-center gap-3 mt-3">
            <button
              onClick={() => setDrafts((prev) => [...prev, emptyRow()])}
              className="inline-flex items-center gap-1 text-xs font-semibold text-lt-fg hover:text-black"
            >
              <Plus className="w-3.5 h-3.5" /> Another
            </button>
            <button
              onClick={submit}
              disabled={busy || drafts.every((d) => !d.email.trim())}
              className="inline-flex items-center gap-1.5 text-sm font-semibold px-3.5 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 text-white disabled:opacity-40"
            >
              {busy && <Loader2 className="w-4 h-4 animate-spin" />}
              Grant access
            </button>
            <span className="text-xs text-lt-fg3">
              Nobody is emailed until you send the invite below.
            </span>
          </div>
        </div>
      )}

      {/* ── Who has it ────────────────────────────────────────────────── */}
      {rows === null ? (
        <div className="flex items-center gap-2 text-sm text-lt-fg3 mt-4">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading…
        </div>
      ) : live.length === 0 ? (
        <p className="text-sm text-lt-fg3 mt-4">
          Nobody has account-level access yet. Their coordinators still get the per-job portal as
          usual — this is the extra view for the people above them.
        </p>
      ) : (
        <div className="mt-4 space-y-2">
          {live.map((r) => (
            <div
              key={r.id}
              className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-3 border border-lt-hairline rounded-lg p-3"
            >
              <div className="min-w-0">
                <div className="text-sm font-medium text-lt-fg truncate">
                  {r.person.firstName} {r.person.lastName}
                  <span className="ml-2 text-xs text-lt-fg3">
                    {ROLES.find((x) => x.value === r.role)?.label || r.role}
                    {r.title ? ` · ${r.title}` : ''}
                  </span>
                </div>
                <div className="text-xs text-lt-fg2 mt-0.5 truncate">{r.person.email}</div>
                <div className="text-xs text-lt-fg3 mt-0.5">
                  {r.invitedAt ? `Invited ${fmt(r.invitedAt)}` : 'Not invited yet'}
                  {' · '}
                  {r.lastAccessedAt
                    ? `last opened ${fmt(r.lastAccessedAt)} (${r.accessCount}×)`
                    : 'never opened'}
                </div>
              </div>
              {canEdit && (
                <div className="flex items-center gap-2 sm:shrink-0">
                  <button
                    onClick={() => sendInvite(r.id)}
                    disabled={busy}
                    className="inline-flex items-center gap-1 text-xs font-semibold border border-lt-hairline rounded-lg px-2.5 py-1.5 text-lt-fg hover:text-black"
                  >
                    {r.invitedAt ? <Check className="w-3.5 h-3.5" /> : <Mail className="w-3.5 h-3.5" />}
                    {r.invitedAt ? 'Re-send' : 'Send invite'}
                  </button>
                  <button
                    onClick={() => revoke(r.id)}
                    disabled={busy}
                    className="text-lt-fg3 hover:text-chip-bad-fg"
                    title="Revoke access"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {revoked.length > 0 && (
        <details className="mt-3">
          <summary className="text-xs text-lt-fg3 cursor-pointer hover:text-lt-fg">
            Revoked ({revoked.length})
          </summary>
          <div className="mt-2 space-y-1">
            {revoked.map((r) => (
              <div key={r.id} className="text-xs text-lt-fg3">
                {r.person.firstName} {r.person.lastName} · {r.person.email} · revoked{' '}
                {fmt(r.revokedAt)}
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  )
}
