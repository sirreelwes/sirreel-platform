'use client'

/**
 * WeeklyCandidWidget — dashboard prompt for the rep's "candid of
 * the week" photo. Drives the thank-you flow's default photo source.
 *
 * States:
 *   - No candid ever: amber "It's time for this week's candid" with
 *     a single Take photo button + the guidance copy.
 *   - Candid from a previous week (stale): amber "Last candid is
 *     from N days ago — fresher is friendlier" with Take new + Keep.
 *   - Candid from this week: emerald "Set" with the thumbnail and
 *     a small "Replace" affordance.
 *
 * Mobile-first: the warehouse/sales floor team takes these on phones.
 * `<input type="file" capture="environment">` opens the rear camera
 * directly on iOS / Android.
 */

import { useCallback, useEffect, useRef, useState } from 'react'

interface Candid {
  id: string
  fileUrl: string
  capturedAt: string
  weekStartDate: string
}

interface Resp {
  current: Candid | null
  isThisWeek: boolean
  ageDays: number | null
  thisWeekStart: string
}

const GUIDANCE = 'Aim for the SirReel sign in frame · warehouse crew, a fleet vehicle, or a piece of gear in the background · candid feels better than posed.'

export function WeeklyCandidWidget() {
  const [resp, setResp] = useState<Resp | null>(null)
  const [uploading, setUploading] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)

  const load = useCallback(async () => {
    setErr(null)
    try {
      const r = await fetch('/api/users/me/weekly-candid')
      const data = await r.json()
      if (!r.ok) {
        setErr(data?.error || `HTTP ${r.status}`)
        return
      }
      setResp(data as Resp)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'load failed')
    }
  }, [])

  useEffect(() => { load() }, [load])

  const upload = async (file: File) => {
    setUploading(true)
    setErr(null)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const r = await fetch('/api/users/me/weekly-candid', { method: 'POST', body: fd })
      const data = await r.json()
      if (!r.ok) {
        setErr(data?.error || `upload HTTP ${r.status}`)
        return
      }
      await load()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'upload failed')
    } finally {
      setUploading(false)
    }
  }

  if (resp == null) {
    return (
      <div className="bg-white border border-gray-200 rounded-xl p-4 text-[12px] text-gray-500">
        Loading weekly candid…
      </div>
    )
  }

  const banner: { tone: 'amber' | 'emerald' | 'gray'; copy: string } =
    !resp.current
      ? { tone: 'amber', copy: "It's time for this week's candid." }
      : resp.isThisWeek
        ? { tone: 'emerald', copy: 'Set for this week.' }
        : { tone: 'amber', copy: `Last candid is ${resp.ageDays ?? '?'}d old — fresher is friendlier.` }

  const toneClass = {
    amber: 'bg-amber-50 border-amber-200',
    emerald: 'bg-emerald-50 border-emerald-200',
    gray: 'bg-gray-50 border-gray-200',
  }[banner.tone]
  const toneText = {
    amber: 'text-amber-900',
    emerald: 'text-emerald-900',
    gray: 'text-gray-700',
  }[banner.tone]

  return (
    <div className={`border rounded-xl p-4 ${toneClass}`}>
      <div className="flex items-start justify-between gap-3 mb-2">
        <div>
          <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">My weekly candid</div>
          <div className={`text-[13px] font-bold ${toneText} mt-0.5`}>{banner.copy}</div>
        </div>
        {resp.current && (
          <a
            href={resp.current.fileUrl}
            target="_blank"
            rel="noreferrer"
            className="block w-16 h-16 rounded overflow-hidden border border-gray-200 shrink-0"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={resp.current.fileUrl} alt="weekly candid" className="w-full h-full object-cover" />
          </a>
        )}
      </div>
      <p className="text-[11px] text-gray-600 leading-snug mb-3">{GUIDANCE}</p>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) upload(f)
          e.target.value = ''
        }}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={uploading}
        className="w-full min-h-[2.5rem] bg-gray-900 hover:bg-black text-white text-sm font-medium rounded disabled:opacity-50"
      >
        {uploading ? 'Uploading…' : (resp.current ? '+ Take a new candid' : '+ Take this week\u2019s candid')}
      </button>
      {err && <div className="mt-2 text-[11px] text-red-700">{err}</div>}
    </div>
  )
}
