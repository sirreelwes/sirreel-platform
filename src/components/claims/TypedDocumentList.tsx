'use client'

/**
 * TypedDocumentList — replaces the flat title-and-type list under
 * Documents on /claims/[id]. Renders the same rows but:
 *
 *   1. Filter chips above the list: "All N · Photos 6 · Damage
 *      Invoice 1 · COI 1 · Correspondence 3 · …". Click a chip to
 *      narrow; click All to clear. Only types that exist on this
 *      claim get a chip (zero-count types stay hidden).
 *
 *   2. Each row carries a docType <select> for inline re-pick.
 *      Changing the value PATCHes the document and flips
 *      typeSource to USER + nulls confidence.
 *
 *   3. AI_SUGGESTED rows get a small "AI · NN%" pill so reps can
 *      see which rows still want a review pass.
 *
 * Legacy types (CHECKOUT_PHOTO, RETURN_PHOTO, DEMAND_LETTER, etc.)
 * still render correctly with their existing labels — the picker
 * exposes the full enum so a re-pick can preserve them.
 */

import { useMemo, useState } from 'react'
import type { ClaimDocType } from '@prisma/client'

const TYPE_LABEL: Record<ClaimDocType, string> = {
  PHOTO: 'Photos',
  CHECKOUT_PHOTO: 'Checkout Photos',
  RETURN_PHOTO: 'Return Photos',
  DAMAGE_INVOICE: 'Damage Invoice',
  REPAIR_ESTIMATE: 'Repair Estimate',
  REPAIR_INVOICE: 'Repair Invoice',
  COI: 'COI',
  RENTAL_AGREEMENT: 'Rental Agreement',
  POLICE_REPORT: 'Police Report',
  CORRESPONDENCE: 'Correspondence',
  DEMAND_LETTER: 'Demand Letter',
  COUNTER_LETTER: 'Counter Letter',
  SETTLEMENT: 'Settlement',
  OTHER: 'Other',
}

// Singular label for the inline picker dropdown options. ("Photos"
// reads wrong as a single-row label.)
const TYPE_LABEL_SINGULAR: Record<ClaimDocType, string> = {
  ...TYPE_LABEL,
  PHOTO: 'Photo',
  CHECKOUT_PHOTO: 'Checkout Photo',
  RETURN_PHOTO: 'Return Photo',
}

// Order chips appear in. Types present on the claim that aren't in
// this list fall to the end (preserves legacy types' visibility).
const PRIMARY_ORDER: ClaimDocType[] = [
  'PHOTO',
  'DAMAGE_INVOICE',
  'REPAIR_ESTIMATE',
  'COI',
  'RENTAL_AGREEMENT',
  'POLICE_REPORT',
  'CORRESPONDENCE',
  'SETTLEMENT',
  'DEMAND_LETTER',
  'COUNTER_LETTER',
  'CHECKOUT_PHOTO',
  'RETURN_PHOTO',
  'REPAIR_INVOICE',
  'OTHER',
]

const ALL_TYPES: ClaimDocType[] = PRIMARY_ORDER

export interface ClaimDocumentRow {
  id: string
  type: ClaimDocType
  typeSource: 'EMAIL_INGEST' | 'USER' | 'AI_SUGGESTED' | null
  typeConfidence: number | null
  title: string
  fileUrl: string
  notes?: string | null
  createdAt?: string
}

export function TypedDocumentList({
  claimId,
  documents,
  onChanged,
}: {
  claimId: string
  documents: ClaimDocumentRow[]
  onChanged: () => void
}) {
  const [filter, setFilter] = useState<ClaimDocType | null>(null)
  const [patching, setPatching] = useState<Set<string>>(new Set())

  const counts = useMemo(() => {
    const m = new Map<ClaimDocType, number>()
    for (const d of documents) m.set(d.type, (m.get(d.type) ?? 0) + 1)
    return m
  }, [documents])

  const present: ClaimDocType[] = useMemo(() => {
    const ordered: ClaimDocType[] = []
    const seen = new Set<ClaimDocType>()
    for (const t of PRIMARY_ORDER) {
      if (counts.has(t)) { ordered.push(t); seen.add(t) }
    }
    // Any unexpected types (shouldn't happen — enum is closed — but
    // future-proofing) tack on at the end.
    for (const t of counts.keys()) {
      if (!seen.has(t)) ordered.push(t)
    }
    return ordered
  }, [counts])

  const visible = useMemo(
    () => (filter ? documents.filter((d) => d.type === filter) : documents),
    [documents, filter],
  )

  const repick = async (docId: string, type: ClaimDocType) => {
    setPatching((prev) => new Set(prev).add(docId))
    try {
      await fetch(`/api/claims/${claimId}/documents/${docId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type }),
      })
      onChanged()
    } finally {
      setPatching((prev) => {
        const next = new Set(prev)
        next.delete(docId)
        return next
      })
    }
  }

  if (documents.length === 0) return null

  return (
    <div className="space-y-2">
      {/* ── Filter chips ─────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
        <button
          onClick={() => setFilter(null)}
          className={`px-2 py-0.5 rounded-full border ${
            filter === null
              ? 'bg-lt-fg text-white border-lt-fg'
              : 'bg-lt-card text-lt-fg2 border-lt-hairline hover:border-lt-fg2'
          }`}
        >
          All {documents.length}
        </button>
        {present.map((t) => (
          <button
            key={t}
            onClick={() => setFilter(filter === t ? null : t)}
            className={`px-2 py-0.5 rounded-full border ${
              filter === t
                ? 'bg-lt-fg text-white border-lt-fg'
                : 'bg-lt-card text-lt-fg2 border-lt-hairline hover:border-lt-fg2'
            }`}
          >
            {TYPE_LABEL[t]} {counts.get(t)}
          </button>
        ))}
      </div>

      {/* ── List ─────────────────────────────────────────────── */}
      <ul className="space-y-1.5">
        {visible.map((doc) => {
          const isAi = doc.typeSource === 'AI_SUGGESTED'
          const pending = patching.has(doc.id)
          return (
            <li key={doc.id} className="flex items-center gap-2 text-xs">
              <a
                href={doc.fileUrl}
                target="_blank"
                rel="noreferrer"
                className="text-lt-fg hover:text-black underline-offset-2 hover:underline truncate flex-1 min-w-0"
              >
                {doc.title}
              </a>
              {isAi && (
                <span className="text-[10px] text-chip-warn-fg bg-chip-warn-bg px-1.5 py-0.5 rounded shrink-0">
                  AI {doc.typeConfidence != null ? `· ${Math.round(doc.typeConfidence * 100)}%` : ''}
                </span>
              )}
              <select
                value={doc.type}
                onChange={(e) => void repick(doc.id, e.target.value as ClaimDocType)}
                disabled={pending}
                className={`text-[11px] px-1.5 py-0.5 border rounded shrink-0 ${
                  isAi ? 'border-chip-warn-fg/40 bg-chip-warn-bg/30' : 'border-lt-hairline bg-lt-card'
                } disabled:opacity-50`}
              >
                {ALL_TYPES.map((t) => (
                  <option key={t} value={t}>{TYPE_LABEL_SINGULAR[t]}</option>
                ))}
              </select>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
