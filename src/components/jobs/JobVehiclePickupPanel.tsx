'use client';

/**
 * After-hours VEHICLE pickup, on the staff side — the one click that
 * replaces the "After Hours Instructions" email Jose types by hand the
 * night before a van goes out (Wes 2026-09-10: "an easy button for sales
 * to send this summary to clients on the job detail page").
 *
 * Sibling of JobAfterHoursPanel (gear in the storage container). Answers
 * the agent's questions in order:
 *
 *   1. Which units, and are their plate + lock box code on file? (shown
 *      right here, because the client on the phone wants the code NOW)
 *   2. Who gets it? Pre-aimed at the job's primary contact, with a picker,
 *      plus "also send to" for the driver or a second coordinator —
 *      Jose's went to three people.
 *   3. Send. One button. The last send is on the header line.
 *
 * Loads lazily on expand: the GET returns lock box codes, and a job page
 * that fetched them on mount would put every code in the payload of
 * every job page view whether or not anyone asked.
 */

import { useCallback, useEffect, useState } from 'react';

interface Contact {
  personId: string;
  name: string;
  email: string;
  role: string;
}

interface Vehicle {
  assetId: string;
  unitName: string;
  category: string | null;
  licensePlate: string | null;
  lockboxCode: string | null;
  window: string | null;
  status: string;
}

interface PickupState {
  gateCode: string | null;
  lockboxInstructionsUrl: string | null;
  vehicles: Vehicle[];
  recipient: Contact | null;
  contacts: Contact[];
  last: { at: string; to: string[]; vehicles: string[]; by: string | null } | null;
  maxExtraRecipients: number;
}

function fmtWhen(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function JobVehiclePickupPanel({ jobId }: { jobId: string }) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<PickupState | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [personId, setPersonId] = useState('');
  const [extra, setExtra] = useState('');
  const [note, setNote] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`/api/jobs/${jobId}/vehicle-pickup`);
      if (!r.ok) {
        setError('Could not load the pickup details.');
        return;
      }
      const j = (await r.json()) as PickupState;
      setState(j);
      setPersonId(j.recipient?.personId || '');
      // Default: every unit that can actually be sent.
      setPicked(new Set(j.vehicles.filter((v) => v.lockboxCode).map((v) => v.assetId)));
    } catch {
      setError('Could not load the pickup details.');
    } finally {
      setLoading(false);
    }
  }, [jobId]);

  useEffect(() => {
    if (open && !state) void load();
  }, [open, state, load]);

  const extraList = extra
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const badExtra = extraList.filter((e) => !EMAIL_RE.test(e));
  const canSend =
    !!state &&
    !!state.gateCode &&
    picked.size > 0 &&
    (personId !== '' || extraList.length > 0) &&
    badExtra.length === 0 &&
    extraList.length <= (state?.maxExtraRecipients ?? 5);

  const send = async () => {
    if (!state) return;
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      const r = await fetch(`/api/jobs/${jobId}/vehicle-pickup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          personId: personId || undefined,
          extraEmails: extraList,
          assetIds: [...picked],
          note: note.trim() || undefined,
        }),
      });
      const j = (await r.json().catch(() => ({}))) as {
        error?: string;
        sentTo?: string[];
        vehicles?: string[];
      };
      if (!r.ok) {
        setError(j.error || 'That did not send.');
        return;
      }
      setMsg(`Sent ${(j.vehicles ?? []).join(', ')} to ${(j.sentTo ?? []).join(', ')}.`);
      setExtra('');
      setNote('');
      setState(null);
      await load();
    } catch {
      setError('That did not send.');
    } finally {
      setBusy(false);
    }
  };

  const toggle = (assetId: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(assetId)) next.delete(assetId);
      else next.add(assetId);
      return next;
    });

  return (
    <div className="mb-4 rounded-xl border border-zinc-200 bg-white">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-3 px-3 py-2.5 text-left"
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="text-[12px] font-semibold text-zinc-900">
            After-hours vehicle pickup
          </span>
          {state && (
            <span
              className={`text-[10px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider ${
                state.last ? 'bg-emerald-100 text-emerald-800' : 'bg-zinc-100 text-zinc-600'
              }`}
            >
              {state.last ? 'Sent' : 'Not sent'}
            </span>
          )}
          {state?.last && (
            <span className="text-[11px] text-zinc-600 truncate">
              {state.last.to.join(', ')} · {fmtWhen(state.last.at)}
            </span>
          )}
        </div>
        <span className="text-[11px] text-zinc-500 flex-none">
          {open ? 'Hide' : 'Send gate + lock box codes'}
        </span>
      </button>

      {open && (
        <div className="border-t border-zinc-200 p-3 space-y-3">
          {loading && <div className="text-[12px] text-zinc-500">Loading…</div>}

          {state && (
            <>
              <div className="flex flex-wrap gap-3">
                <CodeChip label="Gate 1" code={state.gateCode} />
              </div>
              {!state.gateCode && (
                <div className="text-[12px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                  The gate code is not on file, so the email would say there isn&rsquo;t one.
                  Record it under Admin → Assistant before sending.
                </div>
              )}

              {/* The units. Plate and lock box code right here — the
                  client is on the phone asking for them. */}
              {state.vehicles.length === 0 ? (
                <div className="text-[12px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                  No unit is reserved on this job yet. Assign the vehicle first — the email names
                  the unit, its plate and its lock box code.
                </div>
              ) : (
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-zinc-600 font-semibold mb-1">
                    Vehicles in the email
                  </div>
                  <ul className="space-y-1.5">
                    {state.vehicles.map((v) => {
                      const sendable = !!v.lockboxCode;
                      return (
                        <li key={v.assetId}>
                          <label
                            className={`flex items-start gap-2.5 rounded-lg border px-3 py-2 ${
                              sendable
                                ? 'border-zinc-200 bg-zinc-50 cursor-pointer'
                                : 'border-amber-200 bg-amber-50/60'
                            }`}
                          >
                            <input
                              type="checkbox"
                              className="mt-1"
                              checked={picked.has(v.assetId)}
                              disabled={!sendable}
                              onChange={() => toggle(v.assetId)}
                            />
                            <span className="min-w-0 flex-1">
                              <span className="block text-[13px] font-semibold text-zinc-900">
                                {v.unitName}
                                {v.category && (
                                  <span className="ml-1.5 font-normal text-zinc-600">{v.category}</span>
                                )}
                                {v.window && (
                                  <span className="ml-1.5 font-normal text-[11px] text-zinc-500">
                                    {v.window}
                                  </span>
                                )}
                              </span>
                              <span className="block text-[12px] text-zinc-700">
                                Plate{' '}
                                <span className="font-mono font-semibold">
                                  {v.licensePlate || <span className="text-amber-700 font-sans font-normal">not on file</span>}
                                </span>
                                <span className="mx-2 text-zinc-300">·</span>
                                Lock box{' '}
                                <span className="font-mono font-semibold">
                                  {v.lockboxCode || <span className="text-amber-700 font-sans font-normal">not on file — record it under Fleet</span>}
                                </span>
                              </span>
                            </span>
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}

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
                    <option value="">— only the addresses below —</option>
                    {state.contacts.map((c) => (
                      <option key={c.personId} value={c.personId}>
                        {c.name || c.email} · {c.role} — {c.email}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <label className="block text-[10px] uppercase tracking-wider text-zinc-600 font-semibold mb-1">
                  Also send to {state.contacts.length === 0 ? '' : '(optional)'}
                </label>
                <input
                  type="text"
                  value={extra}
                  onChange={(e) => setExtra(e.target.value)}
                  placeholder="driver@example.com, coordinator@example.com"
                  className="w-full px-2.5 py-1.5 border border-zinc-300 rounded-lg text-[13px]"
                />
                {badExtra.length > 0 && (
                  <div className="mt-1 text-[11px] text-red-700">
                    Not an email address: {badExtra.join(', ')}
                  </div>
                )}
                {extraList.length > state.maxExtraRecipients && (
                  <div className="mt-1 text-[11px] text-red-700">
                    Up to {state.maxExtraRecipients} extra addresses per send.
                  </div>
                )}
              </div>

              <div>
                <label className="block text-[10px] uppercase tracking-wider text-zinc-600 font-semibold mb-1">
                  Anything specific to this pickup (optional)
                </label>
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  rows={2}
                  placeholder="The van is in the north row, nose out. Leave the lot key on the seat when you return."
                  className="w-full px-2.5 py-1.5 border border-zinc-300 rounded-lg text-[13px]"
                />
              </div>

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

              <div className="flex flex-wrap items-center gap-3">
                <button
                  onClick={() => void send()}
                  disabled={busy || !canSend}
                  className="px-3 py-1.5 rounded-lg text-[12px] font-semibold text-white bg-amber-600 hover:bg-amber-500 disabled:bg-zinc-300"
                >
                  {busy ? 'Sending…' : state.last ? 'Send again' : 'Email the pickup instructions'}
                </button>
                <span className="text-[11px] text-zinc-600">
                  Address, gate code, driver&rsquo;s license reminder, then plate + lock box code per unit
                  {state.lockboxInstructionsUrl ? (
                    <>
                      , plus the{' '}
                      <a
                        href={state.lockboxInstructionsUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="underline text-amber-700 hover:text-amber-600"
                      >
                        lock box instructions link
                      </a>
                      .
                    </>
                  ) : (
                    <>
                      . No lock box instructions link is set — add one under Admin → Assistant to include it.
                    </>
                  )}
                </span>
              </div>

              {state.last && (
                <div className="text-[11px] text-zinc-600">
                  Last sent {fmtWhen(state.last.at)}
                  {state.last.by ? ` by ${state.last.by}` : ''} · {state.last.vehicles.join(', ')} →{' '}
                  {state.last.to.join(', ')}
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
