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
import Link from 'next/link'
import { Check, Eye, FileSignature, Globe, ImageIcon, Loader2, Mail, Plus, Trash2, Upload, X } from 'lucide-react'
import { CompanyInviteReviewModal } from '@/components/crm/CompanyInviteReviewModal'

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
  /** Set when a colleague added them from inside the portal. */
  addedFromPortalBy?: string | null
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
  /** Access row whose invite is open in the review modal. */
  const [inviteFor, setInviteFor] = useState<string | null>(null)

  // Logo state. `logoVersion` busts the <img> cache after an upload —
  // the URL is stable, so without it the browser shows the old mark.
  const [logoPresent, setLogoPresent] = useState(hasLogo)
  const [logoVersion, setLogoVersion] = useState(0)
  const [logoBusy, setLogoBusy] = useState(false)
  const [logoError, setLogoError] = useState<string | null>(null)
  /** A logo found on their website, shown for a yes/no before it is saved
   *  (Wes 2026-09-14: "pull it from their website"). */
  const [webLogo, setWebLogo] = useState<{
    domain: string
    preview: string | null
    domains: Array<{ domain: string; count: number; matchesName: boolean }>
    error: string | null
  } | null>(null)

  /** The client's own ask for an annual, when one is open. Shown beside the
   *  button that answers it — an agent arriving from the action item should
   *  see who asked without opening another page. */
  const [annualRequest, setAnnualRequest] = useState<{
    requestedAt: string
    requestedByName: string | null
    source: string
  } | null>(null)

  /** An annual OFFERED and waiting for a signature. Kept because the panel
   *  above it is the only place that can hand the document to a person: the
   *  offer sits in the portal, and nobody sees a portal they were never
   *  invited to. */
  const [pendingAnnual, setPendingAnnual] = useState<{
    id: string
    title: string
    negotiatedKey?: string | null
  } | null>(null)

  const load = useCallback(async () => {
    const [accessRes, annualRes] = await Promise.all([
      fetch(`/api/crm/companies/${companyId}/portal-access`),
      fetch(`/api/crm/companies/${companyId}/agreements/offer-annual`),
    ])
    const json = await accessRes.json().catch(() => ({}))
    setRows(json.access || [])
    const annual = await annualRes.json().catch(() => ({}))
    setAnnualRequest(annual?.request ?? null)
    setPendingAnnual(annual?.pending ?? null)
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

  // The invite is reviewed before it goes (CompanyInviteReviewModal) —
  // Wes 2026-09-11: "preview and modify the invite email to Nancy and
  // people like her". The modal sends; this just opens it.
  function sendInvite(accessId: string) {
    setError(null)
    setNotice(null)
    setInviteFor(accessId)
  }

  async function offerAnnual() {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const res = await fetch(`/api/crm/companies/${companyId}/agreements/offer-annual`, { method: 'POST' })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json?.error || 'Could not file the annual')
      // Name the document, and say when it is THEIR negotiated one — the
      // offer renders whichever the registry holds for this company, and an
      // operator pressing one button should be told which went out.
      setNotice(
        json.pending?.negotiatedKey
          ? `Their negotiated agreement is offered in their portal: ${json.pending?.title ?? ''} — their counsel's terms, on our paper. Auto-cover turns on when they sign, and signing supersedes any unsigned master covering this account.`
          : `Annual agreement offered in their portal: ${json.pending?.title ?? ''}. Auto-cover turns on when they sign; each job still logs a one-page addendum under it.`,
      )
      // Filing it answers any open ask — the route closes the request, so
      // the panel stops advertising one.
      setAnnualRequest(null)
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

  async function findWebLogo(domain?: string, save = false) {
    setLogoBusy(true)
    setLogoError(null)
    try {
      const res = await fetch(`/api/crm/companies/${companyId}/logo/from-website`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain, save }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j.error || j.reason || `HTTP ${res.status}`)
      if (save && j.saved) {
        setWebLogo(null)
        setLogoPresent(true)
        setLogoVersion((v) => v + 1)
        return
      }
      setWebLogo({
        domain: j.domain ?? domain ?? '',
        preview: j.ok ? j.preview : null,
        domains: j.domains ?? [],
        error: j.ok ? null : j.error || 'Nothing usable on that site.',
      })
    } catch (e) {
      setLogoError(e instanceof Error ? e.message : 'Search failed')
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
          {pendingAnnual && (
            <div className="mt-2 border border-lt-hairline bg-chip-warn-bg rounded-lg p-3 max-w-[62ch]">
              <p className="text-xs font-semibold text-chip-warn-fg inline-flex items-center gap-1.5">
                <FileSignature className="w-3.5 h-3.5 shrink-0" />
                {pendingAnnual.title} is waiting for a signature
              </p>
              <p className="text-xs text-lt-fg2 mt-1 leading-relaxed">
                {pendingAnnual.negotiatedKey
                  ? 'Their counsel’s terms, on our paper. '
                  : ''}
                It sits in the account portal — and nobody sees a portal they were never invited
                to. Add the person who will sign it below, then <strong>Review &amp; send
                invite</strong>: the email names the document and carries the link straight to
                the signing page. An executive with access can sign; they also make the
                damage-waiver (LCDW) election for the account.
              </p>
            </div>
          )}
          {annualRequest && (
            <p className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold text-chip-warn-fg bg-chip-warn-bg border border-lt-hairline rounded px-2 py-1">
              <FileSignature className="w-3.5 h-3.5 shrink-0" />
              {annualRequest.requestedByName || 'The client'} asked for an annual agreement
              {' · '}
              {fmt(annualRequest.requestedAt)}
              {annualRequest.source === 'ACCOUNT_PORTAL' ? ' · account portal' : ' · job paperwork'}
            </p>
          )}
        </div>
        {canEdit && !adding && (
          <div className="shrink-0 flex flex-wrap items-center gap-x-3 gap-y-1">
            {/* Wes 2026-09-04: "Make their default Annual Rental Agreement" —
                files the annual UNSIGNED, offered in their portal; auto-cover
                turns on only when an executive signs it there. */}
            <button
              onClick={offerAnnual}
              disabled={busy}
              className={`inline-flex items-center gap-1 text-xs font-semibold hover:text-black ${
                annualRequest ? 'text-amber-700' : 'text-lt-fg'
              }`}
              title={
                annualRequest
                  ? 'The client asked for this — file the annual for signature in their portal'
                  : 'File the annual rental agreement for signature in their portal'
              }
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
            <button
              onClick={() => findWebLogo()}
              disabled={logoBusy}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-lt-fg hover:text-black border border-lt-hairline rounded-lg px-2.5 py-1.5 disabled:opacity-50"
              title="Look for their logo on the website their email addresses point to"
            >
              <Globe className="w-3.5 h-3.5" /> From website
            </button>
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

      {webLogo && (
        <div className="mt-2 border border-lt-hairline rounded-lg p-3 bg-lt-inner">
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <div className="w-40 h-16 bg-white border border-lt-hairline rounded flex items-center justify-center shrink-0 overflow-hidden px-2">
              {webLogo.preview ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={webLogo.preview} alt="" className="max-h-12 max-w-full object-contain" />
              ) : (
                <ImageIcon className="w-5 h-5 text-lt-fg3" />
              )}
            </div>
            <div className="min-w-0 flex-1 text-xs">
              <div className="text-lt-fg font-medium">
                {webLogo.preview ? `Found on ${webLogo.domain}` : webLogo.domain ? `Nothing usable on ${webLogo.domain}` : 'No website to look at'}
              </div>
              <p className="text-lt-fg2 mt-0.5">
                {webLogo.preview
                  ? 'This is how it sits on a white band. Only save it if it is clearly their mark.'
                  : webLogo.error}
              </p>
              {webLogo.domains.length > 1 && (
                <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                  <span className="text-lt-fg3">Try:</span>
                  {webLogo.domains
                    .filter((d) => d.domain !== webLogo.domain)
                    .slice(0, 6)
                    .map((d) => (
                      <button
                        key={d.domain}
                        onClick={() => findWebLogo(d.domain)}
                        disabled={logoBusy}
                        className="px-1.5 py-0.5 rounded border border-lt-hairline bg-lt-card text-lt-fg hover:border-lt-fg3 disabled:opacity-50"
                      >
                        {d.domain}
                        <span className="text-lt-fg3"> · {d.count}</span>
                      </button>
                    ))}
                </div>
              )}
            </div>
            <div className="flex items-center gap-2 sm:shrink-0">
              {webLogo.preview && (
                <button
                  onClick={() => findWebLogo(webLogo.domain, true)}
                  disabled={logoBusy}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-white bg-amber-600 hover:bg-amber-500 rounded-lg px-2.5 py-1.5 disabled:opacity-50"
                >
                  {logoBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                  Use this
                </button>
              )}
              <button onClick={() => setWebLogo(null)} className="text-lt-fg3 hover:text-lt-fg" title="Dismiss">
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      )}

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
                  className="sm:col-span-4 text-base sm:text-sm border border-lt-hairline rounded-lg px-2.5 py-2 bg-lt-card text-lt-fg"
                />
                <input
                  value={d.name}
                  onChange={(e) =>
                    setDrafts((prev) =>
                      prev.map((r, j) => (j === i ? { ...r, name: e.target.value } : r)),
                    )
                  }
                  placeholder="Name (optional)"
                  className="sm:col-span-3 text-base sm:text-sm border border-lt-hairline rounded-lg px-2.5 py-2 bg-lt-card text-lt-fg"
                />
                <input
                  value={d.title}
                  onChange={(e) =>
                    setDrafts((prev) =>
                      prev.map((r, j) => (j === i ? { ...r, title: e.target.value } : r)),
                    )
                  }
                  placeholder="Title (optional)"
                  className="sm:col-span-3 text-base sm:text-sm border border-lt-hairline rounded-lg px-2.5 py-2 bg-lt-card text-lt-fg"
                />
                <select
                  value={d.role}
                  onChange={(e) =>
                    setDrafts((prev) =>
                      prev.map((r, j) => (j === i ? { ...r, role: e.target.value } : r)),
                    )
                  }
                  className="sm:col-span-2 text-base sm:text-sm border border-lt-hairline rounded-lg px-2 py-2 bg-lt-card text-lt-fg"
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
                  {r.addedFromPortalBy ? ` · added by ${r.addedFromPortalBy} from their portal` : ''}
                </div>
              </div>
              <div className="flex items-center gap-2 sm:shrink-0">
                <Link
                  href={`/crm/portals/preview/company/${companyId}?as=${r.id}`}
                  className="inline-flex items-center gap-1 text-xs font-semibold border border-lt-hairline rounded-lg px-2.5 py-1.5 text-lt-fg hover:text-black"
                  title={`See the portal as ${r.person.firstName} sees it`}
                >
                  <Eye className="w-3.5 h-3.5" /> View as
                </Link>
              {canEdit && (
                <>
                  <button
                    onClick={() => sendInvite(r.id)}
                    disabled={busy}
                    className="inline-flex items-center gap-1 text-xs font-semibold border border-lt-hairline rounded-lg px-2.5 py-1.5 text-lt-fg hover:text-black"
                  >
                    {r.invitedAt ? <Check className="w-3.5 h-3.5" /> : <Mail className="w-3.5 h-3.5" />}
                    {r.invitedAt ? 'Re-send' : 'Review & send invite'}
                  </button>
                  <button
                    onClick={() => revoke(r.id)}
                    disabled={busy}
                    className="text-lt-fg3 hover:text-chip-bad-fg"
                    title="Revoke access"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </>
              )}
              </div>
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
      {inviteFor && (
        <CompanyInviteReviewModal
          companyId={companyId}
          accessId={inviteFor}
          onClose={() => setInviteFor(null)}
          onSent={({ email }) => {
            setInviteFor(null)
            setNotice(`Invite sent to ${email}.`)
            void load()
          }}
        />
      )}
    </div>
  )
}
