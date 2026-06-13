'use client'

/**
 * /admin/dedup — human review surface for the Person dedup primitive.
 *
 * Internal admin tool. Functional over polished — uses existing
 * `lt-*` brand tokens, no new design language.
 *
 * Flow:
 *   - Loads clusters via GET /api/admin/dedup (LIKELY_DUPE first,
 *     UNCERTAIN next, LIKELY_OFFICE_MAINLINE hidden by default).
 *   - Per cluster: side-by-side diff, survivor selector, canonical-
 *     email selector, field-conflict pickers, "suppress" / "merge".
 *   - Confirm summary before merge (refs to repoint, affils to sum,
 *     jobContact collisions). No silent merge.
 *   - "Recent merges" sidebar with one-click reverse — the safety net.
 *
 * Admin gating is server-side via requireDedupAccess() on every
 * endpoint; the page renders, the APIs return 403 — gracefully shown.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'

type Classification = 'LIKELY_DUPE' | 'LIKELY_OFFICE_MAINLINE' | 'UNCERTAIN'

interface Row {
  id: string
  firstName: string
  lastName: string
  email: string
  phone: string | null
  mobile: string | null
  role: string
  tier: string
  source: string | null
  rawTitle: string | null
  lastKnownProject: string | null
  notes: string | null
  createdAt: string
  refCount: number
  hasUserAccount: boolean
}

interface Cluster {
  key: string
  method: 'EMAIL' | 'PHONE'
  classification: Classification
  rationale: string
  survivorId: string | null
  rows: Row[]
}

interface Counts {
  likelyDupe: number
  uncertain: number
  officeMainline: number
  suppressed: number
  totalOpen: number
}

interface RecentMerge {
  id: string
  mergedAt: string
  mergedBy: { name: string; email: string }
  survivor: { id: string; name: string; email: string }
  loser: { id: string; name: string; email: string }
  aliasCount: number
}

const FIELD_KEYS = [
  'firstName', 'lastName', 'phone', 'mobile', 'role', 'tier',
  'rawTitle', 'lastKnownProject', 'notes',
] as const
type FieldKey = (typeof FIELD_KEYS)[number]

const FIELD_LABELS: Record<FieldKey, string> = {
  firstName: 'First',
  lastName: 'Last',
  phone: 'Phone',
  mobile: 'Mobile',
  role: 'Role',
  tier: 'Tier',
  rawTitle: 'Raw title',
  lastKnownProject: 'Last project',
  notes: 'Notes',
}

export default function DedupPage() {
  const [clusters, setClusters] = useState<Cluster[]>([])
  const [counts, setCounts] = useState<Counts | null>(null)
  const [showOffice, setShowOffice] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [recent, setRecent] = useState<RecentMerge[]>([])
  const [mergedThisSession, setMergedThisSession] = useState(0)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [cRes, rRes] = await Promise.all([
        fetch(`/api/admin/dedup${showOffice ? '?includeSuppressed=1' : ''}`),
        fetch('/api/admin/dedup/recent?days=2'),
      ])
      if (cRes.status === 403) {
        setError('Forbidden — dedup access is restricted to Wes + Dani.')
        setLoading(false)
        return
      }
      if (!cRes.ok) {
        setError(`Cluster API: HTTP ${cRes.status}`)
        setLoading(false)
        return
      }
      const cData = await cRes.json()
      setClusters(cData.clusters ?? [])
      setCounts(cData.counts ?? null)
      if (rRes.ok) {
        const rData = await rRes.json()
        setRecent(rData.merges ?? [])
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [showOffice])

  useEffect(() => { load() }, [load])

  // Filtered cluster list — LIKELY_OFFICE_MAINLINE hidden by default.
  const visible = useMemo(() => {
    return clusters.filter((c) =>
      showOffice ? true : c.classification !== 'LIKELY_OFFICE_MAINLINE'
    )
  }, [clusters, showOffice])

  const onMerged = () => {
    setMergedThisSession((n) => n + 1)
    load()
  }

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      <header className="mb-6 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-lt-fg">Dedup review</h1>
          <p className="text-sm text-lt-fg2 mt-1">
            Human-in-the-loop merge queue. Every merge is auditable and reversible from
            the &ldquo;Recent merges&rdquo; panel.
          </p>
        </div>
        {counts && (
          <div className="text-sm text-lt-fg2 flex gap-4 flex-wrap items-center">
            <span><span className="font-bold text-lt-fg">{counts.totalOpen}</span> open</span>
            <span><span className="font-bold text-chip-good-fg">{counts.likelyDupe}</span> likely dupe</span>
            <span><span className="font-bold text-lt-fg">{counts.uncertain}</span> uncertain</span>
            <span><span className="font-bold text-lt-fg3">{counts.officeMainline}</span> office line</span>
            <span><span className="font-bold text-lt-fg3">{counts.suppressed}</span> suppressed</span>
            <span><span className="font-bold text-chip-good-fg">{mergedThisSession}</span> merged this session</span>
          </div>
        )}
      </header>

      {error && (
        <div className="mb-4 p-3 rounded border border-chip-bad-fg/30 bg-chip-bad-bg text-sm text-chip-bad-fg">
          {error}
        </div>
      )}

      <div className="flex items-center gap-3 mb-4 text-sm">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={showOffice}
            onChange={(e) => setShowOffice(e.target.checked)}
          />
          <span className="text-lt-fg2">Show office mainlines + suppressed</span>
        </label>
        <button
          onClick={load}
          className="text-xs px-2 py-1 border border-lt-hairline rounded text-lt-fg2 hover:text-lt-fg"
        >
          Refresh
        </button>
      </div>

      <div className="grid grid-cols-[1fr_320px] gap-6">
        <main className="space-y-4">
          {loading && <div className="text-sm text-lt-fg3">Loading clusters…</div>}
          {!loading && visible.length === 0 && (
            <div className="text-sm text-lt-fg3 p-6 border border-dashed border-lt-hairline rounded">
              Queue clear. {counts && counts.officeMainline > 0 ? `${counts.officeMainline} office mainlines hidden — toggle above to view.` : ''}
            </div>
          )}
          {visible.map((c) => (
            <ClusterCard key={c.key} cluster={c} onMerged={onMerged} onSuppressed={load} />
          ))}
        </main>

        <aside className="text-sm">
          <h2 className="font-semibold text-lt-fg mb-2">Recent merges (last 2d)</h2>
          {recent.length === 0 && (
            <div className="text-xs text-lt-fg3 p-3 border border-dashed border-lt-hairline rounded">
              No recent un-reversed merges.
            </div>
          )}
          <ul className="space-y-2">
            {recent.map((m) => (
              <RecentMergeRow key={m.id} merge={m} onReversed={load} />
            ))}
          </ul>
        </aside>
      </div>
    </div>
  )
}

// ── Cluster card ────────────────────────────────────────────────────

function ClusterCard({ cluster, onMerged, onSuppressed }: {
  cluster: Cluster
  onMerged: () => void
  onSuppressed: () => void
}) {
  const [survivorId, setSurvivorId] = useState<string>(
    cluster.survivorId ?? cluster.rows[0].id,
  )
  // Available emails for the canonical picker — every row's address.
  const emailOptions = useMemo(
    () => Array.from(new Set(cluster.rows.map((r) => r.email.trim().toLowerCase()))),
    [cluster.rows],
  )
  const survivor = cluster.rows.find((r) => r.id === survivorId)!
  // Default canonical = survivor's email lowercased
  const [canonicalEmail, setCanonicalEmail] = useState<string>(
    survivor.email.trim().toLowerCase(),
  )

  // When the survivor changes, default the canonical pick to the
  // new survivor's email (reviewer can still override).
  useEffect(() => {
    setCanonicalEmail(survivor.email.trim().toLowerCase())
  }, [survivorId, survivor.email])

  // Field-conflict picks. Default: survivor's value wins (== undefined override).
  // For each field where survivor and at least one loser hold non-null
  // but different values, the user picks one.
  const [overrides, setOverrides] = useState<Partial<Record<FieldKey, { from: string; value: string | null }>>>({})

  const onClusterMerge = async (loserId: string) => {
    // For a >2-member cluster, the reviewer merges pairs one at a
    // time. The state ratchets — after each merge the cluster reloads
    // with one fewer row.
    const body: Record<string, unknown> = {
      survivorId,
      loserId,
      canonicalEmail,
    }
    if (Object.keys(overrides).length > 0) {
      body.fieldOverrides = Object.fromEntries(
        Object.entries(overrides).map(([k, v]) => [k, v?.value ?? null]),
      )
    }
    const res = await fetch('/api/admin/dedup/merge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      alert(`Merge failed: ${data.error || res.statusText}`)
      return
    }
    onMerged()
  }

  const onSuppress = async () => {
    if (!confirm('Mark this cluster as "shared office line"? It will be hidden from the default queue but can be unsuppressed later.')) {
      return
    }
    const res = await fetch('/api/admin/dedup/suppress', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ personIds: cluster.rows.map((r) => r.id) }),
    })
    if (!res.ok) {
      alert(`Suppress failed: HTTP ${res.status}`)
      return
    }
    onSuppressed()
  }

  // Find field conflicts: same field, ≥2 distinct non-null values
  // across the cluster.
  const conflicts = useMemo(() => {
    const out: Array<{ key: FieldKey; values: Array<{ rowId: string; value: string }> }> = []
    for (const k of FIELD_KEYS) {
      const values = cluster.rows
        .map((r) => ({ rowId: r.id, value: ((r as unknown as Record<string, unknown>)[k] as string | null) ?? '' }))
        .filter((v) => v.value !== '')
      const distinct = new Set(values.map((v) => v.value))
      if (distinct.size > 1) out.push({ key: k, values })
    }
    return out
  }, [cluster.rows])

  const badgeClass: Record<Classification, string> = {
    LIKELY_DUPE: 'bg-chip-good-bg text-chip-good-fg',
    UNCERTAIN: 'bg-lt-card text-lt-fg2 border border-lt-hairline',
    LIKELY_OFFICE_MAINLINE: 'bg-lt-card text-lt-fg3 border border-lt-hairline',
  }

  return (
    <section className="border border-lt-hairline rounded-lg overflow-hidden">
      <header className="px-4 py-3 bg-lt-card/60 border-b border-lt-hairline flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded ${badgeClass[cluster.classification]}`}>
            {cluster.classification.replace(/_/g, ' ')}
          </span>
          <span className="text-[10px] font-bold uppercase tracking-wider text-lt-fg3 px-2 py-0.5 border border-lt-hairline rounded">
            {cluster.method}
          </span>
          <span className="text-sm text-lt-fg font-mono">{cluster.key}</span>
          <span className="text-xs text-lt-fg3">· {cluster.rows.length} rows</span>
        </div>
        <button
          onClick={onSuppress}
          className="text-xs px-2 py-1 border border-lt-hairline rounded text-lt-fg2 hover:text-lt-fg"
          title="Not a dupe — shared office line"
        >
          Not a dupe (office line)
        </button>
      </header>

      <div className="px-4 py-2 text-xs text-lt-fg2 italic">{cluster.rationale}</div>

      {/* Side-by-side diff */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-lt-card/40 text-lt-fg3">
            <tr>
              <th className="text-left px-3 py-2 font-semibold uppercase tracking-wider">Field</th>
              {cluster.rows.map((r) => (
                <th key={r.id} className="text-left px-3 py-2 font-semibold uppercase tracking-wider">
                  <div className="flex items-center gap-2">
                    <label className="flex items-center gap-1 cursor-pointer">
                      <input
                        type="radio"
                        name={`survivor-${cluster.key}`}
                        checked={survivorId === r.id}
                        onChange={() => setSurvivorId(r.id)}
                      />
                      <span className="text-[10px]">SURVIVOR</span>
                    </label>
                    <span className="text-lt-fg font-mono">{r.id.slice(0, 8)}…</span>
                    <span className="text-chip-good-fg font-mono">refs={r.refCount}</span>
                    {r.hasUserAccount && (
                      <span className="text-[9px] text-chip-good-fg uppercase tracking-wider">portal</span>
                    )}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="text-lt-fg2">
            {FIELD_KEYS.map((k) => {
              const conflict = conflicts.find((c) => c.key === k)
              return (
                <tr key={k} className="border-t border-lt-hairline/60">
                  <td className="px-3 py-1.5 text-lt-fg3 font-semibold">{FIELD_LABELS[k]}</td>
                  {cluster.rows.map((r) => {
                    const v = (((r as unknown) as Record<string, unknown>)[k] as string | null) ?? ''
                    const isPicked = overrides[k]?.from === r.id
                    return (
                      <td key={r.id} className={`px-3 py-1.5 align-top ${conflict && isPicked ? 'bg-chip-good-bg/40' : ''}`}>
                        {conflict && v !== '' ? (
                          <label className="flex items-start gap-1 cursor-pointer">
                            <input
                              type="radio"
                              name={`override-${cluster.key}-${k}`}
                              checked={isPicked}
                              onChange={() => setOverrides((prev) => ({
                                ...prev,
                                [k]: { from: r.id, value: v },
                              }))}
                            />
                            <span className="font-mono break-all">{v}</span>
                          </label>
                        ) : (
                          <span className="font-mono break-all">{v || <em className="text-lt-fg3">∅</em>}</span>
                        )}
                      </td>
                    )
                  })}
                </tr>
              )
            })}
            <tr className="border-t border-lt-hairline/60 bg-lt-card/30">
              <td className="px-3 py-1.5 text-lt-fg3 font-semibold">Email</td>
              {cluster.rows.map((r) => (
                <td key={r.id} className="px-3 py-1.5 font-mono break-all">
                  {r.email}
                </td>
              ))}
            </tr>
            <tr className="border-t border-lt-hairline/60">
              <td className="px-3 py-1.5 text-lt-fg3 font-semibold">Created</td>
              {cluster.rows.map((r) => (
                <td key={r.id} className="px-3 py-1.5 font-mono text-[11px]">
                  {r.createdAt.slice(0, 10)}
                </td>
              ))}
            </tr>
            <tr className="border-t border-lt-hairline/60">
              <td className="px-3 py-1.5 text-lt-fg3 font-semibold">Source</td>
              {cluster.rows.map((r) => (
                <td key={r.id} className="px-3 py-1.5 font-mono">
                  {r.source || <em className="text-lt-fg3">∅</em>}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>

      {/* Canonical-email picker + merge actions */}
      <div className="px-4 py-3 border-t border-lt-hairline bg-lt-card/30 flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-2 text-xs">
          <span className="text-lt-fg3">Canonical email:</span>
          <select
            value={canonicalEmail}
            onChange={(e) => setCanonicalEmail(e.target.value)}
            className="bg-lt-card border border-lt-hairline rounded px-2 py-1 text-lt-fg font-mono"
          >
            {emailOptions.map((e) => (
              <option key={e} value={e}>{e}</option>
            ))}
          </select>
          <span className="text-lt-fg3 italic">other addresses → aliases</span>
        </div>
        <div className="flex items-center gap-2">
          {cluster.rows.filter((r) => r.id !== survivorId).map((loser) => (
            <MergeButton
              key={loser.id}
              cluster={cluster}
              survivor={survivor}
              loser={loser}
              canonicalEmail={canonicalEmail}
              overrides={overrides}
              onConfirm={() => onClusterMerge(loser.id)}
            />
          ))}
        </div>
      </div>
    </section>
  )
}

// ── Merge button with confirm summary ──────────────────────────────

function MergeButton({
  cluster, survivor, loser, canonicalEmail, overrides, onConfirm,
}: {
  cluster: Cluster
  survivor: Row
  loser: Row
  canonicalEmail: string
  overrides: Partial<Record<FieldKey, { from: string; value: string | null }>>
  onConfirm: () => void
}) {
  const [open, setOpen] = useState(false)

  // Pre-flight summary: counts come from the rows we already have +
  // the cluster shape. Real collision detection happens server-side
  // in the merge primitive transaction; this is a "good-faith
  // estimate so the reviewer isn't blind."
  const summary = useMemo(() => {
    const fieldOverrideCount = Object.keys(overrides).length
    const aliasNeeded = canonicalEmail.trim().toLowerCase() !==
      // The "other" email — whichever one isn't canonical
      [survivor.email, loser.email]
        .find((e) => e.trim().toLowerCase() !== canonicalEmail.trim().toLowerCase())
        ?.trim()
        ?.toLowerCase()
    return {
      refsToRepoint: loser.refCount,
      fieldOverrideCount,
      aliasNeeded,
      // Best-effort: there's no client-side way to know JobContact /
      // Affiliation collisions without re-querying — the server
      // surfaces the actuals in the response. Leave the summary
      // honest about that.
    }
  }, [cluster.method, overrides, canonicalEmail, survivor.email, loser.email])
  void cluster.method  // silence unused warning when method-specific logic gets added

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="text-xs px-3 py-1 bg-lt-fg text-white rounded hover:bg-black"
      >
        Merge {loser.id.slice(0, 6)}… → survivor
      </button>
    )
  }

  return (
    <div className="flex items-center gap-2 text-xs p-2 border border-lt-hairline rounded bg-lt-card">
      <div className="text-lt-fg2">
        <div className="font-semibold text-lt-fg">Confirm:</div>
        <ul className="text-[11px] mt-1 space-y-0.5">
          <li>• {summary.refsToRepoint} refs repoint loser → survivor</li>
          <li>• JobContact + Affiliation unique collisions resolved in-transaction</li>
          <li>• Survivor email becomes <span className="font-mono">{canonicalEmail}</span></li>
          {summary.aliasNeeded && <li>• Other address minted as PersonEmailAlias</li>}
          <li>• {summary.fieldOverrideCount} field override{summary.fieldOverrideCount === 1 ? '' : 's'} from conflict UI</li>
          <li>• Loser row archived to PersonMerge.loserSnapshot (full restore via Recent merges)</li>
        </ul>
      </div>
      <div className="flex flex-col gap-1">
        <button
          onClick={() => { setOpen(false); onConfirm() }}
          className="text-xs px-3 py-1 bg-chip-good-fg text-white rounded hover:opacity-90"
        >
          Confirm merge
        </button>
        <button
          onClick={() => setOpen(false)}
          className="text-xs px-3 py-1 text-lt-fg3 hover:text-lt-fg"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}

// ── Recent merges row with one-click reverse ────────────────────────

function RecentMergeRow({ merge, onReversed }: { merge: RecentMerge; onReversed: () => void }) {
  const [busy, setBusy] = useState(false)

  const reverse = async () => {
    if (!confirm(`Reverse merge of ${merge.loser.name} (${merge.loser.email}) into ${merge.survivor.name}?`)) return
    setBusy(true)
    const res = await fetch('/api/admin/dedup/reverse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mergeId: merge.id }),
    })
    setBusy(false)
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      alert(`Reverse failed: ${data.error || res.statusText}`)
      return
    }
    onReversed()
  }

  return (
    <li className="border border-lt-hairline rounded p-2 text-xs">
      <div className="text-lt-fg font-mono">{merge.loser.email}</div>
      <div className="text-lt-fg3 text-[11px]">→ {merge.survivor.email}</div>
      <div className="text-lt-fg3 text-[11px] mt-1">
        {new Date(merge.mergedAt).toLocaleString()}
        {' · '} by {merge.mergedBy.name}
        {merge.aliasCount > 0 && <span className="ml-1">· {merge.aliasCount} alias</span>}
      </div>
      <button
        onClick={reverse}
        disabled={busy}
        className="mt-1 text-[11px] px-2 py-0.5 border border-lt-hairline rounded text-chip-bad-fg hover:bg-chip-bad-bg disabled:opacity-50"
      >
        {busy ? 'Reversing…' : 'Reverse'}
      </button>
    </li>
  )
}
