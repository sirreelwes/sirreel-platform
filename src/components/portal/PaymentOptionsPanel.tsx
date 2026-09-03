'use client'

import { useCallback, useEffect, useState } from 'react'
import { CheckCircle2 } from 'lucide-react';

/**
 * "Your payment options" — the cards a client has on file, and which one we
 * charge.
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
 * Shows last four, brand and expiry only. Enough for someone to tell their own
 * two cards apart; nothing that could be used to charge one.
 */

export interface WalletCard {
  id: string
  last4: string | null
  cardType: string | null
  expiry: string | null
  cardholderName: string | null
  isDefault: boolean
  expired: boolean
  label: string | null
}

/** MMYY → "12/27". Returns null for anything unparseable rather than guessing. */
function prettyExpiry(e: string | null): string | null {
  if (!e || !/^\d{4}$/.test(e)) return null
  return `${e.slice(0, 2)}/${e.slice(2)}`
}

export function PaymentOptionsPanel({
  token,
  onAddAnother,
}: {
  token: string
  /** Re-opens the capture form. Adding a card IS authorizing one, so this
   *  hands back to the flow that already does it rather than cloning it. */
  onAddAnother: () => void
}) {
  const [cards, setCards] = useState<WalletCard[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/portal/${token}/cards`, { cache: 'no-store' })
      if (!r.ok) return
      const j = await r.json()
      setCards(j.cards ?? [])
    } catch {
      /* the panel is a read-out; a failed poll just leaves the last value */
    }
  }, [token])

  useEffect(() => {
    void load()
  }, [load])

  const makeDefault = async (id: string) => {
    setBusy(id)
    setMsg(null)
    try {
      const r = await fetch(`/api/portal/${token}/cards`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cardId: id }),
      })
      if (!r.ok) {
        setMsg('That did not save — please try again.')
        return
      }
      setMsg('Saved. We will charge that card.')
      await load()
    } catch {
      setMsg('That did not save — please try again.')
    } finally {
      setBusy(null)
    }
  }

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

        {cards === null ? (
          <p className="text-xs text-gray-400">Loading…</p>
        ) : cards.length === 0 ? (
          <p className="text-sm text-gray-600">No cards on file yet.</p>
        ) : (
          <div className="space-y-2">
            {cards.map((c) => {
              const exp = prettyExpiry(c.expiry)
              return (
                <div
                  key={c.id}
                  className={`flex items-center gap-3 p-3 rounded-xl border-2 ${
                    c.isDefault ? 'border-gray-900 bg-gray-50' : 'border-gray-200'
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold text-gray-900">
                      {c.cardType ?? 'Card'} ····{c.last4 ?? '????'}
                      {c.isDefault && (
                        <span className="ml-2 text-[10px] font-bold uppercase tracking-wide text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-1.5 py-0.5">
                          We charge this one
                        </span>
                      )}
                      {c.expired && (
                        <span className="ml-2 text-[10px] font-bold uppercase tracking-wide text-red-600 bg-red-50 border border-red-200 rounded px-1.5 py-0.5">
                          Expired
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-gray-500 mt-0.5">
                      {c.cardholderName ?? 'Cardholder not recorded'}
                      {exp && ` · expires ${exp}`}
                      {c.label && ` · ${c.label}`}
                    </div>
                  </div>
                  {!c.isDefault && (
                    <button
                      onClick={() => void makeDefault(c.id)}
                      disabled={busy === c.id || c.expired}
                      title={c.expired ? 'This card has expired.' : undefined}
                      className="shrink-0 px-3 py-1.5 rounded-lg border border-gray-300 hover:border-gray-500 disabled:opacity-40 text-[12px] font-semibold text-gray-700"
                    >
                      {busy === c.id ? 'Saving…' : 'Use this one'}
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        )}

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
