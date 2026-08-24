'use client'

/**
 * Schedule a delivery/pickup — the standalone DispatchTask create modal,
 * opened from the shell "+ New → Schedule Delivery/Pickup" entry. No
 * order context: type + logistics are entered by hand. POSTs to
 * /api/scheduling/dispatch-tasks (orderId null); the task lands
 * PENDING/unassigned in the gantt needs-assignment lane on its day.
 * Gated server-side on canCreateBooking.
 *
 * 2026-08-24 (Wes) — four additions so a standalone task carries the
 * context dispatch actually reads:
 *   · TITLE — "Delivery of Honda Generator". The board previously
 *     showed a bare address; the title says what is moving.
 *   · JOB link — via the shared JobResolverModal (same picker as the
 *     hold flow), so a generator drop is attached to the job it serves.
 *   · CONTACT — picking the job pre-fills its primary contact and
 *     stores the Person id; the loose name/phone stay editable for
 *     site contacts who aren't in the CRM.
 *   · ADDRESS SEARCH — typeahead against /api/geo/address-search.
 *     Free text still submits: sets are routinely at unaddressed
 *     locations, so the picker assists and never gates.
 */
import { useEffect, useRef, useState } from 'react'
import { JobResolverModal, type ResolvedJob } from '@/components/shared/JobResolverModal'

interface NewTaskModalProps {
  onClose: () => void
  onCreated: () => void
}

interface AddressHit {
  label: string
  value: string
  lat: string | null
  lon: string | null
}

export function NewTaskModal({ onClose, onCreated }: NewTaskModalProps) {
  const [type, setType] = useState<'DELIVERY' | 'PICKUP'>('DELIVERY')
  const [title, setTitle] = useState('')
  const [scheduledDate, setScheduledDate] = useState('')
  const [scheduledTime, setScheduledTime] = useState('')
  const [siteAddress, setSiteAddress] = useState('')
  const [contactName, setContactName] = useState('')
  const [contactPhone, setContactPhone] = useState('')
  const [personId, setPersonId] = useState<string | null>(null)
  const [deliveryItems, setDeliveryItems] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  // Job linkage
  const [job, setJob] = useState<{ id: string; jobCode: string; name: string } | null>(null)
  const [showResolver, setShowResolver] = useState(false)

  // Address typeahead
  const [addrHits, setAddrHits] = useState<AddressHit[]>([])
  const [addrOpen, setAddrOpen] = useState(false)
  const [addrLoading, setAddrLoading] = useState(false)
  // Suppresses the search that would otherwise fire from setSiteAddress()
  // right after a pick (or a job-driven prefill).
  const skipNextSearch = useRef(false)

  useEffect(() => {
    if (skipNextSearch.current) {
      skipNextSearch.current = false
      return
    }
    const q = siteAddress.trim()
    if (q.length < 4) {
      setAddrHits([])
      return
    }
    // Debounced — Nominatim asks callers not to fire per keystroke.
    const t = setTimeout(() => {
      setAddrLoading(true)
      fetch(`/api/geo/address-search?q=${encodeURIComponent(q)}`)
        .then((r) => r.json())
        .then((d) => {
          setAddrHits(Array.isArray(d.results) ? d.results : [])
          setAddrOpen(true)
        })
        .catch(() => setAddrHits([]))
        .finally(() => setAddrLoading(false))
    }, 400)
    return () => clearTimeout(t)
  }, [siteAddress])

  // Picking a job pulls its primary contact in, so the common case is a
  // pre-filled form the dispatcher just confirms.
  async function onJobResolved(resolved: ResolvedJob) {
    setJob({ id: resolved.id, jobCode: resolved.jobCode, name: resolved.name })
    setShowResolver(false)
    try {
      const r = await fetch(`/api/jobs/${resolved.id}`)
      if (!r.ok) return
      const d = await r.json()
      const c = d.job?.primaryContact ?? d.primaryContact ?? null
      if (c) {
        const full = [c.firstName, c.lastName].filter(Boolean).join(' ').trim()
        if (full && !contactName) setContactName(full)
        const phone = c.mobile || c.phone
        if (phone && !contactPhone) setContactPhone(phone)
        if (c.id) setPersonId(c.id)
      }
    } catch {
      // Contact prefill is a convenience; never block the form on it.
    }
  }

  async function submit() {
    if (!scheduledDate) { setErr('Date is required.'); return }
    if (!siteAddress.trim()) { setErr('Site address is required.'); return }
    setSaving(true)
    setErr(null)
    try {
      const res = await fetch('/api/scheduling/dispatch-tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type, title: title.trim() || null, scheduledDate, scheduledTime, siteAddress,
          contactName, contactPhone, deliveryItems, notes,
          jobId: job?.id ?? null, personId,
        }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok || !d.ok) throw new Error(d.reason || d.error || `Create failed (${res.status})`)
      onCreated()
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  const isDelivery = type === 'DELIVERY'
  const input = 'mt-1 w-full px-2 py-1.5 border border-gray-300 rounded-lg text-gray-900 placeholder:text-gray-400'

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => { if (!saving) onClose() }}>
        <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-6" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-baseline justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-900">Schedule {isDelivery ? 'delivery' : 'pickup'}</h2>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-xl leading-none">×</button>
          </div>
          <div className="space-y-3 text-sm">
            {/* Type toggle */}
            <div className="flex items-center gap-1">
              {(['DELIVERY', 'PICKUP'] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setType(t)}
                  className={`text-[12px] font-semibold px-3 py-1.5 rounded border ${type === t ? 'bg-zinc-800 text-white border-zinc-800' : 'border-zinc-300 text-zinc-700 hover:bg-zinc-50'}`}
                >
                  {t === 'DELIVERY' ? 'Delivery' : 'Pickup'}
                </button>
              ))}
            </div>

            <label className="block">
              <span className="text-xs text-gray-500">Title</span>
              <input
                type="text" value={title} onChange={(e) => setTitle(e.target.value)}
                placeholder={isDelivery ? 'e.g. Delivery of Honda Generator' : 'e.g. Pickup of Honda Generator'}
                className={input}
              />
            </label>

            {/* Job link */}
            <div className="block">
              <span className="text-xs text-gray-500">Job (optional)</span>
              {job ? (
                <div className="mt-1 flex items-center justify-between gap-2 px-2 py-1.5 border border-gray-300 rounded-lg">
                  <span className="text-gray-900 truncate">
                    <span className="font-mono text-[11px] text-gray-500">{job.jobCode}</span>{' '}{job.name}
                  </span>
                  <span className="flex items-center gap-2 shrink-0">
                    <button onClick={() => setShowResolver(true)} className="text-[11px] text-blue-600 hover:underline">Change</button>
                    <button onClick={() => { setJob(null); setPersonId(null) }} className="text-[11px] text-gray-400 hover:text-gray-700">Clear</button>
                  </span>
                </div>
              ) : (
                <button
                  onClick={() => setShowResolver(true)}
                  className="mt-1 w-full px-2 py-1.5 border border-dashed border-gray-300 rounded-lg text-left text-gray-500 hover:border-gray-400 hover:text-gray-700"
                >
                  + Link a job
                </button>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="text-xs text-gray-500">Date</span>
                <input type="date" value={scheduledDate} onChange={(e) => setScheduledDate(e.target.value)} className={input} />
              </label>
              <label className="block">
                <span className="text-xs text-gray-500">Time (optional)</span>
                <input type="text" value={scheduledTime} placeholder="e.g. 7am call" onChange={(e) => setScheduledTime(e.target.value)} className={input} />
              </label>
            </div>

            {/* Address with typeahead */}
            <div className="block relative">
              <span className="text-xs text-gray-500">{isDelivery ? 'Delivery address (site)' : 'Pickup address (site)'} *</span>
              <textarea
                value={siteAddress} rows={2}
                placeholder="Start typing an address — or free-text a gate/lot"
                onChange={(e) => setSiteAddress(e.target.value)}
                onFocus={() => { if (addrHits.length) setAddrOpen(true) }}
                className={`${input} resize-y`}
              />
              {addrLoading && <span className="absolute right-2 top-7 text-[10px] text-gray-400">searching…</span>}
              {addrOpen && addrHits.length > 0 && (
                <div className="absolute z-10 left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden">
                  {addrHits.map((h, i) => (
                    <button
                      key={`${h.value}-${i}`}
                      onClick={() => {
                        skipNextSearch.current = true
                        setSiteAddress(h.value)
                        setAddrOpen(false)
                        setAddrHits([])
                      }}
                      className="block w-full text-left px-3 py-2 text-[13px] text-gray-800 hover:bg-gray-50 border-b border-gray-100 last:border-b-0"
                    >
                      <span className="font-medium">{h.value}</span>
                      <span className="block text-[11px] text-gray-400 truncate">{h.label}</span>
                    </button>
                  ))}
                  <button
                    onClick={() => { setAddrOpen(false); setAddrHits([]) }}
                    className="block w-full text-left px-3 py-1.5 text-[11px] text-gray-500 hover:bg-gray-50"
                  >
                    Keep what I typed
                  </button>
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="text-xs text-gray-500">On-site contact</span>
                <input type="text" value={contactName} onChange={(e) => { setContactName(e.target.value); setPersonId(null) }} className={input} />
              </label>
              <label className="block">
                <span className="text-xs text-gray-500">Contact phone</span>
                <input type="tel" value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} className={input} />
              </label>
            </div>
            {personId && (
              <p className="text-[11px] text-emerald-700">✓ Linked to this job&rsquo;s contact record.</p>
            )}

            <label className="block">
              <span className="text-xs text-gray-500">Items</span>
              <textarea value={deliveryItems} rows={2} onChange={(e) => setDeliveryItems(e.target.value)} className={`${input} resize-y`} />
            </label>
            <label className="block">
              <span className="text-xs text-gray-500">Special instructions</span>
              <textarea value={notes} rows={2} onChange={(e) => setNotes(e.target.value)} className={`${input} resize-y`} />
            </label>
            <p className="text-[11px] text-gray-400">Fleet assigns the driver + tow vehicle after the task is created.</p>
            {err && <p className="text-xs text-rose-600">{err}</p>}
          </div>
          <div className="flex justify-end gap-2 mt-5">
            <button onClick={onClose} disabled={saving} className="text-sm text-gray-600 hover:text-gray-900 px-3 py-1.5">Cancel</button>
            <button onClick={submit} disabled={saving}
              className="text-sm font-semibold bg-amber-600 hover:bg-amber-500 text-white px-4 py-1.5 rounded disabled:opacity-40">
              {saving ? 'Scheduling…' : `Schedule ${isDelivery ? 'delivery' : 'pickup'}`}
            </button>
          </div>
        </div>
      </div>

      {showResolver && (
        <JobResolverModal
          context={{ jobNameHint: title || null, contactName: contactName || null, contactPhone: contactPhone || null }}
          onResolved={onJobResolved}
          onClose={() => setShowResolver(false)}
        />
      )}
    </>
  )
}
