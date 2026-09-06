'use client'

import { useState } from 'react'
import { BTN_SECONDARY } from './ui'

/** The driver's page link, for when the email didn't arrive. The link is the driver's credential. */
export function DriverLinkCopy({ url }: { url: string }) {
  const [msg, setMsg] = useState<string | null>(null)
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <input readOnly value={url} onFocus={(e) => e.currentTarget.select()} className="flex-1 min-w-[220px] rounded-lg border border-[#d5d9de] bg-[#f5f6f8] px-3 py-1.5 text-[12px] font-mono text-[#4b5563]" />
      <button
        type="button"
        className={BTN_SECONDARY}
        onClick={async () => {
          try { await navigator.clipboard.writeText(url); setMsg('Copied — text it to them.') } catch { setMsg('Select it and copy.') }
        }}
      >
        Copy driver link
      </button>
      {msg && <span className="text-[12px] text-[#6b7280]">{msg}</span>}
    </div>
  )
}
