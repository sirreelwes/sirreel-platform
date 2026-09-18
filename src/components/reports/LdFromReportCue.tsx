'use client'

import { useState } from 'react'
import { LdInvoiceModal } from '@/components/collections/LdInvoiceModal'

/**
 * The L&D cue on a filed check-IN sheet.
 *
 * Wes, 2026-09-18: *"With the new functionality of Albert creating a
 * returned order report, this is the most straightforward way for Ana to
 * create an L&D invoice. She will start from the returned order instead of
 * having to read it like she does now and create her own response."*
 *
 * So the returned-order report carries the next move. What Ana used to do
 * by hand — read the sheet, work out what is missing, look up what it
 * costs, write her own email — is the thing the button does, starting with
 * telling the production.
 *
 * Billing-only, and not because of secrecy: the composer behind it shows
 * replacement cost on every line, and the yard deliberately cannot see
 * rates (project_yard_single_view). Albert reads the same page without
 * this strip.
 *
 * Renders nothing on a clean return. A sheet where everything came back is
 * the good outcome and does not need a call to action underneath it.
 */
export function LdFromReportCue({
  orderId,
  orderNumber,
  shortLines,
  missingPieces,
  damagedPieces,
}: {
  orderId: string
  orderNumber: string
  shortLines: number
  missingPieces: number
  damagedPieces: number
}) {
  const [open, setOpen] = useState(false)
  if (shortLines === 0 && damagedPieces === 0) return null

  const bits: string[] = []
  if (missingPieces > 0) {
    bits.push(`${missingPieces} piece${missingPieces === 1 ? '' : 's'} did not come back`)
  }
  if (damagedPieces > 0) {
    bits.push(`${damagedPieces} came back damaged`)
  }

  return (
    <div className="mb-4 rounded-lg border border-chip-warn-fg/25 bg-chip-warn-bg px-3 py-3">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <p className="text-[15px] font-semibold text-chip-warn-fg">
            {bits.join(' · ')}
          </p>
          <p className="text-[13px] text-chip-warn-fg/85 mt-0.5">
            Start with the production — what is missing and what replacing it costs. Nothing is
            charged until you raise the invoice.
          </p>
        </div>
        <button
          onClick={() => setOpen(true)}
          className="shrink-0 rounded-lg bg-amber-600 px-3 py-1.5 text-[13px] font-bold text-white hover:bg-amber-500"
        >
          Start L&amp;D
        </button>
      </div>

      {open && (
        <LdInvoiceModal
          orderId={orderId}
          orderNumber={orderNumber}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  )
}
