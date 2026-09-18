'use client'

import { useCallback, useEffect, useState } from 'react'
import { clientCardWasDeclined } from '@/lib/payments/cardAsk'

/**
 * The cards a client has on file, and which one we charge — the shared half
 * behind every client-facing rendering of that list.
 *
 * Wes, 2026-09-03: "we don't wanna remove the first card. We want to keep
 * that, but also add this card that they want to use as their charge card."
 * That shipped in the legacy portal's CC Auth tab and nowhere else, so the
 * v2 portal — the one the card-authorization email actually links, and the
 * one the job portal's "Authorize a different card for this job" button
 * opens — marked the step Complete and showed a client with a card on file
 * no cards and no way to add one. The fetch, the PATCH and the row markup
 * live here so the two portals cannot drift again.
 *
 * Shows last four, brand, expiry and cardholder. Never the CardSecure token
 * and nothing else that could be used to charge — the same facts a client
 * sees on any billing page, and enough to tell two of their own cards apart.
 *
 * Both endpoints are token-authenticated: `/api/portal/[token]/cards`
 * resolves the company from the paperwork token, and the v2 portal carries
 * the SAME token, so it needs no route of its own.
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
  /** The $0 stored-credential check came back approved. */
  validated?: boolean
  /** We asked the gateway at all. False on every card stored before that
   *  check shipped, which is why `validated: false` alone must never be
   *  rendered to a client as a decline — see clientCardWasDeclined. */
  authChecked?: boolean
}

/** MMYY → "12/27". Returns null for anything unparseable rather than guessing. */
export function prettyExpiry(e: string | null): string | null {
  if (!e || !/^\d{4}$/.test(e)) return null
  return `${e.slice(0, 2)}/${e.slice(2)}`
}

/** Fetches the cards behind a paperwork token and sets the default one.
 *  `cards` is null until the first read lands — an empty list and an
 *  unfinished one must not render the same. */
export function useClientCards(token: string) {
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

  const makeDefault = useCallback(
    async (id: string) => {
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
    },
    [token, load],
  )

  return { cards, busy, msg, makeDefault, reload: load }
}

/** The rows themselves — no surrounding chrome, so each portal can sit them
 *  inside its own card without a second border or a duplicate heading. */
export function ClientCardRows({
  cards,
  busy,
  onUse,
}: {
  cards: WalletCard[] | null
  busy: string | null
  onUse: (id: string) => void
}) {
  if (cards === null) return <p className="text-xs text-gray-400">Loading…</p>
  if (cards.length === 0) return <p className="text-sm text-gray-600">No cards on file yet.</p>

  return (
    <div className="space-y-2">
      {cards.map((c) => {
        const exp = prettyExpiry(c.expiry)
        // Asked the gateway, told no. Never inferred from `validated` alone:
        // that is also false for every card nobody checked (Wes 2026-09-18).
        const declined = clientCardWasDeclined(c)
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
                {declined && !c.expired && (
                  <span
                    className="ml-2 text-[10px] font-bold uppercase tracking-wide text-red-600 bg-red-50 border border-red-200 rounded px-1.5 py-0.5"
                    title="Your bank did not approve this card when we verified it."
                  >
                    Not approved
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
                onClick={() => onUse(c.id)}
                // A card the bank refused is no more chargeable than an
                // expired one, so it is not offered as the one we charge.
                disabled={busy === c.id || c.expired || declined}
                title={
                  c.expired
                    ? 'This card has expired.'
                    : declined
                      ? 'Your bank did not approve this card.'
                      : undefined
                }
                className="shrink-0 px-3 py-1.5 rounded-lg border border-gray-300 hover:border-gray-500 disabled:opacity-40 text-[12px] font-semibold text-gray-700"
              >
                {busy === c.id ? 'Saving…' : 'Use this one'}
              </button>
            )}
          </div>
        )
      })}
    </div>
  )
}
