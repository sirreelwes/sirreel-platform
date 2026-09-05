'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { hqFetch } from './hqFetch'
import { BTN_PRIMARY, CARD, INPUT, LABEL, MUTED } from './ui'

const SWATCHES = ['#1f3a5f', '#0f766e', '#7c2d12', '#4c1d95', '#111827', '#9a3412', '#065f46', '#b91c1c']

export function SettingsForm({ token, initial }: { token: string; initial: { brandName: string; accentColor: string } }) {
  const router = useRouter()
  const [brandName, setBrandName] = useState(initial.brandName)
  const [accent, setAccent] = useState(initial.accentColor)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setMsg(null)
    const r = await hqFetch(`/api/public/vendor-hq/${token}/settings`, 'PATCH', { brandName, accentColor: accent })
    setBusy(false)
    if (!r.ok) return setMsg({ ok: false, text: r.error })
    setMsg({ ok: true, text: 'Saved.' })
    router.refresh()
  }

  return (
    <form className={`${CARD} p-5 space-y-4`} onSubmit={submit}>
      <div>
        <label className={LABEL}>Workspace name</label>
        <input className={INPUT} value={brandName} onChange={(e) => setBrandName(e.target.value)} required maxLength={80} />
        <p className={`${MUTED} mt-1`}>Shown in the header and on anything the workspace sends.</p>
      </div>
      <div>
        <label className={LABEL}>Accent colour</label>
        <div className="flex flex-wrap items-center gap-2">
          {SWATCHES.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={c}
              onClick={() => setAccent(c)}
              className={`w-8 h-8 rounded-full border-2 ${accent === c ? 'border-[#111827]' : 'border-transparent'}`}
              style={{ background: c }}
            />
          ))}
          <input className={`${INPUT} w-[120px]`} value={accent} onChange={(e) => setAccent(e.target.value)} pattern="^#[0-9a-fA-F]{6}$" />
        </div>
      </div>
      {msg && <div className={`rounded-lg px-4 py-2.5 text-[14px] ${msg.ok ? 'bg-[#e6f4ec] text-[#1f6b45]' : 'bg-[#fff5f5] text-[#991b1b] border border-[#f2c9c9]'}`}>{msg.text}</div>}
      <button type="submit" disabled={busy} className={BTN_PRIMARY}>Save</button>
    </form>
  )
}
