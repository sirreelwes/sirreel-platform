"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Reusable contact (Person) picker with typeahead + inline "add new" option.
 *
 * Modes:
 *   - searching        — user is typing; dropdown shows matches and a
 *                        "+ Add new contact: '<typed>'" entry at the bottom.
 *   - selected_existing — user picked an existing CRM contact. Phone and
 *                        email are surfaced read-only via the parent.
 *   - creating_new      — user clicked the "Add new contact" entry. Parent
 *                        renders editable phone + email fields.
 *
 * The component itself does NOT create the contact — it only signals
 * intent. The parent submits the new contact as part of its own form
 * (single-shot, no nested modal) so the new contact lands in CRM as a
 * side-effect of completing the parent flow.
 *
 * autoComplete="off" + name="" deliberately disables Chrome's heuristic
 * autofill, which otherwise populates fields labelled "Name" with the
 * logged-in user's profile (the bug that prompted this component).
 */

export interface ContactPickerValue {
  /** id of the selected existing Person, when mode === 'selected_existing'. */
  personId: string | null
  /** Free-text name. In creating_new mode, this is the new contact's name. */
  name: string
  /** Pulled from CRM in selected_existing mode; editable elsewhere. */
  phone: string
  email: string
  /** What the parent should do on form submit. */
  mode: 'searching' | 'selected_existing' | 'creating_new'
  /** Optional company association from the matched Person row. */
  company?: { id: string; name: string } | null
}

interface PersonHit {
  id: string
  firstName: string
  lastName: string
  email: string | null
  phone: string | null
  company: { id: string; name: string } | null
}

interface ContactPickerProps {
  value: ContactPickerValue
  onChange: (v: ContactPickerValue) => void
  placeholder?: string
  /** Show a small "+ Change" affordance once a contact is selected/creating. */
  allowReset?: boolean
}

const EMPTY: ContactPickerValue = {
  personId: null,
  name: '',
  phone: '',
  email: '',
  mode: 'searching',
  company: null,
}

export function ContactPicker({
  value,
  onChange,
  placeholder = 'Search by name or email…',
  allowReset = true,
}: ContactPickerProps) {
  const [query, setQuery] = useState(value.name)
  const [hits, setHits] = useState<PersonHit[]>([])
  const [open, setOpen] = useState(false)
  const [searching, setSearching] = useState(false)
  const wrapperRef = useRef<HTMLDivElement>(null)

  // No external→local sync effect here. The earlier version had one that
  // wiped local `query` whenever parent's `value.name` was empty during
  // searching mode — but the parent only learns the name after a pick or
  // create, so the parent's value.name stays '' during typing and the
  // effect fired on every keystroke, clearing the input. The picker now
  // fully owns its query state during searching; pickExisting, startCreating,
  // and reset() are the only paths that mutate it back to a known value.

  // Debounced typeahead against /api/persons?q=
  useEffect(() => {
    if (value.mode !== 'searching') return
    if (query.trim().length < 1) {
      setHits([])
      return
    }
    setSearching(true)
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/persons?q=${encodeURIComponent(query)}`)
        const data = await res.json()
        setHits(data.persons || [])
      } finally {
        setSearching(false)
      }
    }, 200)
    return () => clearTimeout(t)
  }, [query, value.mode])

  // Click-outside collapses the dropdown.
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!wrapperRef.current) return
      if (!wrapperRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  const pickExisting = (p: PersonHit) => {
    onChange({
      personId: p.id,
      name: `${p.firstName} ${p.lastName}`.trim(),
      phone: p.phone || '',
      email: p.email || '',
      mode: 'selected_existing',
      company: p.company,
    })
    setQuery(`${p.firstName} ${p.lastName}`.trim())
    setOpen(false)
  }

  const startCreatingNew = () => {
    const typed = query.trim()
    if (!typed) return
    onChange({
      personId: null,
      name: typed,
      phone: '',
      email: '',
      mode: 'creating_new',
      company: null,
    })
    setOpen(false)
  }

  const reset = () => {
    onChange({ ...EMPTY })
    setQuery('')
    setHits([])
  }

  // Selected-existing pill
  if (value.mode === 'selected_existing') {
    return (
      <div className="flex items-center justify-between border border-emerald-300 bg-emerald-50 rounded-xl px-3 py-2.5">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-gray-900 truncate">{value.name}</div>
          <div className="text-[11px] text-emerald-700">
            From CRM{value.company ? ` · ${value.company.name}` : ''}
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

  // Creating-new pill
  if (value.mode === 'creating_new') {
    return (
      <div className="flex items-center justify-between border border-blue-300 bg-blue-50 rounded-xl px-3 py-2.5">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-gray-900 truncate">{value.name}</div>
          <div className="text-[11px] text-blue-700">New contact — will be added to CRM on submit</div>
        </div>
        {allowReset && (
          <button type="button" onClick={reset} className="text-xs text-gray-500 hover:text-gray-700 ml-2 flex-shrink-0">
            Change
          </button>
        )}
      </div>
    )
  }

  // Searching mode — text input + dropdown
  return (
    <div className="relative" ref={wrapperRef}>
      <input
        type="text"
        // Don't let Chrome populate this from the saved user profile.
        autoComplete="off"
        name=""
        value={query}
        onChange={(e) => {
          setQuery(e.target.value)
          setOpen(true)
        }}
        onFocus={() => query.length >= 1 && setOpen(true)}
        placeholder={placeholder}
        className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-gray-400"
      />
      {open && query.trim().length > 0 && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-lg z-10 overflow-hidden">
          {searching && hits.length === 0 ? (
            <div className="px-4 py-2.5 text-xs text-gray-400">Searching…</div>
          ) : null}
          {hits.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => pickExisting(p)}
              className="w-full text-left px-4 py-2.5 hover:bg-gray-50 border-b border-gray-50 last:border-0"
            >
              <div className="text-sm font-semibold text-gray-900">
                {p.firstName} {p.lastName}
              </div>
              <div className="text-[10px] text-gray-400">
                {p.email || '(no email)'}
                {p.company ? ` · ${p.company.name}` : ''}
              </div>
            </button>
          ))}
          {/* Always show the "+ Add new" footer when there's a non-empty
              query so the user has a clear path to create on no match,
              without forcing them to wait for search to finish. */}
          <button
            type="button"
            onClick={startCreatingNew}
            className="w-full text-left px-4 py-2.5 bg-gray-50 hover:bg-gray-100 border-t border-gray-100"
          >
            <div className="text-sm font-semibold text-blue-700">
              + Add new contact: &ldquo;{query.trim()}&rdquo;
            </div>
            <div className="text-[10px] text-gray-500">Creates a new CRM contact when this form is submitted</div>
          </button>
        </div>
      )}
    </div>
  )
}

export const EMPTY_CONTACT_PICKER_VALUE: ContactPickerValue = EMPTY
