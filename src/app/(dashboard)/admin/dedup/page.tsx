'use client'

/**
 * /admin/dedup — human review surface for the Person dedup primitive.
 *
 * Internal admin tool, but NOT a jargon dump: the reviewer is deciding
 * whether two humans are one human, so every control names the PEOPLE
 * (name + email), never the row's uuid. The 2026-09-08 rewrite killed
 * the "Merge 5d21cc… → survivor" buttons — a reviewer cannot tell which
 * contact a hex prefix belongs to, and a wrong click destroys a contact.
 *
 * Flow:
 *   - Loads clusters via GET /api/admin/dedup (LIKELY_DUPE first,
 *     UNCERTAIN next, LIKELY_OFFICE_MAINLINE hidden by default).
 *   - Per cluster: side-by-side diff + an "After merge" column that
 *     shows the record that actually results, keep-picker, canonical-
 *     email selector, per-field value pickers, "not a dupe" / "merge".
 *   - ONE merge button per cluster, whatever its size: the group is the
 *     unit of the decision, and the "After merge" column already previews
 *     every record landing. (Before 2026-09-11 a 3-record group grew a
 *     button per loser, one of them disabled whenever the main address
 *     came from a record being merged in.) The primitive still takes one
 *     loser at a time, so the button walks them in mergeOrder.
 *   - Confirm summary before merge (refs to repoint, alias minted,
 *     snapshot kept). No silent merge.
 *   - "Recent merges" sidebar with one-click undo — the safety net.
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
  method: 'EMAIL' | 'PHONE' | 'NAME'
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
  firstName: 'First name',
  lastName: 'Last name',
  phone: 'Phone',
  mobile: 'Mobile',
  role: 'Role',
  tier: 'Tier',
  rawTitle: 'Title (as written)',
  lastKnownProject: 'Last project',
  notes: 'Notes',
}

/** Columns mergePersons() back-fills from the merged-in row when the kept
 *  row is blank. Mirrored here so the "After merge" column tells the truth. */
const NULL_FILL_KEYS: FieldKey[] = ['phone', 'mobile', 'rawTitle', 'lastKnownProject']

const CLASSIFICATION_LABEL: Record<Classification, string> = {
  LIKELY_DUPE: 'Likely the same person',
  UNCERTAIN: 'Needs a human call',
  LIKELY_OFFICE_MAINLINE: 'Looks like a shared office line',
}

const METHOD_LABEL: Record<Cluster['method'], string> = {
  EMAIL: 'share an email address',
  PHONE: 'share a phone number',
  NAME: 'have the same name',
}

/** "Trina Reyna (Sabertooth)" — the display name a reviewer recognises.
 *  `lastName` is a placeholder (""/".") on more than half the table, so it
 *  is dropped rather than printed. */
function displayName(r: Row): string {
  const last = r.lastName.trim().replace(/^\.$/, '')
  const name = `${r.firstName.trim()} ${last}`.trim()
  return name || r.email
}

function fieldValue(r: Row, k: FieldKey): string {
  return (((r as unknown) as Record<string, unknown>)[k] as string | null)?.trim() ?? ''
}

/** The matched value, in the shape a human reads it. Cluster keys arrive
 *  as `phone:6302005986` / `email:x@y.com` / `name:trina reyna`. */
function matchedOn(cluster: Cluster): string {
  const raw = cluster.key.replace(/^(phone|email|name):/, '')
  if (cluster.method === 'PHONE') {
    const d = raw.replace(/\D/g, '')
    if (d.length === 10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`
    if (d.length === 11 && d.startsWith('1')) return `(${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}`
  }
  return raw
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

  const onMerged = (count: number) => {
    setMergedThisSession((n) => n + count)
    load()
  }

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      <header className="mb-6 flex items-start justify-between gap-4 flex-wrap">
        <div className="max-w-xl">
          <h1 className="text-2xl font-bold text-lt-fg">Duplicate contacts</h1>
          <p className="text-sm text-lt-fg2 mt-1">
            Each group below is a set of contact records that <em>might</em> be the
            same person. Pick the record to keep, pick which values it ends up with,
            then merge the others into it. Nothing is lost — every merge can be undone
            from &ldquo;Recently merged&rdquo;.
          </p>
        </div>
        {counts && (
          <div className="text-sm text-lt-fg2 flex gap-4 flex-wrap items-center">
            <span><span className="font-bold text-lt-fg">{counts.totalOpen}</span> to review</span>
            <span><span className="font-bold text-chip-good-fg">{counts.likelyDupe}</span> likely the same</span>
            <span><span className="font-bold text-lt-fg">{counts.uncertain}</span> needs a call</span>
            <span><span className="font-bold text-lt-fg3">{counts.officeMainline}</span> office lines</span>
            <span><span className="font-bold text-lt-fg3">{counts.suppressed}</span> set aside</span>
            <span><span className="font-bold text-chip-good-fg">{mergedThisSession}</span> merged today</span>
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
          <span className="text-lt-fg2">Also show office lines + groups already set aside</span>
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
          {loading && <div className="text-sm text-lt-fg3">Loading…</div>}
          {!loading && visible.length === 0 && (
            <div className="text-sm text-lt-fg3 p-6 border border-dashed border-lt-hairline rounded">
              Nothing to review. {counts && counts.officeMainline > 0 ? `${counts.officeMainline} shared office lines are hidden — tick the box above to see them.` : ''}
            </div>
          )}
          {visible.map((c) => (
            <ClusterCard key={c.key} cluster={c} onMerged={onMerged} onSuppressed={load} />
          ))}
        </main>

        <aside className="text-sm">
          <h2 className="font-semibold text-lt-fg mb-1">Recently merged</h2>
          <p className="text-xs text-lt-fg3 mb-2">Last 2 days. Undo puts the record back exactly as it was.</p>
          {recent.length === 0 && (
            <div className="text-xs text-lt-fg3 p-3 border border-dashed border-lt-hairline rounded">
              Nothing merged in the last 2 days.
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
  onMerged: (count: number) => void
  onSuppressed: () => void
}) {
  const [survivorId, setSurvivorId] = useState<string>(
    cluster.survivorId ?? cluster.rows[0].id,
  )
  const survivor = cluster.rows.find((r) => r.id === survivorId)!
  const losers = cluster.rows.filter((r) => r.id !== survivorId)

  // Available emails for the canonical picker — every row's address.
  const emailOptions = useMemo(
    () => Array.from(new Set(cluster.rows.map((r) => r.email.trim().toLowerCase()))),
    [cluster.rows],
  )
  const [canonicalEmail, setCanonicalEmail] = useState<string>(
    survivor.email.trim().toLowerCase(),
  )
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)

  // Which value wins for each field. `undefined` for a field means "no
  // explicit pick" — the kept record's own value stands. Re-seeded from the
  // kept record whenever the reviewer changes who is kept, so the radio the
  // page shows as selected is always the value that will actually be written.
  const [overrides, setOverrides] = useState<Partial<Record<FieldKey, { from: string; value: string }>>>({})

  useEffect(() => {
    setCanonicalEmail(survivor.email.trim().toLowerCase())
    setConfirming(false)
    const seeded: Partial<Record<FieldKey, { from: string; value: string }>> = {}
    for (const k of FIELD_KEYS) {
      const v = fieldValue(survivor, k)
      if (v) seeded[k] = { from: survivor.id, value: v }
    }
    setOverrides(seeded)
  }, [survivorId, survivor])

  // Find field conflicts: same field, ≥2 distinct non-blank values.
  const conflicts = useMemo(() => {
    const out = new Set<FieldKey>()
    for (const k of FIELD_KEYS) {
      const distinct = new Set(
        cluster.rows.map((r) => fieldValue(r, k)).filter((v) => v !== ''),
      )
      if (distinct.size > 1) out.add(k)
    }
    return out
  }, [cluster.rows])

  // The canonical email must belong to the survivor or to the row being
  // merged in — mergePersons() rejects anything else with a 409. So when
  // the reviewer borrows the main address from a record being merged in,
  // that record goes FIRST; by the time the rest run, the survivor owns it.
  const mergeOrder = useMemo(() => {
    const owner = losers.find((l) => l.email.trim().toLowerCase() === canonicalEmail)
    if (!owner) return losers
    return [owner, ...losers.filter((l) => l.id !== owner.id)]
  }, [losers, canonicalEmail])

  // What the kept record actually looks like after every merge in this
  // group lands — the reviewer should never have to model this in their head.
  const resolved = useCallback((k: FieldKey): { value: string; fromId: string | null } => {
    const picked = overrides[k]
    if (picked && picked.value) return { value: picked.value, fromId: picked.from }
    const own = fieldValue(survivor, k)
    if (own) return { value: own, fromId: survivor.id }
    if (NULL_FILL_KEYS.includes(k)) {
      // First record merged in wins a blank column — so preview in the
      // order the merges actually run.
      const filler = mergeOrder.find((l) => fieldValue(l, k) !== '')
      if (filler) return { value: fieldValue(filler, k), fromId: filler.id }
    }
    return { value: '', fromId: null }
  }, [overrides, survivor, mergeOrder])

  const runMerge = async () => {
    setBusy(true)
    const fieldOverrides = Object.fromEntries(
      Object.entries(overrides).map(([k, v]) => [k, v?.value ?? null]),
    )
    // One request per record merged in — the primitive takes one loser at
    // a time. mergeOrder puts the canonical-email owner first so the
    // survivor already holds that address when the rest go in.
    let done = 0
    for (const loser of mergeOrder) {
      const res = await fetch('/api/admin/dedup/merge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ survivorId, loserId: loser.id, canonicalEmail, fieldOverrides }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setBusy(false)
        setConfirming(false)
        alert(
          `Merge failed on ${displayName(loser)}: ${data.error || res.statusText}` +
          (done > 0
            ? `\n\n${done} record${done === 1 ? '' : 's'} already merged in — that part stands, ` +
              'and each one can be undone from "Recently merged".'
            : ''),
        )
        if (done > 0) onMerged(done)
        return
      }
      done += 1
    }
    setBusy(false)
    setConfirming(false)
    onMerged(done)
  }

  const onSuppress = async () => {
    if (!confirm('Mark these as different people sharing one line? The group is hidden from the review list; you can bring it back with the checkbox at the top.')) {
      return
    }
    const res = await fetch('/api/admin/dedup/suppress', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ personIds: cluster.rows.map((r) => r.id) }),
    })
    if (!res.ok) {
      alert(`Could not set aside: HTTP ${res.status}`)
      return
    }
    onSuppressed()
  }

  const badgeClass: Record<Classification, string> = {
    LIKELY_DUPE: 'bg-chip-good-bg text-chip-good-fg',
    UNCERTAIN: 'bg-chip-warn-bg text-chip-warn-fg',
    LIKELY_OFFICE_MAINLINE: 'bg-lt-card text-lt-fg3 border border-lt-hairline',
  }

  return (
    <section className="border border-lt-hairline rounded-lg overflow-hidden bg-lt-card">
      <header className="px-4 py-3 bg-lt-inner border-b border-lt-hairline flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded ${badgeClass[cluster.classification]}`}>
              {CLASSIFICATION_LABEL[cluster.classification]}
            </span>
            <span className="text-sm text-lt-fg font-semibold">
              {cluster.rows.length} records that {METHOD_LABEL[cluster.method]}
            </span>
            <span className="text-sm text-lt-fg2">— {matchedOn(cluster)}</span>
          </div>
          <div className="text-xs text-lt-fg3 mt-1">Why they were grouped: {cluster.rationale}</div>
        </div>
        <button
          onClick={onSuppress}
          className="text-xs px-2 py-1 border border-lt-hairline rounded text-lt-fg2 hover:text-lt-fg whitespace-nowrap"
          title="Different people who happen to share this line — hide this group"
        >
          Not the same people
        </button>
      </header>

      <div className="px-4 pt-3 pb-1 text-xs text-lt-fg2">
        Choose <span className="font-semibold text-lt-fg">Keep this one</span> at the top of a
        column, then use the dots in a row to choose which value the kept record ends up with.
        The <span className="font-semibold text-lt-fg">After merge</span> column on the right is
        the record you will be left with.
      </div>

      {/* Side-by-side diff + result preview */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="text-lt-fg3">
            <tr>
              <th className="text-left px-3 py-2 font-semibold uppercase tracking-wider w-32">Field</th>
              {cluster.rows.map((r) => {
                const keep = r.id === survivorId
                return (
                  <th
                    key={r.id}
                    className={`text-left px-3 py-2 align-top font-normal border-l border-lt-hairline/60 ${keep ? 'bg-chip-good-bg/40' : ''}`}
                  >
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="radio"
                        name={`survivor-${cluster.key}`}
                        checked={keep}
                        onChange={() => setSurvivorId(r.id)}
                      />
                      <span className={`text-[10px] font-bold uppercase tracking-wider ${keep ? 'text-chip-good-fg' : 'text-lt-fg3'}`}>
                        {keep ? 'Keeping this one' : 'Keep this one'}
                      </span>
                    </label>
                    <div className="text-sm text-lt-fg font-semibold mt-1 normal-case tracking-normal">
                      {displayName(r)}
                    </div>
                    <div className="text-[11px] text-lt-fg2 break-all normal-case tracking-normal">{r.email}</div>
                    <div className="text-[11px] text-lt-fg3 normal-case tracking-normal mt-0.5">
                      used in {r.refCount} place{r.refCount === 1 ? '' : 's'}
                      {' · '}added {r.createdAt.slice(0, 10)}
                      {r.hasUserAccount && <span className="text-chip-good-fg"> · has portal login</span>}
                    </div>
                    {!keep && (
                      <div className="text-[11px] text-lt-fg3 normal-case tracking-normal italic mt-0.5">
                        will be merged in
                      </div>
                    )}
                  </th>
                )
              })}
              <th className="text-left px-3 py-2 align-top font-normal border-l-2 border-lt-fg/20 bg-lt-inner w-56">
                <div className="text-[10px] font-bold uppercase tracking-wider text-lt-fg2">After merge</div>
                <div className="text-sm text-lt-fg font-semibold mt-1 normal-case tracking-normal">
                  {displayName(survivor)}
                </div>
                <div className="text-[11px] text-lt-fg2 break-all normal-case tracking-normal">{canonicalEmail}</div>
                <div className="text-[11px] text-lt-fg3 normal-case tracking-normal mt-0.5">
                  the one record everything points at
                </div>
              </th>
            </tr>
          </thead>
          <tbody className="text-lt-fg2">
            {FIELD_KEYS.map((k) => {
              const isConflict = conflicts.has(k)
              const result = resolved(k)
              return (
                <tr key={k} className="border-t border-lt-hairline/60">
                  <td className="px-3 py-1.5 text-lt-fg3 font-semibold align-top">
                    {FIELD_LABELS[k]}
                    {isConflict && <span className="block text-[10px] font-normal text-lt-fg3">pick one</span>}
                  </td>
                  {cluster.rows.map((r) => {
                    const v = fieldValue(r, k)
                    const isPicked = overrides[k]?.from === r.id && overrides[k]?.value === v && v !== ''
                    return (
                      <td
                        key={r.id}
                        className={`px-3 py-1.5 align-top border-l border-lt-hairline/60 ${isConflict && isPicked ? 'bg-chip-good-bg/40' : ''}`}
                      >
                        {isConflict && v !== '' ? (
                          <label className="flex items-start gap-1.5 cursor-pointer">
                            <input
                              type="radio"
                              className="mt-0.5"
                              name={`override-${cluster.key}-${k}`}
                              checked={isPicked}
                              onChange={() => setOverrides((prev) => ({
                                ...prev,
                                [k]: { from: r.id, value: v },
                              }))}
                            />
                            <span className="break-words">{v}</span>
                          </label>
                        ) : (
                          <span className="break-words">{v || <span className="text-lt-fg3">—</span>}</span>
                        )}
                      </td>
                    )
                  })}
                  <td className="px-3 py-1.5 align-top border-l-2 border-lt-fg/20 bg-lt-inner">
                    <span className="text-lt-fg break-words">
                      {result.value || <span className="text-lt-fg3">empty</span>}
                    </span>
                    {result.fromId && result.fromId !== survivorId && (
                      <span className="block text-[10px] text-lt-fg3">
                        filled in from {displayName(cluster.rows.find((r) => r.id === result.fromId)!)}
                      </span>
                    )}
                  </td>
                </tr>
              )
            })}
            <tr className="border-t border-lt-hairline/60">
              <td className="px-3 py-1.5 text-lt-fg3 font-semibold align-top">Email</td>
              {cluster.rows.map((r) => {
                const isCanonical = r.email.trim().toLowerCase() === canonicalEmail
                return (
                  <td key={r.id} className="px-3 py-1.5 break-all align-top border-l border-lt-hairline/60">
                    {r.email}
                    <span className="block text-[10px] text-lt-fg3">
                      {isCanonical ? 'main address' : 'kept as an alternate address'}
                    </span>
                  </td>
                )
              })}
              <td className="px-3 py-1.5 align-top border-l-2 border-lt-fg/20 bg-lt-inner break-all">
                <span className="text-lt-fg">{canonicalEmail}</span>
                {emailOptions.length > 1 && (
                  <span className="block text-[10px] text-lt-fg3">
                    + {emailOptions.length - 1} alternate address{emailOptions.length - 1 === 1 ? '' : 'es'}
                  </span>
                )}
              </td>
            </tr>
            <tr className="border-t border-lt-hairline/60">
              <td className="px-3 py-1.5 text-lt-fg3 font-semibold align-top">Came from</td>
              {cluster.rows.map((r) => (
                <td key={r.id} className="px-3 py-1.5 align-top border-l border-lt-hairline/60">
                  {r.source || <span className="text-lt-fg3">—</span>}
                </td>
              ))}
              <td className="px-3 py-1.5 align-top border-l-2 border-lt-fg/20 bg-lt-inner">
                <span className="text-lt-fg3">—</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Main-address picker + merge actions */}
      <div className="px-4 py-3 border-t border-lt-hairline bg-lt-inner flex items-center justify-between gap-4 flex-wrap">
        <label className="flex items-center gap-2 text-xs">
          <span className="text-lt-fg2">Main email address to keep:</span>
          <select
            value={canonicalEmail}
            onChange={(e) => { setCanonicalEmail(e.target.value); setConfirming(false) }}
            className="bg-lt-card border border-lt-hairline rounded px-2 py-1 text-lt-fg"
          >
            {emailOptions.map((e) => (
              <option key={e} value={e}>{e}</option>
            ))}
          </select>
          <span className="text-lt-fg3">the others stay on the record as alternates</span>
        </label>
        <div className="flex items-center gap-2 flex-wrap justify-end">
          <button
            onClick={() => setConfirming((c) => !c)}
            disabled={busy}
            title={`Merge ${mergeOrder.map(displayName).join(', ')} into ${displayName(survivor)}`}
            className="text-xs px-3 py-1.5 bg-lt-fg text-white rounded hover:bg-black disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {losers.length === 1
              ? <>Merge <span className="font-semibold">{displayName(losers[0])}</span> into {displayName(survivor)}</>
              : <>Merge <span className="font-semibold">the other {losers.length} records</span> into {displayName(survivor)}</>}
          </button>
        </div>
      </div>

      {confirming && (() => {
        const names = mergeOrder.map(displayName)
        const refTotal = mergeOrder.reduce((n, l) => n + l.refCount, 0)
        // Every address in the group that isn't the main one is kept as an
        // alternate, so old mail still finds this person.
        const aliasEmails = Array.from(
          new Set(cluster.rows.map((r) => r.email.trim().toLowerCase())),
        ).filter((e) => e && e !== canonicalEmail)
        const pickedFromLosers = FIELD_KEYS.filter(
          (k) => overrides[k] && overrides[k]!.from !== survivorId,
        )
        return (
          <div className="px-4 py-3 border-t border-lt-hairline bg-chip-warn-bg/40 text-xs">
            <div className="font-semibold text-lt-fg text-sm mb-1">
              Merge {names.join(' and ')} into {displayName(survivor)}?
            </div>
            <ul className="space-y-0.5 text-lt-fg2">
              <li>
                • The {refTotal} place{refTotal === 1 ? '' : 's'} that point at{' '}
                {names.length === 1 ? names[0] : `those ${names.length} records`} (jobs, orders,
                bookings, affiliations) will point at {displayName(survivor)} instead.
              </li>
              <li>• Main email address becomes <span className="font-semibold">{canonicalEmail}</span>.</li>
              {aliasEmails.length > 0 && (
                <li>
                  • <span className="font-semibold">{aliasEmails.join(', ')}</span>{' '}
                  {aliasEmails.length === 1 ? 'is' : 'are'} kept as alternate address
                  {aliasEmails.length === 1 ? '' : 'es'}, so old mail still finds this person.
                </li>
              )}
              {pickedFromLosers.length > 0 && (
                <li>
                  • Values taken from the records being merged in:{' '}
                  {pickedFromLosers.map((k) => FIELD_LABELS[k].toLowerCase()).join(', ')}.
                </li>
              )}
              <li>
                • {names.length === 1
                  ? `The ${names[0]} record is`
                  : `Those ${names.length} records are`}{' '}
                removed. A full copy of each is saved — undo them one at a time from
                &ldquo;Recently merged&rdquo;.
              </li>
            </ul>
            <div className="flex items-center gap-2 mt-2">
              <button
                onClick={runMerge}
                disabled={busy}
                className="text-xs px-3 py-1.5 bg-chip-good-fg text-white rounded hover:opacity-90 disabled:opacity-50"
              >
                {busy ? 'Merging…' : 'Yes, merge them'}
              </button>
              <button
                onClick={() => setConfirming(false)}
                className="text-xs px-3 py-1.5 text-lt-fg2 hover:text-lt-fg"
              >
                Cancel
              </button>
            </div>
          </div>
        )
      })()}
    </section>
  )
}

// ── Recent merges row with one-click undo ───────────────────────────

function RecentMergeRow({ merge, onReversed }: { merge: RecentMerge; onReversed: () => void }) {
  const [busy, setBusy] = useState(false)

  const reverse = async () => {
    if (!confirm(`Undo this merge and put ${merge.loser.name} (${merge.loser.email}) back as its own record?`)) return
    setBusy(true)
    const res = await fetch('/api/admin/dedup/reverse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mergeId: merge.id }),
    })
    setBusy(false)
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      alert(`Undo failed: ${data.error || res.statusText}`)
      return
    }
    onReversed()
  }

  return (
    <li className="border border-lt-hairline rounded p-2 text-xs">
      <div className="text-lt-fg font-semibold">{merge.loser.name || merge.loser.email}</div>
      <div className="text-lt-fg3 text-[11px] break-all">{merge.loser.email}</div>
      <div className="text-lt-fg2 text-[11px] mt-0.5">
        merged into {merge.survivor.name || merge.survivor.email}
      </div>
      <div className="text-lt-fg3 text-[11px] mt-1">
        {new Date(merge.mergedAt).toLocaleString()}
        {' · '} by {merge.mergedBy.name}
        {merge.aliasCount > 0 && <span className="ml-1">· {merge.aliasCount} alternate address kept</span>}
      </div>
      <button
        onClick={reverse}
        disabled={busy}
        className="mt-1 text-[11px] px-2 py-0.5 border border-lt-hairline rounded text-chip-bad-fg hover:bg-chip-bad-bg disabled:opacity-50"
      >
        {busy ? 'Undoing…' : 'Undo this merge'}
      </button>
    </li>
  )
}
