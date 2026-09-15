'use client';

/**
 * "Send payment info" — type an address, add a note, send SirReel's payment
 * details. Rendered on /admin/payment-info (admin + billing) and on
 * /tools/send-payment-info (sales, who cannot open the admin page — Wes
 * 2026-09-15: "let sales send it too"). The route is the gate:
 * /api/admin/payment-info/send.
 */

import { useEffect, useState } from 'react';

interface DirectSend {
  id: string;
  sentTo: string;
  note: string | null;
  sentBy: string | null;
  at: string;
}

/**
 * Type an address, add a note, send the payment details. For the client
 * with no HQ job (old Planyo/RW work) or a request that was already closed —
 * the inquiry panel and the invoice's "Send payment options" both need a
 * record, and this does not. The note stands in for the job: it is what
 * the list below (and the audit row) shows about who this was.
 */
export function SendPaymentInfoCard() {
  const [email, setEmail] = useState('');
  const [firstName, setFirstName] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sends, setSends] = useState<DirectSend[]>([]);

  const loadSends = () =>
    fetch('/api/admin/payment-info/send')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d?.sends) setSends(d.sends); })
      .catch(() => {});

  useEffect(() => {
    void loadSends();
  }, []);

  const trimmed = email.trim();
  const canSend = !busy && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);

  const send = async () => {
    if (!canSend) return;
    if (!window.confirm(`Email SirReel\u2019s bank and payment details to ${trimmed}?`)) return;
    setBusy(true);
    setError(null);
    setSent(null);
    try {
      const res = await fetch('/api/admin/payment-info/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: trimmed, firstName, note }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) {
        setError(json.error || 'Could not send the payment details.');
        return;
      }
      setSent(json.sentTo);
      setEmail('');
      setFirstName('');
      setNote('');
      void loadSends();
    } finally {
      setBusy(false);
    }
  };

  const inputCls =
    'mt-1.5 w-full bg-lt-inner border border-lt-hairline rounded-lg p-2.5 text-sm text-lt-fg focus:outline-none focus:border-lt-fg2';

  return (
    <div className="bg-lt-card border border-lt-hairline rounded-xl p-5 space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-lt-fg">Send payment info</h2>
        <p className="text-xs text-lt-fg2 mt-0.5 max-w-[72ch]">
          Emails SirReel&rsquo;s bank, ACH, wire and Zelle details, the PDFs and the
          verify-on-sirreel.com link to any address — no job or inquiry needed. Check the address
          before sending; that is the only check there is.
        </p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <label className="block">
          <span className="text-xs uppercase tracking-wide text-lt-fg3 font-semibold">
            Email <span className="text-red-500">*</span>
          </span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="accounting@production.com"
            autoComplete="off"
            data-1p-ignore
            data-lpignore="true"
            className={inputCls}
          />
        </label>
        <label className="block">
          <span className="text-xs uppercase tracking-wide text-lt-fg3 font-semibold">
            First name <span className="text-lt-fg3 normal-case">(optional)</span>
          </span>
          <input
            type="text"
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            placeholder="For the greeting"
            autoComplete="off"
            data-1p-ignore
            data-lpignore="true"
            className={inputCls}
          />
        </label>
      </div>
      <label className="block">
        <span className="text-xs uppercase tracking-wide text-lt-fg3 font-semibold">
          Note <span className="text-lt-fg3 normal-case">(optional)</span>
        </span>
        <input
          type="text"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={500}
          placeholder="Who this is — e.g. Contrast, invoice from the July shoot"
          autoComplete="off"
          className={inputCls}
        />
        <span className="text-[11px] text-lt-fg3 mt-0.5 block">
          Internal only — never in the email. Shows in the list below.
        </span>
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => void send()}
          disabled={!canSend}
          className="px-4 py-2 bg-amber-600 hover:bg-amber-500 text-white text-sm font-semibold rounded-lg disabled:opacity-50"
        >
          {busy ? 'Sending…' : 'Send payment info'}
        </button>
        {sent && <span className="text-xs text-chip-good-fg">Sent to {sent}.</span>}
        {error && <span className="text-xs text-chip-bad-fg">{error}</span>}
      </div>

      {sends.length > 0 && (
        <div className="border-t border-lt-hairline pt-3">
          <div className="text-xs uppercase tracking-wide text-lt-fg3 font-semibold mb-2">Recently sent</div>
          <ul className="space-y-1.5">
            {sends.map((s) => (
              <li key={s.id} className="text-[12px] text-lt-fg2 flex flex-wrap gap-x-2">
                <span className="text-lt-fg font-medium">{s.sentTo}</span>
                {s.note && <span>· {s.note}</span>}
                <span className="text-lt-fg3">
                  · {s.sentBy ? `${s.sentBy}, ` : ''}
                  {new Date(s.at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
