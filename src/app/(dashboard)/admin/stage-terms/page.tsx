'use client'

/**
 * /admin/stage-terms — Stage Contract Terms tool.
 *
 * Stage rates are individually negotiated, so before a client can sign
 * the studio contract in the v2 portal a SirReel agent sets the terms
 * here: rate + areas (sets), plus day counts and notes. Selecting the
 * Hospital Set automatically folds the Stryker addendum into the
 * client's contract and requires their explicit acknowledgment.
 *
 * Backed by GET /api/paperwork/stage-requests (list) and
 * GET/PUT /api/paperwork/[token]/stage-terms (editor). Terms lock once
 * the contract is signed.
 */

import { useEffect, useState } from 'react'
import { STAGE_AREAS, STRYKER_TRIGGER_KEY, isRetiredAreaKey, stageAreaLabel } from '@/lib/contracts/stageAreas'

interface Row {
  token: string
  sentTo: string
  sentAt: string
  contractType: string
  jobName: string
  company: string
  startDate: string | null
  endDate: string | null
  signed: boolean
  termsReady: boolean
  strykerRequired: boolean
  sets: string[]
  ratePerDay: string
}

const fmt = (d: string | null) => (d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—')

function StatusChip({ row }: { row: Row }) {
  if (row.signed) return <span className="text-[10px] font-bold px-2 py-0.5 rounded-lg bg-emerald-100 text-emerald-700">✓ Signed</span>
  if (row.termsReady) return <span className="text-[10px] font-bold px-2 py-0.5 rounded-lg bg-blue-100 text-blue-700">Ready to sign</span>
  return <span className="text-[10px] font-bold px-2 py-0.5 rounded-lg bg-amber-100 text-amber-700">⚠ Terms needed</span>
}

export default function StageTermsPage() {
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<Row | null>(null)

  // Editor state
  const [sets, setSets] = useState<string[]>([])
  const [prelitSets, setPrelitSets] = useState<string[]>([])
  const [ratePerDay, setRatePerDay] = useState('')
  const [otRate, setOtRate] = useState('300')
  const [prepDays, setPrepDays] = useState('')
  const [shootDays, setShootDays] = useState('')
  const [strikeDays, setStrikeDays] = useState('')
  const [darkDays, setDarkDays] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [emailSentAt, setEmailSentAt] = useState<string | null>(null)
  const [resending, setResending] = useState(false)

  const load = () => {
    setLoading(true)
    fetch('/api/paperwork/stage-requests')
      .then((r) => r.json())
      .then((d) => setRows(d.requests || []))
      .finally(() => setLoading(false))
  }
  useEffect(load, [])

  const openEditor = async (row: Row) => {
    setSelected(row)
    setMessage('')
    const r = await fetch(`/api/paperwork/${row.token}/stage-terms`)
    const d = await r.json()
    const sd = d.stageDetails || {}
    setSets(Array.isArray(sd.sets) ? sd.sets : [])
    setPrelitSets(Array.isArray(sd.prelitSets) ? sd.prelitSets : [])
    setRatePerDay(sd.ratePerDay || '')
    setOtRate(sd.otRate || '300')
    setPrepDays(sd.prepDays || '')
    setShootDays(sd.shootDays || '')
    setStrikeDays(sd.strikeDays || '')
    setDarkDays(sd.darkDays || '')
    setNotes(sd.notes || '')
    setEmailSentAt(d.readyToSignEmailSentAt || null)
  }

  const toggleSet = (key: string) => {
    setSets((cur) => (cur.includes(key) ? cur.filter((s) => s !== key) : [...cur, key]))
    setPrelitSets((cur) => cur.filter((s) => s !== key || sets.includes(key) === false))
  }

  const save = async () => {
    if (!selected) return
    setSaving(true)
    setMessage('')
    try {
      const r = await fetch(`/api/paperwork/${selected.token}/stage-terms`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sets, prelitSets, ratePerDay, otRate, prepDays, shootDays, strikeDays, darkDays, notes }),
      })
      const d = await r.json()
      if (!r.ok) {
        setMessage(d.error || 'Save failed')
        return
      }
      let msg = d.termsReady
        ? `Saved — the studio contract is now signable in the client portal.${d.strykerRequired ? ' The Stryker Master Media Use Agreement will be required and separately signed (Hospital Set).' : ''}`
        : 'Saved, but the contract is still NOT signable — it needs at least one area and a day rate.'
      if (d.readyEmail?.sent) {
        msg += ` ✉️ Ready-to-sign email sent to ${d.readyEmail.to}.`
        setEmailSentAt(d.readyEmail.sentAt || null)
      } else if (d.readyEmail && !d.readyEmail.sent) {
        msg += ` ⚠️ Client email NOT sent: ${d.readyEmail.reason}.`
      }
      if (d.readyToSignEmailSentAt) setEmailSentAt(d.readyToSignEmailSentAt)
      setMessage(msg)
      load()
    } finally {
      setSaving(false)
    }
  }

  const termsWouldBeReady = sets.length > 0 && !!ratePerDay.trim()

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">Stage contract terms</h1>
        <p className="text-sm text-gray-500 mt-1">
          Set each job&rsquo;s negotiated rate and areas — the client can&rsquo;t sign the studio contract until this is done. Hospital Set adds
          the Stryker Master Media Use Agreement automatically (separately signed by the client).
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Request list */}
        <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 text-sm font-semibold text-gray-700">Stage paperwork requests</div>
          {loading ? (
            <div className="p-6 text-sm text-gray-400">Loading…</div>
          ) : rows.length === 0 ? (
            <div className="p-6 text-sm text-gray-400">No stage or stage+vehicles paperwork requests yet.</div>
          ) : (
            <div className="divide-y divide-gray-100 max-h-[540px] overflow-y-auto">
              {rows.map((row) => (
                <button
                  key={row.token}
                  onClick={() => openEditor(row)}
                  className={`w-full text-left px-4 py-3 hover:bg-gray-50 transition-colors ${selected?.token === row.token ? 'bg-gray-50' : ''}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-sm font-semibold text-gray-900 truncate">{row.jobName || row.sentTo}</div>
                    <StatusChip row={row} />
                  </div>
                  <div className="text-xs text-gray-500 mt-0.5">
                    {row.company && `${row.company} · `}
                    {fmt(row.startDate)} – {fmt(row.endDate)} · sent to {row.sentTo}
                  </div>
                  {row.termsReady && !row.signed && (
                    <div className="text-[11px] text-gray-400 mt-0.5">
                      ${row.ratePerDay}/day · {row.sets.length} area{row.sets.length === 1 ? '' : 's'}
                      {row.strykerRequired ? ' · Stryker' : ''}
                    </div>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Editor */}
        <div className="rounded-xl border border-gray-200 bg-white p-5">
          {!selected ? (
            <div className="text-sm text-gray-400 py-12 text-center">Select a request to set its terms.</div>
          ) : (
            <div className="space-y-4">
              <div>
                <div className="text-sm font-semibold text-gray-900">{selected.jobName || selected.sentTo}</div>
                <div className="text-xs text-gray-500">
                  {selected.company} · portal token <span className="font-mono">{selected.token.slice(0, 8)}…</span>
                </div>
              </div>

              {selected.signed ? (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
                  This studio contract is already signed — terms are locked.
                </div>
              ) : (
                <>
                  <div>
                    <div className="text-[11px] font-semibold text-gray-600 mb-2">Areas to be used *</div>
                    {sets.some(isRetiredAreaKey) && (
                      <div className="mb-2 rounded-lg border border-amber-200 bg-amber-50 p-2 text-[11px] text-amber-700">
                        This job was saved with retired area{sets.filter(isRetiredAreaKey).length > 1 ? 's' : ''}:{' '}
                        <span className="font-semibold">{sets.filter(isRetiredAreaKey).map(stageAreaLabel).join(', ')}</span>. They stay on
                        the record until you re-save — selecting from the current list below replaces them.
                      </div>
                    )}
                    <div className="space-y-2">
                      {STAGE_AREAS.map((opt) => (
                        <div key={opt.key} className="flex items-center gap-4">
                          <label className="flex items-center gap-2 cursor-pointer flex-1">
                            <input type="checkbox" checked={sets.includes(opt.key)} onChange={() => toggleSet(opt.key)} className="w-4 h-4 accent-gray-900" />
                            <span className="text-sm text-gray-800">{opt.label}</span>
                            {opt.key === STRYKER_TRIGGER_KEY && sets.includes(STRYKER_TRIGGER_KEY) && (
                              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">+ Stryker agreement</span>
                            )}
                          </label>
                          {sets.includes(opt.key) && (
                            <label className="flex items-center gap-1.5 cursor-pointer text-xs text-gray-500">
                              <input
                                type="checkbox"
                                checked={prelitSets.includes(opt.key)}
                                onChange={() =>
                                  setPrelitSets((cur) => (cur.includes(opt.key) ? cur.filter((s) => s !== opt.key) : [...cur, opt.key]))
                                }
                                className="w-3.5 h-3.5 accent-gray-900"
                              />
                              Pre-lit
                            </label>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[11px] font-semibold text-gray-600 mb-1 block">Rate per day ($) *</label>
                      <input value={ratePerDay} onChange={(e) => setRatePerDay(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gray-400" placeholder="e.g. 4500" />
                    </div>
                    <div>
                      <label className="text-[11px] font-semibold text-gray-600 mb-1 block">OT rate ($/hr)</label>
                      <input value={otRate} onChange={(e) => setOtRate(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gray-400" />
                    </div>
                    <div>
                      <label className="text-[11px] font-semibold text-gray-600 mb-1 block">Prep days</label>
                      <input value={prepDays} onChange={(e) => setPrepDays(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gray-400" />
                    </div>
                    <div>
                      <label className="text-[11px] font-semibold text-gray-600 mb-1 block">Shoot days</label>
                      <input value={shootDays} onChange={(e) => setShootDays(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gray-400" />
                    </div>
                    <div>
                      <label className="text-[11px] font-semibold text-gray-600 mb-1 block">Strike days</label>
                      <input value={strikeDays} onChange={(e) => setStrikeDays(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gray-400" />
                    </div>
                    <div>
                      <label className="text-[11px] font-semibold text-gray-600 mb-1 block">Dark days</label>
                      <input value={darkDays} onChange={(e) => setDarkDays(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gray-400" />
                    </div>
                  </div>

                  <div>
                    <label className="text-[11px] font-semibold text-gray-600 mb-1 block">Notes (shown on the contract)</label>
                    <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gray-400 resize-none" />
                  </div>

                  <div className={`rounded-lg p-3 text-xs ${termsWouldBeReady ? 'bg-blue-50 border border-blue-200 text-blue-700' : 'bg-amber-50 border border-amber-200 text-amber-700'}`}>
                    {termsWouldBeReady
                      ? `On save, the studio contract becomes signable in the client portal${sets.includes(STRYKER_TRIGGER_KEY) ? ' with the Stryker Master Media Use Agreement required' : ''}.`
                      : 'Needs at least one area and a day rate before the client can sign.'}
                  </div>

                  {message && <div className="text-xs text-gray-700 bg-gray-50 border border-gray-200 rounded-lg p-2.5">{message}</div>}

                  <button
                    onClick={save}
                    disabled={saving}
                    className="w-full py-2.5 bg-gray-900 hover:bg-gray-800 disabled:opacity-40 text-white rounded-xl text-sm font-semibold"
                  >
                    {saving ? 'Saving…' : 'Save terms'}
                  </button>

                  {(selected.termsReady || termsWouldBeReady) && (
                    <div className="flex items-center justify-between gap-3 pt-1">
                      <div className="text-[11px] text-gray-400">
                        {emailSentAt
                          ? `Ready-to-sign email sent ${new Date(emailSentAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`
                          : 'Client has not been emailed yet'}
                      </div>
                      <button
                        onClick={async () => {
                          setResending(true)
                          setMessage('')
                          try {
                            const r = await fetch(`/api/paperwork/${selected.token}/resend-signing-link`, { method: 'POST' })
                            const d = await r.json()
                            if (d.sent) {
                              setEmailSentAt(d.sentAt || null)
                              setMessage(`✉️ Signing link ${emailSentAt ? 're-sent' : 'sent'} to ${d.to}.`)
                            } else {
                              setMessage(`⚠️ Not sent: ${d.reason}`)
                            }
                          } finally {
                            setResending(false)
                          }
                        }}
                        disabled={resending}
                        className="flex-shrink-0 py-1.5 px-3 border border-gray-200 rounded-lg text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-40"
                      >
                        {resending ? 'Sending…' : emailSentAt ? 'Resend signing link' : 'Send signing link'}
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
