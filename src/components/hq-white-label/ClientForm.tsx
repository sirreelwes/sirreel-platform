'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { hqFetch } from './hqFetch'
import { BTN_PRIMARY, BTN_SECONDARY, CARD, INPUT, LABEL } from './ui'

export interface ClientFormValues { name: string; contactName: string; email: string; phone: string; notes: string }

export function ClientForm({ base, token, clientId, initial }: { base: string; token: string; clientId?: string; initial?: Partial<ClientFormValues> }) {
  const router = useRouter()
  const [v, setV] = useState<ClientFormValues>({
    name: initial?.name ?? '', contactName: initial?.contactName ?? '', email: initial?.email ?? '', phone: initial?.phone ?? '', notes: initial?.notes ?? '',
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const set = (k: keyof ClientFormValues) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setV((p) => ({ ...p, [k]: e.target.value }))

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const r = clientId
      ? await hqFetch(`/api/public/vendor-hq/${token}/clients/${clientId}`, 'PATCH', v)
      : await hqFetch(`/api/public/vendor-hq/${token}/clients`, 'POST', v)
    setBusy(false)
    if (!r.ok) return setError(r.error)
    router.push(`${base}/clients`)
    router.refresh()
  }

  return (
    <form className={`${CARD} p-5 space-y-4`} onSubmit={submit}>
      <div className="grid sm:grid-cols-2 gap-4">
        <div className="sm:col-span-2">
          <label className={LABEL}>Company / production</label>
          <input className={INPUT} value={v.name} onChange={set('name')} required />
        </div>
        <div>
          <label className={LABEL}>Contact</label>
          <input className={INPUT} value={v.contactName} onChange={set('contactName')} />
        </div>
        <div>
          <label className={LABEL}>Phone</label>
          <input className={INPUT} value={v.phone} onChange={set('phone')} inputMode="tel" />
        </div>
        <div className="sm:col-span-2">
          <label className={LABEL}>Email</label>
          <input className={INPUT} value={v.email} onChange={set('email')} inputMode="email" />
        </div>
        <div className="sm:col-span-2">
          <label className={LABEL}>Notes</label>
          <textarea className={`${INPUT} min-h-[64px]`} value={v.notes} onChange={set('notes')} placeholder="what they usually take, who signs, billing quirks" />
        </div>
      </div>
      {error && <div className="rounded-lg border border-[#f2c9c9] bg-[#fff5f5] px-4 py-2.5 text-[14px] text-[#991b1b]">{error}</div>}
      <div className="flex items-center gap-2 pt-1">
        <button type="submit" disabled={busy} className={BTN_PRIMARY}>{clientId ? 'Save changes' : 'Add client'}</button>
        <button type="button" className={BTN_SECONDARY} onClick={() => router.push(`${base}/clients`)}>Back</button>
      </div>
    </form>
  )
}
