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
 * ── The two ways a card gets here ──────────────────────────────────
 *
 * Normally the client does it: the portal tokenizes the number in the
 * browser and they sign the authorization themselves.
 *
 * "Key in an authorized card" is the second way (Wes 2026-09-02, from Jose:
 * clients still send signed Cognito CCAs, and re-asking them to type it into
 * the portal is a call nobody wants to make). A staffer types the number into
 * the SAME CardConnect iframe — this page never receives a PAN, exactly as
 * before; what is new is who does the typing. Two conditions come with it:
 * the authorization has to be named (`authorizationRef`), because the client's
 * consent lives on paper HQ deliberately does not store, and the CCA itself
 * must NOT be uploaded anywhere — that document carries the number.
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
  source: string | null;
  authorizationRef: string | null;
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
  const [adding, setAdding] = useState(false);

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
        Captured in the client portal, or keyed from a signed authorization. Charges use the
        default card.
      </p>

      {error && <p className="text-xs text-chip-bad-fg mb-2">{error}</p>}

      <div className="mb-3">
        {adding ? (
          <KeyedCardForm
            companyId={companyId}
            onCancel={() => setAdding(false)}
            onAdded={(next) => {
              setAdding(false);
              setCards(next);
            }}
          />
        ) : (
          <button
            onClick={() => setAdding(true)}
            className="text-[11px] font-semibold text-lt-fg hover:text-black underline underline-offset-2"
          >
            + Key in a card the client authorized
          </button>
        )}
      </div>

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
                    {/* A card the client never typed has to say whose
                        signature stands behind it, and who keyed it. */}
                    {c.source === 'STAFF' && (
                      <div className="text-[11px] text-lt-fg3 mt-0.5">
                        Keyed by staff · authorization: {c.authorizationRef || 'not recorded'}
                      </div>
                    )}
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

/**
 * "Key in a card the client authorized."
 *
 * The number goes from the staffer's keyboard into CardConnect's iframe and
 * comes back as a token — this component never holds a PAN and neither does
 * our server. `mode=card-on-file` mints it WITHOUT a CVV, because a stored
 * token replays its CVV on every later charge and Fiserv flagged exactly that
 * on 2026-08-14.
 *
 * The signed authorization stays where it is. It is named here, not uploaded:
 * a Cognito CCA carries the full card number, so a copy in HQ's storage would
 * be cardholder data at rest in a system that today holds none.
 */
function KeyedCardForm({
  companyId,
  onCancel,
  onAdded,
}: {
  companyId: string;
  onCancel: () => void;
  onAdded: (cards: CardOnFile[]) => void;
}) {
  const [iframeUrl, setIframeUrl] = useState('');
  const [live, setLive] = useState<boolean | null>(null);
  const [token, setToken] = useState('');
  const [expMonth, setExpMonth] = useState('');
  const [expYear, setExpYear] = useState('');
  const [zip, setZip] = useState('');
  const [name, setName] = useState('');
  const [label, setLabel] = useState('');
  const [ref, setRef] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/cardpointe/config?mode=card-on-file')
      .then((r) => r.json())
      .then((d) => {
        setLive(d.live === true);
        if (d.iframeUrl) setIframeUrl(d.iframeUrl);
        else setErr(d.error || 'Card entry unavailable');
      })
      .catch(() => setErr('Card entry unavailable'));
  }, []);

  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (typeof e.data !== 'string' || !e.data.startsWith('{')) return;
      try {
        // CardSecure posts the token in two shapes depending on version —
        // {"message":"<token>"} and {"message":{"token":…}}. Accept both, as
        // collections does; handling only one is a silently dead form.
        const raw = JSON.parse(e.data) as
          | { message?: string | { token?: string; validationError?: string } }
          | null;
        const inner = raw?.message;
        const t =
          typeof inner === 'string' ? inner : typeof inner?.token === 'string' ? inner.token : '';
        const invalid =
          typeof inner === 'object' && typeof inner?.validationError === 'string'
            ? inner.validationError
            : '';
        if (t) {
          setToken(t);
          setErr(null);
        } else if (invalid) {
          setToken('');
          setErr(invalid);
        }
      } catch {
        /* not ours */
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  const expiry = expMonth && expYear ? `${expMonth}${expYear}` : '';
  const ready = !!token && expiry.length === 4 && /^\d{5}(-\d{4})?$/.test(zip) && name.trim().length > 1 && ref.trim().length > 3;

  const submit = async () => {
    if (!ready || busy) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch(`/api/crm/companies/${companyId}/cards/keyed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cardToken: token,
          expiry,
          billingPostal: zip.trim(),
          cardholderName: name.trim(),
          authorizationRef: ref.trim(),
          label: label.trim() || null,
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j?.ok === false) {
        setErr(j?.error || 'Could not store the card.');
        return;
      }
      onAdded(j.cards || []);
    } catch {
      setErr('Could not store the card.');
    } finally {
      setBusy(false);
    }
  };

  const field = 'w-full rounded-md border border-lt-hairline px-2 py-1.5 text-xs';

  return (
    <div className="rounded-lg border border-lt-hairline bg-lt-inner p-3">
      <div className="flex items-baseline justify-between gap-2 mb-1">
        <h3 className="text-xs font-semibold text-lt-fg">Key in an authorized card</h3>
        <button onClick={onCancel} className="text-[11px] text-lt-fg3 hover:text-black">
          Cancel
        </button>
      </div>
      <p className="text-[11px] text-lt-fg3 mb-2">
        For a card the client already authorized in writing. Type the number into the secure box —
        it goes straight to CardConnect and HQ never sees it. Do not upload the authorization form
        anywhere: it has the card number on it.
      </p>

      {live === false && (
        <p className="text-[11px] text-chip-warn-fg mb-2">
          This environment is on the CardPointe sandbox — a card stored here could not be charged,
          so the form will refuse. Use hq.sirreel.com.
        </p>
      )}
      {err && <p className="text-[11px] text-chip-bad-fg mb-2">{err}</p>}

      {iframeUrl ? (
        <iframe
          src={iframeUrl}
          title="Card entry"
          frameBorder="0"
          scrolling="no"
          width="100%"
          height="60"
          className="block bg-white rounded"
        />
      ) : (
        <p className="text-[11px] text-lt-fg3">Loading secure card entry…</p>
      )}
      {token && <p className="text-[11px] text-chip-good-fg mt-1">Card read</p>}

      <div className="mt-2 grid grid-cols-2 gap-2">
        <select value={expMonth} onChange={(e) => setExpMonth(e.target.value)} className={field} aria-label="Expiry month">
          <option value="">Exp. month</option>
          {Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, '0')).map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
        <select value={expYear} onChange={(e) => setExpYear(e.target.value)} className={field} aria-label="Expiry year">
          <option value="">Exp. year</option>
          {Array.from({ length: 15 }, (_, i) => 26 + i).map((y) => (
            <option key={y} value={String(y)}>20{y}</option>
          ))}
        </select>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Cardholder name"
          className={field}
        />
        <input
          value={zip}
          onChange={(e) => setZip(e.target.value)}
          placeholder="Billing ZIP"
          inputMode="numeric"
          className={field}
        />
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Name this card (optional)"
          className={`${field} col-span-2`}
        />
        <input
          value={ref}
          onChange={(e) => setRef(e.target.value)}
          placeholder='Where the signed authorization lives — "Cognito CCA #4182, signed 9/2"'
          className={`${field} col-span-2`}
        />
      </div>

      <div className="mt-2 flex items-center gap-3">
        <button
          onClick={() => void submit()}
          disabled={!ready || busy}
          className="rounded-md bg-lt-fg text-white text-[11px] font-semibold px-3 py-1.5 disabled:opacity-40"
        >
          {busy ? 'Validating…' : 'Put on file'}
        </button>
        <span className="text-[11px] text-lt-fg3">
          Runs a $0 authorization first — a card that declines is not stored.
        </span>
      </div>
    </div>
  );
}
