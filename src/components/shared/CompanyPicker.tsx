'use client'

/**
 * Reusable Company picker — typeahead + inline "create new" option.
 *
 * Mirrors JobPicker's three-mode pattern: `searching` →
 * `selected_existing` | `creating_new`. Component signals intent;
 * the parent form is responsible for either passing `companyId`
 * (existing) or `newCompanyName` (create) to its downstream endpoint.
 *
 * Match logic:
 *   - Live typeahead against /api/crm/companies?search= (debounced).
 *   - Normalized-key match: when the rep types "Rema Films" the
 *     "Rema Films LLC" hit surfaces with a "matches your typed name"
 *     badge — this is the human-surfaced dupe guard. Same
 *     `companyNameKey()` helper used by the create endpoint, so
 *     UI and API can't drift.
 *   - When `recentCompanyIds` is provided, those hits rank first
 *     ("rep's recently-touched companies") above the alphabetical
 *     /api/crm/companies result order.
 */

import { useEffect, useRef, useState } from 'react'
import { companyNameKey } from '@/lib/companies/normalize'

export interface CompanyPickerValue {
  companyId: string | null
  name: string
  mode: 'searching' | 'selected_existing' | 'creating_new'
  /** Picked company's tier (display-only). */
  tier?: string | null
  /** Picked company's COI flag (display-only). */
  coiOnFile?: boolean | null
}

interface CompanyHit {
  id: string
  name: string
  tier: string
  coiOnFile?: boolean
}

interface CompanyPickerProps {
  value: CompanyPickerValue
  onChange: (v: CompanyPickerValue) => void
  /** Companies to rank first in the dropdown — typically the
   *  recognized lead's recent/affiliated companies. */
  recentCompanyIds?: string[]
  placeholder?: string
  allowReset?: boolean
}

const EMPTY: CompanyPickerValue = {
  companyId: null,
  name: '',
  mode: 'searching',
  tier: null,
  coiOnFile: null,
}

export const EMPTY_COMPANY_PICKER_VALUE: CompanyPickerValue = EMPTY

export function CompanyPicker({
  value,
  onChange,
  recentCompanyIds = [],
  placeholder = 'Search companies or type a new name…',
  allowReset = true,
}: CompanyPickerProps) {
  const [query, setQuery] = useState(value.name)
  const [hits, setHits] = useState<CompanyHit[]>([])
  const [open, setOpen] = useState(false)
  const [searching, setSearching] = useState(false)
  const wrapperRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (value.mode !== 'searching') return
    if (query.trim().length < 1) {
      setHits([])
      return
    }
    setSearching(true)
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/crm/companies?search=${encodeURIComponent(query.trim())}`)
        const data = await res.json()
        const rows: CompanyHit[] = (Array.isArray(data.companies) ? data.companies : []).map((c: { id: string; name: string; tier: string; coiOnFile?: boolean }) => ({
          id: c.id, name: c.name, tier: c.tier, coiOnFile: c.coiOnFile,
        }))
        // Rank recently-touched first, then by name length (shorter =
        // more canonical), then alphabetical.
        const recentSet = new Set(recentCompanyIds)
        rows.sort((a, b) => {
          const aRecent = recentSet.has(a.id) ? 1 : 0
          const bRecent = recentSet.has(b.id) ? 1 : 0
          if (aRecent !== bRecent) return bRecent - aRecent
          return a.name.localeCompare(b.name)
        })
        setHits(rows.slice(0, 8))
      } finally {
        setSearching(false)
      }
    }, 200)
    return () => clearTimeout(t)
  }, [query, value.mode, recentCompanyIds])

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!wrapperRef.current) return
      if (!wrapperRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  const pickExisting = (c: CompanyHit) => {
    onChange({
      companyId: c.id,
      name: c.name,
      mode: 'selected_existing',
      tier: c.tier,
      coiOnFile: c.coiOnFile ?? null,
    })
    setQuery(c.name)
    setOpen(false)
  }

  const startCreatingNew = () => {
    const typed = query.trim()
    if (!typed) return
    onChange({
      companyId: null,
      name: typed,
      mode: 'creating_new',
      tier: null,
      coiOnFile: null,
    })
    setOpen(false)
  }

  const reset = () => {
    onChange({ ...EMPTY })
    setQuery('')
    setHits([])
  }

  // Dupe-guard match: when the typed query normalizes to the same
  // key as one of the existing hits, flag that row so the rep sees
  // "matches your typed name" before they hit "+ Create new". Same
  // companyNameKey() used server-side at create time — no drift.
  const typedKey = query.trim() ? companyNameKey(query.trim()) : ''
  const matchedExisting = typedKey ? hits.find((h) => companyNameKey(h.name) === typedKey) : null

  if (value.mode === 'selected_existing') {
    return (
      <div className="flex items-center justify-between border border-emerald-300 bg-emerald-50 rounded-xl px-3 py-2.5">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-gray-900 truncate">{value.name}</div>
          <div className="text-[11px] text-emerald-700">
            Existing company{value.tier && value.tier !== 'STANDARD' ? ` · ${value.tier}` : ''}{value.coiOnFile ? ' · COI' : ''}
          </div>
        </div>
        {allowReset && (
          <button type="button" onClick={reset} className="text-xs text-gray-500 hover:text-gray-700 ml-2 flex-shrink-0">
            Change
          </button>
        )}
      </div>
    )
  }

  if (value.mode === 'creating_new') {
    return (
      <div className="flex items-center justify-between border border-blue-300 bg-blue-50 rounded-xl px-3 py-2.5">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-gray-900 truncate">{value.name}</div>
          <div className="text-[11px] text-blue-700">New company — will be created on submit</div>
        </div>
        {allowReset && (
          <button type="button" onClick={reset} className="text-xs text-gray-500 hover:text-gray-700 ml-2 flex-shrink-0">
            Change
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="relative" ref={wrapperRef}>
      <input
        type="text"
        autoComplete="off"
        name=""
        value={query}
        onChange={(e) => { setQuery(e.target.value); setOpen(true) }}
        onFocus={() => query.length >= 1 && setOpen(true)}
        placeholder={placeholder}
        className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-gray-400"
      />
      {open && query.trim().length > 0 && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-lg z-10 overflow-hidden">
          {searching && hits.length === 0 ? (
            <div className="px-4 py-2.5 text-xs text-gray-400">Searching…</div>
          ) : null}
          {hits.map((c) => {
            const isMatch = matchedExisting?.id === c.id
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => pickExisting(c)}
                className={`w-full text-left px-4 py-2.5 hover:bg-gray-50 border-b border-gray-50 last:border-0 ${isMatch ? 'bg-amber-50' : ''}`}
              >
                <div className="text-sm font-semibold text-gray-900 truncate">{c.name}</div>
                <div className="text-[10px] text-gray-400">
                  {c.tier !== 'STANDARD' ? `${c.tier}` : 'standard'}
                  {c.coiOnFile ? ' · COI on file' : ''}
                  {isMatch && <span className="ml-2 text-amber-700 font-semibold">matches your typed name</span>}
                </div>
              </button>
            )
          })}
          <button
            type="button"
            onClick={startCreatingNew}
            className="w-full text-left px-4 py-2.5 bg-gray-50 hover:bg-gray-100 border-t border-gray-100"
          >
            <div className="text-sm font-semibold text-blue-700">
              + Create new company: &ldquo;{query.trim()}&rdquo;
            </div>
            <div className="text-[10px] text-gray-500">
              {matchedExisting
                ? `Heads up — "${matchedExisting.name}" already exists with the same normalized name. Pick it above unless this is genuinely different.`
                : 'Creates a new Company when this form is submitted'}
            </div>
          </button>
        </div>
      )}
    </div>
  )
}
