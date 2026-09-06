'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { BTN_SECONDARY, CARD, MUTED } from './ui'

/** The partner's logo, managed inside their own workspace. */
export function LogoForm({ token, hasLogo }: { token: string; hasLogo: boolean }) {
  const router = useRouter()
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  async function upload(file: File) {
    setBusy(true)
    setMsg(null)
    const fd = new FormData()
    fd.append('file', file)
    const r = await fetch(`/api/public/vendor-hq/${token}/logo`, { method: 'POST', body: fd })
    const j = (await r.json().catch(() => ({}))) as { error?: string }
    setBusy(false)
    if (!r.ok) return setMsg({ ok: false, text: j.error ?? 'Could not upload that.' })
    setMsg({ ok: true, text: 'Logo updated.' })
    router.refresh()
  }
  async function remove() {
    setBusy(true)
    await fetch(`/api/public/vendor-hq/${token}/logo`, { method: 'DELETE' })
    setBusy(false)
    setMsg({ ok: true, text: 'Logo removed — your workspace name shows instead.' })
    router.refresh()
  }

  return (
    <div className={`${CARD} p-5`}>
      <div className="flex flex-wrap items-center gap-4">
        {hasLogo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={`/api/public/vendor-hq/${token}/logo?v=${Date.now()}`} alt="Your logo" className="h-10 max-w-[200px] object-contain" />
        ) : (
          <span className={MUTED}>No logo yet — your workspace name shows in the header.</span>
        )}
        <div className="flex gap-2">
          <input ref={input} type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = '' }} />
          <button type="button" className={BTN_SECONDARY} disabled={busy} onClick={() => input.current?.click()}>{busy ? 'Working…' : hasLogo ? 'Replace logo' : 'Upload logo'}</button>
          {hasLogo && <button type="button" className={BTN_SECONDARY} disabled={busy} onClick={remove}>Remove</button>}
        </div>
      </div>
      {msg && <p className={`mt-3 text-[14px] ${msg.ok ? 'text-[#1f6b45]' : 'text-[#991b1b]'}`}>{msg.text}</p>}
      <p className={`${MUTED} mt-3`}>PNG, JPG, WEBP or SVG, up to 5 MB. It goes in the header here and on every email your workspace sends.</p>
    </div>
  )
}
