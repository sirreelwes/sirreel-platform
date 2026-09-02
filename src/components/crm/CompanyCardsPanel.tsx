'use client';

/**
 * Cards on file for a company — the wallet.
 *
 * Wes, 2026-09-01: "some companies like to keep more than one credit card on
 * file." Before this, a company had exactly one readable card: the token
 * lived on a per-booking paperwork row and every reader took the most recent
 * one, so a second card was invisible at best and a silent substitution at
 * worst.
 *
 * ── There is no "add card" button here, on purpose ─────────────────
 *
 * Cards are captured client-side in the portal, where the number is
 * tokenized in the browser and the client signs the authorization. A staff
 * form that accepted a card number would pull these screens and their logs
 * into PCI scope and would produce an authorization nobody signed. Staff
 * ORGANISE the wallet — name a card, pick the default, take one off file —
 * and clients fill it.
 *
 * `Default` is what the charge paths reach for. With several cards and no
 * default, HQ deliberately asks rather than guessing: charging the wrong
 * card of two is a call from the client's accounting department.
 */

import { useCallback, useEffect, useState } from 'react';

interface CardOnFile {
  id: string;
  origin: 'company' | 'paperwork';
  label: string | null;
  last4: string | null;
  cardType: string | null;
  expiry: string | null;
  cardholderName: string | null;
  isDefault: boolean;
  paymentPreference: 'CARD' | 'CHECK_WIRE' | 'UNDECIDED' | null;
  authorizedAt: string | null;
  validated: boolean;
  expired: boolean;
}

function expiryLabel(e: string | null): string {
  if (!e || e.length !== 4) return '';
  return `${e.slice(0, 2)}/${e.slice(2)}`;
}

export function CompanyCardsPanel({ companyId }: { companyId: string }) {
  const [cards, setCards] = useState<CardOnFile[] | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draftLabel, setDraftLabel] = useState('');

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/crm/companies/${companyId}/cards`);
      if (r.status === 403) {
        setForbidden(true);
        return;
      }
      if (!r.ok) throw new Error('load');
      const d = await r.json();
      setCards(d.cards || []);
    } catch {
      setCards([]);
    }
  }, [companyId]);

  useEffect(() => {
    load();
  }, [load]);

  const act = async (fn: () => Promise<Response>, key: string) => {
    setBusy(key);
    setError(null);
    try {
      const r = await fn();
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        setError(j?.error || 'Could not save.');
        return;
      }
      if (j.cards) setCards(j.cards);
      else await load();
    } catch {
      setError('Could not save.');
    } finally {
      setBusy(null);
      setEditing(null);
    }
  };

  // Collections-gated, like charging a card. Everyone else simply doesn't see
  // the section rather than seeing an error they can do nothing about.
  if (forbidden || !cards) return null;

  const hasDefault = cards.some((c) => c.isDefault);

  return (
    <div className="bg-lt-card border border-lt-hairline rounded-xl p-5">
      <div className="flex items-baseline justify-between gap-2 mb-1 flex-wrap">
        <h2 className="text-base font-semibold text-lt-fg">Cards on file</h2>
        {cards.length > 1 && !hasDefault && (
          <span className="text-[10px] uppercase tracking-wider font-semibold text-chip-warn-fg bg-chip-warn-bg px-2 py-0.5 rounded">
            No default set
          </span>
        )}
      </div>
      <p className="text-xs text-lt-fg3 mb-3">
        Captured in the client portal. Charges use the default card.
      </p>

      {error && <p className="text-xs text-chip-bad-fg mb-2">{error}</p>}

      {cards.length === 0 ? (
        <p className="text-sm text-lt-fg3">
          No cards on file. The client adds one from their portal.
        </p>
      ) : (
        <div className="space-y-2">
          {cards.map((c) => {
            const key = `${c.origin}:${c.id}`;
            return (
              <div
                key={key}
                className={`rounded-lg border p-3 ${
                  c.isDefault ? 'border-lt-fg/30 bg-lt-inner' : 'border-lt-hairline'
                }`}
              >
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-lt-fg flex items-center gap-2 flex-wrap">
                      <span>
                        {c.cardType || 'Card'} ····{c.last4 || '????'}
                      </span>
                      {c.isDefault && (
                        <span className="text-[10px] uppercase tracking-wider font-semibold text-chip-good-fg bg-chip-good-bg px-2 py-0.5 rounded">
                          Default
                        </span>
                      )}
                      {c.expired && (
                        <span className="text-[10px] uppercase tracking-wider font-semibold text-chip-bad-fg bg-chip-bad-bg px-2 py-0.5 rounded">
                          Expired {expiryLabel(c.expiry)}
                        </span>
                      )}
                      {!c.validated && (
                        /* The $0 stored-credential auth never came back
                           approved. The card may still charge, but staff
                           should know before promising a client it will. */
                        <span
                          className="text-[10px] uppercase tracking-wider font-semibold text-chip-warn-fg bg-chip-warn-bg px-2 py-0.5 rounded"
                          title="The $0 validation on this card was not approved."
                        >
                          Unvalidated
                        </span>
                      )}
                      {c.paymentPreference === 'UNDECIDED' && (
                        <span
                          className="text-[10px] uppercase tracking-wider font-semibold text-chip-neutral-fg bg-chip-neutral-bg px-2 py-0.5 rounded"
                          title="Client authorized the card but hasn't said how they'll pay."
                        >
                          Method TBD
                        </span>
                      )}
                      {c.paymentPreference === 'CHECK_WIRE' && (
                        <span
                          className="text-[10px] uppercase tracking-wider font-semibold text-chip-neutral-fg bg-chip-neutral-bg px-2 py-0.5 rounded"
                          title="Client said they'll pay by check or wire — this card is on file as security."
                        >
                          Security only
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-lt-fg3 mt-0.5">
                      {c.label ? <span className="text-lt-fg2">{c.label} · </span> : null}
                      {c.cardholderName || 'Cardholder not recorded'}
                      {c.expiry && !c.expired ? ` · exp ${expiryLabel(c.expiry)}` : ''}
                      {c.authorizedAt
                        ? ` · authorized ${new Date(c.authorizedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
                        : ''}
                    </div>
                  </div>

                  <div className="flex items-center gap-3 shrink-0 text-[11px]">
                    {c.origin === 'paperwork' ? (
                      /* A legacy per-booking authorization. It charges today
                         through the old path, but it can't be named or made
                         default until it's in the wallet. */
                      <button
                        disabled={busy === key}
                        onClick={() =>
                          act(
                            () =>
                              fetch(`/api/crm/companies/${companyId}/cards`, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ paperworkRequestId: c.id }),
                              }),
                            key,
                          )
                        }
                        className="text-lt-fg hover:text-black font-medium"
                      >
                        Add to wallet
                      </button>
                    ) : (
                      <>
                        {!c.isDefault && (
                          <button
                            disabled={busy === key}
                            onClick={() =>
                              act(
                                () =>
                                  fetch(`/api/crm/companies/${companyId}/cards/${c.id}`, {
                                    method: 'PATCH',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ isDefault: true }),
                                  }),
                                key,
                              )
                            }
                            className="text-lt-fg hover:text-black font-medium"
                          >
                            Make default
                          </button>
                        )}
                        <button
                          onClick={() => {
                            setEditing(editing === c.id ? null : c.id);
                            setDraftLabel(c.label || '');
                          }}
                          className="text-lt-fg2 hover:text-black"
                        >
                          {c.label ? 'Rename' : 'Name it'}
                        </button>
                        <button
                          disabled={busy === key}
                          onClick={() => {
                            if (
                              !confirm(
                                `Take ${c.cardType || 'this card'} ····${c.last4 || ''} off file? Past charges keep their record.`,
                              )
                            )
                              return;
                            act(
                              () =>
                                fetch(`/api/crm/companies/${companyId}/cards/${c.id}`, {
                                  method: 'DELETE',
                                }),
                              key,
                            );
                          }}
                          className="text-chip-bad-fg hover:opacity-70"
                        >
                          Remove
                        </button>
                      </>
                    )}
                  </div>
                </div>

                {editing === c.id && (
                  <div className="mt-2 flex items-center gap-2">
                    <input
                      value={draftLabel}
                      onChange={(e) => setDraftLabel(e.target.value)}
                      placeholder="AmEx (production)"
                      className="flex-1 rounded-md border border-lt-hairline px-2 py-1 text-xs"
                    />
                    <button
                      disabled={busy === key}
                      onClick={() =>
                        act(
                          () =>
                            fetch(`/api/crm/companies/${companyId}/cards/${c.id}`, {
                              method: 'PATCH',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ label: draftLabel }),
                            }),
                          key,
                        )
                      }
                      className="text-[11px] font-medium text-lt-fg hover:text-black"
                    >
                      Save
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
