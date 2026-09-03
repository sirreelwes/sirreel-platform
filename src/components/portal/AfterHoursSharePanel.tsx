'use client';

/**
 * "Send this to your driver" — the client's own forward button.
 *
 * Wes, 2026-09-02: "most of the time they are sending this to their truck
 * driver or PA." The alternative they had was forwarding our email, and if
 * that email had carried their portal link they would have been handing a
 * subcontracted driver their own quote and invoice. So the forward is a
 * first-class action with its own narrow credential behind it.
 *
 * Shape follows the actual moment: it's 9pm, the coordinator has the
 * driver's email in their phone, and they want this done in one field. Name
 * and message are optional and stay collapsed until asked for. The list of
 * who already has it renders underneath, because the second question after
 * "did that send" is "wait, did I already send this to Marco".
 */

import { useCallback, useEffect, useState } from 'react';
import { PORTAL } from '@/lib/brand/portalTokens';

interface ShareRow {
  id: string;
  email: string;
  name: string | null;
  createdAt: string;
  expiresAt: string;
  viewedAt: string | null;
}

function fmtWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function AfterHoursSharePanel() {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [message, setMessage] = useState('');
  const [showDetail, setShowDetail] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [shares, setShares] = useState<ShareRow[]>([]);
  const [ttlDays, setTtlDays] = useState(14);

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/portal/job/after-hours/share');
      if (!r.ok) return;
      const j = (await r.json()) as { shares: ShareRow[]; ttlDays?: number };
      setShares(j.shares || []);
      if (j.ttlDays) setTtlDays(j.ttlDays);
    } catch {
      /* the list is a convenience; failing to load it must not block sending */
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const send = async () => {
    const to = email.trim();
    if (!to) return;
    setBusy(true);
    setError(null);
    setSentTo(null);
    try {
      const r = await fetch('/api/portal/job/after-hours/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: to, name: name.trim() || null, message: message.trim() || null }),
      });
      const j = (await r.json().catch(() => ({}))) as { error?: string; email?: string };
      if (!r.ok) {
        setError(j.error || 'That did not send. Try again, or call us.');
        return;
      }
      setSentTo(j.email || to);
      setEmail('');
      setName('');
      setMessage('');
      setShowDetail(false);
      await load();
    } catch {
      setError('That did not send. Try again, or call us.');
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (id: string) => {
    try {
      await fetch(`/api/portal/job/after-hours/share?id=${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
      await load();
    } catch {
      /* nothing useful to say; the list refresh will show the truth */
    }
  };

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <div className="text-[10px] font-semibold uppercase tracking-widest text-gray-500">
        Send this to your driver
      </div>
      <p className="mt-1.5 text-[14px] text-gray-700 leading-relaxed">
        They&rsquo;ll get these instructions and nothing else — no rates, no paperwork. The link
        works for {ttlDays} days.
      </p>

      <div className="mt-3 flex flex-col sm:flex-row gap-2">
        <input
          type="email"
          inputMode="email"
          autoComplete="off"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void send();
          }}
          placeholder="driver@example.com"
          className="flex-1 px-3 py-2.5 border border-gray-300 rounded-lg text-[15px]"
        />
        <button
          onClick={() => void send()}
          disabled={busy || !email.trim()}
          className="px-5 py-2.5 rounded-lg text-[15px] font-semibold text-white disabled:opacity-40"
          style={{ backgroundColor: PORTAL.dark }}
        >
          {busy ? 'Sending…' : 'Send'}
        </button>
      </div>

      {!showDetail ? (
        <button
          onClick={() => setShowDetail(true)}
          className="mt-2 text-[13px] text-gray-500 hover:text-gray-900"
        >
          + Add their name or a note
        </button>
      ) : (
        <div className="mt-2 space-y-2">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Their name (optional)"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-[14px]"
          />
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={2}
            placeholder="Anything they should know — call time, what to grab (optional)"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-[14px]"
          />
        </div>
      )}

      {error && (
        <div className="mt-3 text-[13px] text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          {error}
        </div>
      )}
      {sentTo && (
        <div className="mt-3 text-[13px] text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
          Sent to {sentTo}.
        </div>
      )}

      {shares.length > 0 && (
        <div className="mt-4 border-t border-gray-200 pt-3">
          <div className="text-[10px] font-semibold uppercase tracking-widest text-gray-500">
            Who has this link
          </div>
          <ul className="mt-2 space-y-1.5">
            {shares.map((s) => (
              <li key={s.id} className="flex items-baseline justify-between gap-3 text-[13px]">
                <span className="min-w-0">
                  <span className="text-gray-900">{s.name || s.email}</span>
                  {s.name && <span className="text-gray-500"> · {s.email}</span>}
                  <span className="text-gray-400">
                    {' '}
                    · {s.viewedAt ? `opened ${fmtWhen(s.viewedAt)}` : 'not opened yet'}
                  </span>
                </span>
                <button
                  onClick={() => void revoke(s.id)}
                  className="flex-none text-gray-400 hover:text-red-700"
                  title="Stop this link working"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
