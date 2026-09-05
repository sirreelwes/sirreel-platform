'use client'

/** Mint-or-fetch the partner's account link and put it on the clipboard. */
import { useState } from 'react'
import { Check, Copy, Loader2 } from 'lucide-react'

export function VendorAccountLinkButton({ vendorId }: { vendorId: string }) {
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'error'>('idle')
  async function go() {
    setState('busy')
    try {
      const res = await fetch(`/api/vendors/${vendorId}/portal-link`, { method: 'POST' })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json.url) throw new Error(json.error || 'failed')
      await navigator.clipboard.writeText(json.url)
      setState('done')
      setTimeout(() => setState('idle'), 2000)
    } catch {
      setState('error')
      setTimeout(() => setState('idle'), 2500)
    }
  }
  return (
    <button
      onClick={go}
      disabled={state === 'busy'}
      className="inline-flex items-center gap-1 text-[11px] font-semibold border border-lt-hairline rounded-md px-2 py-1 text-lt-fg hover:text-black"
      title="Copy the partner's account link"
    >
      {state === 'busy' ? <Loader2 className="w-3 h-3 animate-spin" /> : state === 'done' ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
      {state === 'done' ? 'Copied' : state === 'error' ? 'Failed' : 'Copy account link'}
    </button>
  )
}
