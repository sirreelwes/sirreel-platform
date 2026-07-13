'use client'

import { useEffect, useState } from 'react'
import { formatPhone } from '@/lib/format/phone'
import { TSX } from '@/lib/brand/tsxTokens'
import type { V2Intake } from './types'

/**
 * DetailsCard — the "collect-once" intake at the top of the v2 portal.
 * Captured once, persisted via /api/portal/v2/[token]/intake, and threaded
 * into every document card below so the client never re-enters it.
 */

function Field({
  label,
  value,
  onChange,
  type = 'text',
  placeholder,
  required,
  className = '',
}: {
  label: string
  value: string
  onChange: (v: string) => void
  type?: string
  placeholder?: string
  required?: boolean
  className?: string
}) {
  return (
    <div className={className}>
      <label className="text-[11px] font-semibold text-gray-600 mb-1 block">
        {label}
        {required && ' *'}
      </label>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-gray-400"
      />
    </div>
  )
}

export function intakeComplete(i: V2Intake): boolean {
  return !!(i.fullName.trim() && i.email.trim())
}

export function DetailsCard({
  intake,
  persisted,
  onSave,
  open,
  onToggle,
}: {
  intake: V2Intake
  /** True once the intake has actually been saved server-side — pre-filled
   *  but unsaved details show "Confirm" instead of "Saved". */
  persisted: boolean
  onSave: (next: V2Intake) => Promise<boolean>
  open: boolean
  onToggle: () => void
}) {
  const [draft, setDraft] = useState<V2Intake>(intake)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // Re-seed the draft when the persisted intake loads/changes upstream.
  useEffect(() => setDraft(intake), [intake])

  const set = (k: keyof V2Intake) => (v: string) => setDraft((d) => ({ ...d, [k]: v }))
  const complete = intakeComplete(intake)

  return (
    <div className={`bg-white rounded-2xl border transition-all ${open ? 'border-gray-300 shadow-sm' : 'border-gray-200'}`}>
      <button type="button" onClick={onToggle} className="w-full flex items-center gap-3 p-4 text-left">
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-lg flex-shrink-0 ${complete ? 'bg-emerald-50' : 'bg-gray-50'}`}>
          {complete ? '✓' : '👤'}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-bold text-gray-900">Your details</div>
          <div className="text-[11px] text-gray-400 mt-0.5 truncate">
            {complete
              ? `${intake.fullName}${intake.company ? ` · ${intake.company}` : ''} · ${intake.email}`
              : 'Enter once — we fill it into every document below'}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {persisted && complete ? (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-emerald-200 bg-emerald-50 text-emerald-700 text-[10px] font-bold uppercase tracking-wide">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
              Saved
            </span>
          ) : (
            <span
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[10px] font-bold uppercase tracking-wide"
              style={{ borderColor: TSX.gold, color: '#8a6a1f', backgroundColor: 'rgba(212,165,71,0.10)' }}
            >
              {complete ? 'Confirm' : 'Start here'}
            </span>
          )}
          <span className={`text-gray-300 text-xs transition-transform ${open ? 'rotate-180' : ''}`}>▼</span>
        </div>
      </button>

      {open && (
        <div className="px-4 pb-4 border-t border-gray-100 pt-4 space-y-4">
          <div>
            <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">Contact</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Full Name" value={draft.fullName} onChange={set('fullName')} required />
              <Field label="Title" value={draft.title} onChange={set('title')} placeholder="e.g. Production Coordinator" />
              <Field label="Company" value={draft.company} onChange={set('company')} />
              <Field label="Email" type="email" value={draft.email} onChange={set('email')} required />
              <Field label="Phone" value={draft.phone} onChange={(v) => set('phone')(formatPhone(v))} />
            </div>
          </div>
          <div>
            <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">Billing address</div>
            <div className="space-y-2">
              <Field label="Address Line 1" value={draft.billingAddress1} onChange={set('billingAddress1')} />
              <Field label="Address Line 2" value={draft.billingAddress2} onChange={set('billingAddress2')} placeholder="Optional" />
              <div className="grid grid-cols-3 gap-2">
                <Field label="City" value={draft.billingCity} onChange={set('billingCity')} />
                <Field label="State" value={draft.billingState} onChange={set('billingState')} />
                <Field label="ZIP" value={draft.billingZip} onChange={set('billingZip')} />
              </div>
            </div>
          </div>
          {error && <div className="text-[11px] text-red-600">{error}</div>}
          <button
            type="button"
            onClick={async () => {
              setError('')
              if (!draft.fullName.trim() || !draft.email.trim()) {
                setError('Name and email are required.')
                return
              }
              setSaving(true)
              try {
                const ok = await onSave(draft)
                if (!ok) setError('Could not save your details — please try again.')
              } finally {
                setSaving(false)
              }
            }}
            disabled={saving}
            className="w-full py-3 rounded-xl text-sm font-semibold text-white disabled:opacity-40"
            style={{ backgroundColor: TSX.ink }}
          >
            {saving ? 'Saving…' : 'Save my details'}
          </button>
        </div>
      )}
    </div>
  )
}
