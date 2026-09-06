'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { hqFetch } from './hqFetch'
import { BTN_PRIMARY, CARD, INPUT, LABEL, MUTED } from './ui'

export function DriverRosterForm({ token }: { token: string; base: string }) {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setMsg(null)
    const r = await hqFetch<{ invited: boolean; existed: boolean }>(`/api/public/vendor-hq/${token}/drivers`, 'POST', { email, name })
    setBusy(false)
    if (!r.ok) return setMsg({ ok: false, text: r.error })
    setMsg({ ok: true, text: r.data.invited ? `Emailed ${email} a link to fill in their details.` : `Added ${email}, but the email didn't leave — check the address.` })
    setEmail('')
    setName('')
    router.refresh()
  }

  return (
    <form onSubmit={submit} className={`${CARD} p-5`}>
      <div className="grid sm:grid-cols-[1fr_1fr_auto] gap-3 items-end">
        <div>
          <label className={LABEL}>Email</label>
          <input className={INPUT} type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </div>
        <div>
          <label className={LABEL}>Name <span className="font-normal text-[#6b7280]">(optional)</span></label>
          <input className={INPUT} value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <button type="submit" disabled={busy} className={BTN_PRIMARY}>{busy ? 'Sending…' : 'Add & invite'}</button>
      </div>
      {msg && <p className={`mt-3 text-[14px] ${msg.ok ? 'text-[#1f6b45]' : 'text-[#991b1b]'}`}>{msg.text}</p>}
      <p className={`${MUTED} mt-3`}>The email comes from your workspace name. Drivers keep the same link for every job you put them on.</p>
    </form>
  )
}
