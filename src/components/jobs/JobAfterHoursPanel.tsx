'use client';

/**
 * After-hours pickup & drop-off, on the staff side — the one click that
 * replaces attaching "Afer Hours EQ P:R.pdf" to an email by hand.
 *
 * The panel answers three questions an agent has, in the order they have
 * them:
 *
 *   1. Has this client got it? (released / sent / to whom / when)
 *   2. What will they see? (the codes and the note, right here — because
 *      the client is on the phone asking for the gate code NOW, and making
 *      the agent open a second tab to read it to them is the reason people
 *      keep their own copy of the PDF)
 *   3. Send it. One button, pre-aimed at the job's primary contact, with a
 *      contact picker for the case where it should go to the driver's
 *      coordinator instead.
 *
 * Revoke is deliberately present and deliberately quiet. It is the whole
 * argument for this being a release rather than an attachment, and it will
 * be used about twice a year.
 *
 * Loads lazily on expand: the GET returns access codes, and a job page that
 * fetched them on mount would put the gate code in the payload of every
 * job page view whether or not anyone asked.
 */

import { useCallback, useEffect, useState } from 'react';

interface Contact {
  personId: string;
  name: string;
  email: string;
  role: string;
}

interface ShareRow {
  id: string;
  email: string;
  name: string | null;
  createdAt: string;
  expiresAt: string;
  viewedAt: string | null;
  by: string;
}

interface AfterHoursState {
  releasedAt: string | null;
  releasedBy: string | null;
  sentAt: string | null;
  sentTo: string | null;
  note: string | null;
  hasPortalOrder: boolean;
  recipient: Contact | null;
  contacts: Contact[];
  shares: ShareRow[];
  instructions: {
    gateCode: string | null;
    containerCode: string | null;
    complete: boolean;
  };
}

function fmtWhen(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

export function JobAfterHoursPanel({ jobId }: { jobId: string }) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<AfterHoursState | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [personId, setPersonId] = useState('');
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  // Staff-side forward straight to a driver / PA, for when the coordinator
  // asks us to send it rather than doing it themselves from the portal.
  const [driverEmail, setDriverEmail] = useState('');
  const [driverName, setDriverName] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`/api/jobs/${jobId}/after-hours`);
      if (!r.ok) {
        setError('Could not load after-hours status.');
        return;
      }
      const j = (await r.json()) as AfterHoursState;
      setState(j);
      setNote(j.note || '');
      setPersonId(j.recipient?.personId || '');
    } catch {
      setError('Could not load after-hours status.');
    } finally {
      setLoading(false);
    }
  }, [jobId]);

  useEffect(() => {
    if (open && !state) void load();
  }, [open, state, load]);

  const shareToDriver = async () => {
    const to = driverEmail.trim();
    if (!to) return;
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      const r = await fetch(`/api/jobs/${jobId}/after-hours`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'share',
          email: to,
          name: driverName.trim() || null,
          message: note.trim() || null,
        }),
      });
      const j = (await r.json().catch(() => ({}))) as { error?: string; sentTo?: string };
      if (!r.ok) {
        setError(j.error || 'That did not send.');
        return;
      }
      setMsg(`Driver link sent to ${j.sentTo}.`);
      setDriverEmail('');
      setDriverName('');
      setState(null);
      await load();
    } catch {
      setError('That did not send.');
    } finally {
      setBusy(false);
    }
  };

  const act = async (action: 'send' | 'release' | 'revoke') => {
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      const r = await fetch(`/api/jobs/${jobId}/after-hours`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          personId: action === 'send' ? personId || undefined : undefined,
          note: action === 'revoke' ? undefined : note,
        }),
      });
      const j = (await r.json().catch(() => ({}))) as { error?: string; sentTo?: string };
      if (!r.ok) {
        setError(j.error || 'That did not go through.');
        return;
      }
      setConfirmRevoke(false);
      setMsg(
        action === 'send'
          ? `Sent to ${j.sentTo}.`
          : action === 'release'
            ? 'Released — the client can see it on their project page.'
            : 'Revoked. The page has stopped answering.',
      );
      setState(null);
      await load();
    } catch {
      setError('That did not go through.');
    } finally {
      setBusy(false);
    }
  };

  const released = !!state?.releasedAt;

  return (
    <div className="mb-4 rounded-xl border border-zinc-200 bg-white">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-3 px-3 py-2.5 text-left"
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="text-[12px] font-semibold text-zinc-900">
            After-hours pickup &amp; drop-off
          </span>
          {state && (
            <span
              className={`text-[10px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider ${
                released ? 'bg-emerald-100 text-emerald-800' : 'bg-zinc-100 text-zinc-600'
              }`}
            >
              {released ? 'Released' : 'Not sent'}
            </span>
          )}
          {state?.sentTo && (
            <span className="text-[11px] text-zinc-600 truncate">
              {state.sentTo} · {fmtWhen(state.sentAt)}
            </span>
          )}
        </div>
        <span className="text-[11px] text-zinc-500 flex-none">{open ? 'Hide' : 'Send / view'}</span>
      </button>

      {open && (
        <div className="border-t border-zinc-200 p-3 space-y-3">
          {loading && <div className="text-[12px] text-zinc-500">Loading…</div>}

          {state && (
            <>
              {/* What the client sees. Here so nobody has to go looking. */}
              <div className="flex flex-wrap gap-3">
                <CodeChip label="Gate" code={state.instructions.gateCode} />
                <CodeChip label="Container" code={state.instructions.containerCode} />
              </div>
              {!state.instructions.complete && (
                <div className="text-[12px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                  A code is missing, so the client&rsquo;s page would tell them there isn&rsquo;t
                  one. Record it under Admin → Assistant before sending.
                </div>
              )}

              {!state.hasPortalOrder && (
                <div className="text-[12px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                  No order on this job has a client portal yet — the after-hours page lives inside
                  it. Send a quote first.
                </div>
              )}

              <div>
                <label className="block text-[10px] uppercase tracking-wider text-zinc-600 font-semibold mb-1">
                  Anything specific to this job (optional)
                </label>
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  rows={2}
                  placeholder="Your cart is the one tagged GOGGLES. Park in the north row."
                  className="w-full px-2.5 py-1.5 border border-zinc-300 rounded-lg text-[13px]"
                />
              </div>

              {state.contacts.length > 0 && (
                <div>
                  <label className="block text-[10px] uppercase tracking-wider text-zinc-600 font-semibold mb-1">
                    Send to
                  </label>
                  <select
                    value={personId}
                    onChange={(e) => setPersonId(e.target.value)}
                    className="w-full px-2.5 py-1.5 border border-zinc-300 rounded-lg text-[13px] bg-white"
                  >
                    {state.contacts.map((c) => (
                      <option key={c.personId} value={c.personId}>
                        {c.name || c.email} · {c.role} — {c.email}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {error && (
                <div className="text-[12px] text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                  {error}
                </div>
              )}
              {msg && (
                <div className="text-[12px] text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
                  {msg}
                </div>
              )}

              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={() => act('send')}
                  disabled={busy || !state.hasPortalOrder || state.contacts.length === 0}
                  className="px-3 py-1.5 rounded-lg text-[12px] font-semibold text-white bg-amber-600 hover:bg-amber-500 disabled:bg-zinc-300"
                >
                  {busy ? 'Working…' : state.sentAt ? 'Send again' : 'Email the instructions'}
                </button>
                {!released && (
                  <button
                    onClick={() => act('release')}
                    disabled={busy}
                    className="px-3 py-1.5 rounded-lg text-[12px] font-semibold border border-zinc-300 hover:bg-zinc-50 disabled:opacity-50"
                    title="Turn the client's page on without emailing — for when you're reading it to them on the phone"
                  >
                    Release without emailing
                  </button>
                )}
                {released &&
                  (confirmRevoke ? (
                    <span className="flex items-center gap-2">
                      <button
                        onClick={() => act('revoke')}
                        disabled={busy}
                        className="px-3 py-1.5 rounded-lg text-[12px] font-semibold text-white bg-red-600 hover:bg-red-500 disabled:opacity-50"
                      >
                        Yes, revoke
                      </button>
                      <button
                        onClick={() => setConfirmRevoke(false)}
                        className="text-[12px] text-zinc-600 hover:text-zinc-900"
                      >
                        Cancel
                      </button>
                    </span>
                  ) : (
                    <button
                      onClick={() => setConfirmRevoke(true)}
                      className="text-[12px] text-zinc-600 hover:text-red-700"
                      title="The client's page stops answering immediately"
                    >
                      Revoke access
                    </button>
                  ))}
              </div>

              {released && (
                <div className="text-[11px] text-zinc-600">
                  Released {fmtWhen(state.releasedAt)}
                  {state.releasedBy ? ` by ${state.releasedBy}` : ''}
                  {state.sentTo ? ` · last emailed to ${state.sentTo} ${fmtWhen(state.sentAt)}` : ''}
                </div>
              )}

              {/* The driver's own link. The client can mint these themselves
                  from their portal — this is for the call where they ask us
                  to send it to the PA instead. Recipient sees the codes and
                  nothing else: no order, no rates, no paperwork. */}
              {released && (
                <div className="border-t border-zinc-200 pt-3">
                  <div className="text-[10px] uppercase tracking-wider text-zinc-600 font-semibold mb-1">
                    Send straight to a driver or PA
                  </div>
                  <div className="flex flex-col sm:flex-row gap-2">
                    <input
                      type="email"
                      value={driverEmail}
                      onChange={(e) => setDriverEmail(e.target.value)}
                      placeholder="driver@example.com"
                      className="flex-1 px-2.5 py-1.5 border border-zinc-300 rounded-lg text-[13px]"
                    />
                    <input
                      type="text"
                      value={driverName}
                      onChange={(e) => setDriverName(e.target.value)}
                      placeholder="Name (optional)"
                      className="sm:w-40 px-2.5 py-1.5 border border-zinc-300 rounded-lg text-[13px]"
                    />
                    <button
                      onClick={() => void shareToDriver()}
                      disabled={busy || !driverEmail.trim()}
                      className="px-3 py-1.5 rounded-lg text-[12px] font-semibold border border-zinc-300 hover:bg-zinc-50 disabled:opacity-40"
                    >
                      Send link
                    </button>
                  </div>
                  {state.shares.length > 0 && (
                    <ul className="mt-2 space-y-1">
                      {state.shares.map((s) => (
                        <li key={s.id} className="text-[11px] text-zinc-600">
                          {s.name || s.email}
                          {s.name ? ` · ${s.email}` : ''} ·{' '}
                          {s.viewedAt ? `opened ${fmtWhen(s.viewedAt)}` : 'not opened'} · sent by{' '}
                          {s.by}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function CodeChip({ label, code }: { label: string; code: string | null }) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-1.5">
      <div className="text-[9px] uppercase tracking-wider text-zinc-500 font-semibold">{label}</div>
      <div className="font-mono text-[15px] font-bold text-zinc-900">
        {code || <span className="text-zinc-400 font-sans text-[12px] font-normal">not on file</span>}
      </div>
    </div>
  );
}
