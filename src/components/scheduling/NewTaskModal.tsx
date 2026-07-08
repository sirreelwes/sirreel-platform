'use client'

/**
 * Standalone delivery/pickup task-create modal — opened from the shell
 * "+ New → New Task" menu. No order context: type + all logistics fields are
 * entered manually. POSTs to /api/scheduling/dispatch-tasks (orderId null);
 * the task lands PENDING/unassigned and appears in the gantt needs-assignment
 * lane on its scheduled day. Gated (server-side) on canCreateBooking.
 *
 * Mirrors the order-page task form (STEP 3) but adds a Delivery/Pickup toggle
 * since there's no order/nudge to preset it.
 */
import { useState } from 'react'

interface NewTaskModalProps {
  onClose: () => void
  onCreated: () => void
}

export function NewTaskModal({ onClose, onCreated }: NewTaskModalProps) {
  const [type, setType] = useState<'DELIVERY' | 'PICKUP'>('DELIVERY')
  const [scheduledDate, setScheduledDate] = useState('')
  const [scheduledTime, setScheduledTime] = useState('')
  const [siteAddress, setSiteAddress] = useState('')
  const [contactName, setContactName] = useState('')
  const [contactPhone, setContactPhone] = useState('')
  const [deliveryItems, setDeliveryItems] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function submit() {
    if (!scheduledDate) { setErr('Date is required.'); return }
    if (!siteAddress.trim()) { setErr('Site address is required.'); return }
    setSaving(true)
    setErr(null)
    try {
      const res = await fetch('/api/scheduling/dispatch-tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, scheduledDate, scheduledTime, siteAddress, contactName, contactPhone, deliveryItems, notes }),
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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => { if (!saving) onClose() }}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-baseline justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900">New {isDelivery ? 'delivery' : 'pickup'} task</h2>
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
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs text-gray-500">Date</span>
              <input type="date" value={scheduledDate} onChange={(e) => setScheduledDate(e.target.value)}
                className="mt-1 w-full px-2 py-1.5 border border-gray-300 rounded-lg text-gray-900" />
            </label>
            <label className="block">
              <span className="text-xs text-gray-500">Time (optional)</span>
              <input type="text" value={scheduledTime} placeholder="e.g. 7am call" onChange={(e) => setScheduledTime(e.target.value)}
                className="mt-1 w-full px-2 py-1.5 border border-gray-300 rounded-lg text-gray-900 placeholder:text-gray-400" />
            </label>
          </div>
          <label className="block">
            <span className="text-xs text-gray-500">{isDelivery ? 'Delivery address (site)' : 'Pickup address (site)'} *</span>
            <textarea value={siteAddress} rows={2} placeholder="Street, city, stage/lot, gate…" onChange={(e) => setSiteAddress(e.target.value)}
              className="mt-1 w-full px-2 py-1.5 border border-gray-300 rounded-lg text-gray-900 placeholder:text-gray-400 resize-y" />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs text-gray-500">On-site contact</span>
              <input type="text" value={contactName} onChange={(e) => setContactName(e.target.value)}
                className="mt-1 w-full px-2 py-1.5 border border-gray-300 rounded-lg text-gray-900" />
            </label>
            <label className="block">
              <span className="text-xs text-gray-500">Contact phone</span>
              <input type="tel" value={contactPhone} onChange={(e) => setContactPhone(e.target.value)}
                className="mt-1 w-full px-2 py-1.5 border border-gray-300 rounded-lg text-gray-900" />
            </label>
          </div>
          <label className="block">
            <span className="text-xs text-gray-500">Items</span>
            <textarea value={deliveryItems} rows={2} onChange={(e) => setDeliveryItems(e.target.value)}
              className="mt-1 w-full px-2 py-1.5 border border-gray-300 rounded-lg text-gray-900 resize-y" />
          </label>
          <label className="block">
            <span className="text-xs text-gray-500">Special instructions</span>
            <textarea value={notes} rows={2} onChange={(e) => setNotes(e.target.value)}
              className="mt-1 w-full px-2 py-1.5 border border-gray-300 rounded-lg text-gray-900 resize-y" />
          </label>
          <p className="text-[11px] text-gray-400">Fleet assigns the driver + tow vehicle after the task is created.</p>
          {err && <p className="text-xs text-rose-600">{err}</p>}
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onClose} disabled={saving} className="text-sm text-gray-600 hover:text-gray-900 px-3 py-1.5">Cancel</button>
          <button onClick={submit} disabled={saving}
            className="text-sm font-semibold bg-amber-600 hover:bg-amber-500 text-white px-4 py-1.5 rounded disabled:opacity-40">
            {saving ? 'Creating…' : 'Create task'}
          </button>
        </div>
      </div>
    </div>
  )
}
