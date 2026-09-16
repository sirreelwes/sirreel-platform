'use client'

import { CheckCircle2 } from 'lucide-react';
import { ClientCardRows, useClientCards } from './ClientCardsOnFile'

/**
 * "Your payment options" — the cards a client has on file, and which one we
 * charge. The legacy portal's CC Auth tab once a card exists.
 *
 * Wes, 2026-09-03, from a real client asking to pay with a different card:
 * "we don't wanna remove the first card. We want to keep that, but also add
 * this card that they want to use as their charge card... And then Ana can
 * just simply send the link back that says update payment options."
 *
 * That last sentence is the design. Ana already has the portal link and
 * already sends it; this gives that link something to do besides the initial
 * authorization, so "I want to pay with a different card" stops being an email
 * thread and becomes a click.
 *
 * The wallet behind it is not new — every card authorized in the portal has
 * always been mirrored into the company's wallet, and a second authorization
 * has always ADDED a card rather than replacing the first. The client simply
 * had no way to see that or to choose between them.
 *
 * The list, the fetch and the set-default call are shared with the v2
 * portal's card step (./ClientCardsOnFile) — this file is only the framing
 * around them.
 */

export type { WalletCard } from './ClientCardsOnFile'

export function PaymentOptionsPanel({
  token,
  onAddAnother,
}: {
  token: string
  /** Re-opens the capture form. Adding a card IS authorizing one, so this
   *  hands back to the flow that already does it rather than cloning it. */
  onAddAnother: () => void
}) {
  const { cards, busy, msg, makeDefault } = useClientCards(token)

  return (
    <div className="space-y-4">
      <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-5">
        <div className="flex items-center gap-3">
          <CheckCircle2 size={30} aria-hidden className="text-emerald-500" />
          <div>
            <div className="text-emerald-800 font-bold text-base">Credit Card Authorized</div>
            <div className="text-emerald-600 text-sm">Authorization on file with SirReel</div>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-gray-200 p-5">
        <h2 className="font-bold text-gray-900 mb-1">Your payment options</h2>
        <p className="text-xs text-gray-500 mb-4">
          Add a card any time, and choose which one we charge. Adding a card never removes one you
          already gave us.
        </p>

        <ClientCardRows cards={cards} busy={busy} onUse={(id) => void makeDefault(id)} />

        {msg && <p className="mt-3 text-[12px] text-emerald-700">{msg}</p>}

        <button
          onClick={onAddAnother}
          className="mt-4 w-full py-3 rounded-xl bg-gray-900 hover:bg-gray-800 text-white text-sm font-semibold"
        >
          Add another card
        </button>
        <p className="mt-2 text-[11px] text-gray-400">
          Your card details are entered on our processor&rsquo;s secure form — SirReel never sees or
          stores the full number.
        </p>
      </div>
    </div>
  )
}
