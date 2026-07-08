'use client'

/**
 * Fleet assigns a driver + tow vehicle to a delivery/pickup DispatchTask
 * (STEP 4). Opened from the gantt needs-assignment lane. Setting a tow vehicle
 * drops the task from the lane. Gated server-side on canAssignAssets.
 */
import { useEffect, useState } from 'react'

// Known tow vehicles (schema comment: "Blue Chevy, SB01, SB02, P1, P2").
// towVehicle is free text, so an "Other…" escape hatch is allowed.
const TOW_OPTIONS = ['Blue Chevy', 'SB01', 'SB02', 'P1', 'P2']

interface AssignTaskModalProps {
  task: {
    taskId: string
    taskType: string
    clientName: string
    jobName?: string
    siteAddress?: string
    scheduledTime?: string
    deliveryItems?: string
  }
  onClose: () => void
  onAssigned: () => void
}

export function AssignTaskModal({ task, onClose, onAssigned }: AssignTaskModalProps) {
  const [drivers, setDrivers] = useState<{ id: string; name: string; type: string }[]>([])
  const [driverId, setDriverId] = useState('')
  const [towVehicle, setTowVehicle] = useState('')
  const [customTow, setCustomTow] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/drivers')
      .then((r) => (r.ok ? r.json() : { drivers: [] }))
      .then((d) => setDrivers(d.drivers || []))
      .catch(() => setDrivers([]))
  }, [])

  const label = task.taskType === 'PICKUP' ? 'pickup' : 'delivery'
  const tow = towVehicle === '__other__' ? customTow.trim() : towVehicle

  async function submit() {
    if (!tow) {
      setErr('Select a tow vehicle.')
      return
    }
    setSaving(true)
    setErr(null)
    try {
      const res = await fetch(`/api/scheduling/dispatch-tasks/${task.taskId}/assign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assignedTo: driverId || null, towVehicle: tow }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error(d.reason || d.error || `HTTP ${res.status}`)
      }
      onAssigned()
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={() => { if (!saving) onClose() }}
    >
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-baseline justify-between mb-1">
          <h2 className="text-lg font-semibold text-zinc-900">Assign {label} task</h2>
          <button onClick={onClose} className="text-zinc-400 hover:text-zinc-700 text-xl leading-none">×</button>
        </div>
        <p className="text-xs text-zinc-500 mb-4">
          {task.clientName}
          {task.jobName ? ` · ${task.jobName}` : ''}
          {task.scheduledTime ? ` · ${task.scheduledTime}` : ''}
          {task.siteAddress ? <><br />{task.siteAddress}</> : null}
        </p>
        <div className="space-y-3 text-sm">
          <label className="block">
            <span className="text-xs text-zinc-500">Tow vehicle *</span>
            <select
              value={towVehicle}
              onChange={(e) => setTowVehicle(e.target.value)}
              className="mt-1 w-full border border-zinc-300 rounded px-2 py-1.5 text-sm"
            >
              <option value="">Select…</option>
              {TOW_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
              <option value="__other__">Other…</option>
            </select>
          </label>
          {towVehicle === '__other__' && (
            <input
              value={customTow}
              onChange={(e) => setCustomTow(e.target.value)}
              placeholder="Tow vehicle"
              className="w-full border border-zinc-300 rounded px-2 py-1.5 text-sm"
            />
          )}
          <label className="block">
            <span className="text-xs text-zinc-500">Driver (optional)</span>
            <select
              value={driverId}
              onChange={(e) => setDriverId(e.target.value)}
              className="mt-1 w-full border border-zinc-300 rounded px-2 py-1.5 text-sm"
            >
              <option value="">Unassigned</option>
              {drivers.map((d) => (
                <option key={d.id} value={d.id}>{d.name}{d.type === 'EXTERNAL' ? ' (ext)' : ''}</option>
              ))}
            </select>
          </label>
          {err && <p className="text-xs text-rose-600">{err}</p>}
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onClose} disabled={saving} className="text-sm text-zinc-600 hover:text-zinc-900 px-3 py-1.5">Cancel</button>
          <button
            onClick={submit}
            disabled={saving}
            className="text-sm font-medium bg-amber-600 hover:bg-amber-500 text-white px-4 py-1.5 rounded disabled:opacity-40"
          >
            {saving ? 'Assigning…' : 'Assign'}
          </button>
        </div>
      </div>
    </div>
  )
}
