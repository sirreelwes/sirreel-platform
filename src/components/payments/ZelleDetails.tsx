/**
 * Zelle block for the client-facing payment surfaces — the A/P share page and
 * the portal's bank-transfer panel.
 *
 * Zelle used to live ONLY on invoice PDFs, so a client who asked how to pay
 * was offered ACH, wire and card but not a method SirReel actually accepts.
 *
 * Two things are deliberate here:
 *
 * The RECIPIENT NAME is given as much weight as the tag. A payer's banking app
 * shows them the name registered to a Zelle tag before they send, and checking
 * it is the only step that catches a wrong or spoofed tag — a tag alone tells
 * them nothing.
 *
 * The LIMIT is stated. Zelle caps are set by the payer's bank and are often a
 * few thousand dollars a day, well under a typical job total. Saying so here
 * prevents a producer discovering it mid-payment on a $20k invoice and having
 * to start again on a different rail.
 */

import { useState } from 'react'
import { Check } from 'lucide-react'

/** Same asset the invoice PDF uses, on the host that serves it publicly. */
const ZELLE_QR_URL = 'https://hq.sirreel.com/payment/zelle-qr.png'

export function ZelleDetails({
  handle,
  name,
  tone = 'light',
}: {
  handle: string | null
  name: string | null
  /** 'light' for the standalone A/P page, 'compact' inside the portal row. */
  tone?: 'light' | 'compact'
}) {
  const [copied, setCopied] = useState(false)
  // Both or neither: a tag with no name to confirm is not safe to act on.
  if (!handle || !name) return null

  const small = tone === 'compact'

  return (
    <div
      className={`rounded-xl border border-gray-200 bg-white ${small ? 'px-3 py-2.5' : 'px-5 py-4'}`}
    >
      <div className="text-[11px] uppercase tracking-wider text-amber-600 font-semibold mb-2">
        Or pay by Zelle
      </div>
      <div className="flex items-start gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={ZELLE_QR_URL}
          alt="Zelle QR code"
          className={small ? 'w-20 h-20 shrink-0' : 'w-24 h-24 shrink-0'}
        />
        <div className="min-w-0">
          <div className={`${small ? 'text-xs' : 'text-sm'} text-gray-900`}>
            <span className="text-gray-500">Zelle tag: </span>
            <span className="font-semibold">{handle}</span>
            <button
              type="button"
              onClick={() =>
                navigator.clipboard?.writeText(handle).then(
                  () => {
                    setCopied(true)
                    setTimeout(() => setCopied(false), 1500)
                  },
                  () => {},
                )
              }
              className="ml-2 text-[10px] text-gray-400 hover:text-gray-900"
              aria-label="Copy Zelle tag"
            >
              {copied ? <Check size={14} aria-hidden /> : 'copy'}
            </button>
          </div>
          <div className={`${small ? 'text-xs' : 'text-sm'} text-gray-900 mt-0.5`}>
            <span className="text-gray-500">Confirm the name: </span>
            <span className="font-semibold">{name}</span>
          </div>
          <p className={`${small ? 'text-[10px]' : 'text-xs'} text-gray-500 mt-1.5 leading-relaxed`}>
            Your bank shows the recipient name before you send — check it matches.
            Zelle limits are set by your bank, so use ACH or wire for larger
            invoices.
          </p>
        </div>
      </div>
    </div>
  )
}
