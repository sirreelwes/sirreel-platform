'use client'

/**
 * "Keep me posted" — the executive's own notification elections.
 *
 * Wes 2026-09-04: "an option for what notifications they would like: Job
 * Start, Invoices Paid and job closed, etc."
 *
 * Saves on change rather than behind a Save button. There are five controls
 * and no destructive one among them; a Save button here would mostly serve
 * to let people leave without their choice taking effect. Each toggle
 * reverts itself if the write fails, so the switch never shows a state the
 * server doesn't hold.
 */

import { useState } from 'react'
import { Check, Loader2 } from 'lucide-react'

type Cadence = 'IMMEDIATE' | 'WEEKLY' | 'NONE'

export interface NotificationPrefs {
  notifyJobStart: boolean
  notifyInvoicePaid: boolean
  notifyJobClosed: boolean
  notifyQuoteSent: boolean
  cadence: Cadence
}

const EVENTS: { key: keyof Omit<NotificationPrefs, 'cadence'>; label: string; hint: string }[] = [
  {
    key: 'notifyJobStart',
    label: 'A show starts',
    hint: 'The morning gear goes out on one of your productions.',
  },
  {
    key: 'notifyInvoicePaid',
    label: 'An invoice is paid',
    hint: 'Confirmation when a payment clears against one of your shows.',
  },
  {
    key: 'notifyJobClosed',
    label: 'A show closes out',
    hint: 'Everything returned and the job wrapped on our side.',
  },
  {
    key: 'notifyQuoteSent',
    label: 'A quote goes out',
    hint: 'Your teams request a lot of these — off by default.',
  },
]

const CADENCES: { value: Cadence; label: string; hint: string }[] = [
  { value: 'IMMEDIATE', label: 'As it happens', hint: 'One email per event' },
  { value: 'WEEKLY', label: 'Weekly summary', hint: 'One email on Monday' },
  { value: 'NONE', label: 'Nothing for now', hint: 'Keeps your choices above' },
]

export function NotificationSettings({
  companyId,
  initial,
}: {
  companyId: string
  initial: NotificationPrefs
}) {
  const [prefs, setPrefs] = useState<NotificationPrefs>(initial)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save(patch: Partial<NotificationPrefs>) {
    const before = prefs
    setPrefs({ ...prefs, ...patch })
    setSaving(true)
    setError(null)
    setSaved(false)
    try {
      const res = await fetch(`/api/portal/company/${companyId}/notifications`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      if (!res.ok) throw new Error('save failed')
      const json = await res.json()
      if (json?.settings) setPrefs(json.settings)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch {
      // Put the switch back where the server still has it.
      setPrefs(before)
      setError("That didn't save. Try again in a moment.")
    } finally {
      setSaving(false)
    }
  }

  const muted = prefs.cadence === 'NONE'

  return (
    <div className="bg-white border border-zinc-200 rounded-xl overflow-hidden">
      <div className="p-5 border-b border-zinc-100">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-zinc-600 leading-relaxed max-w-[58ch]">
            Choose what SirReel emails you about your account. This is yours alone — it
            doesn&apos;t change what your coordinators receive on their own shows.
          </p>
          <div className="shrink-0 text-xs text-zinc-400 flex items-center gap-1.5">
            {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            {saved && !saving && (
              <span className="inline-flex items-center gap-1 text-emerald-700">
                <Check className="w-3.5 h-3.5" /> Saved
              </span>
            )}
          </div>
        </div>
        {error && <p className="text-xs text-red-700 mt-2">{error}</p>}
      </div>

      <div className="divide-y divide-zinc-100">
        {EVENTS.map((ev) => (
          <label
            key={ev.key}
            className={`flex items-start gap-3 p-4 cursor-pointer ${muted ? 'opacity-50' : ''}`}
          >
            <input
              type="checkbox"
              className="mt-0.5 w-4 h-4 accent-zinc-900 shrink-0"
              checked={prefs[ev.key]}
              onChange={(e) => save({ [ev.key]: e.target.checked } as Partial<NotificationPrefs>)}
            />
            <span className="min-w-0">
              <span className="block text-sm font-medium text-zinc-900">{ev.label}</span>
              <span className="block text-xs text-zinc-500 mt-0.5">{ev.hint}</span>
            </span>
          </label>
        ))}
      </div>

      <div className="p-4 bg-zinc-50 border-t border-zinc-100">
        <div className="text-[11px] uppercase font-semibold tracking-wider text-zinc-400 mb-2">
          How often
        </div>
        <div className="grid sm:grid-cols-3 gap-2">
          {CADENCES.map((c) => (
            <button
              key={c.value}
              type="button"
              onClick={() => save({ cadence: c.value })}
              className={`text-left rounded-lg border px-3 py-2.5 transition-colors ${
                prefs.cadence === c.value
                  ? 'border-zinc-900 bg-white'
                  : 'border-zinc-200 bg-white hover:border-zinc-400'
              }`}
            >
              <div className="text-sm font-medium text-zinc-900">{c.label}</div>
              <div className="text-[11px] text-zinc-500 mt-0.5">{c.hint}</div>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
