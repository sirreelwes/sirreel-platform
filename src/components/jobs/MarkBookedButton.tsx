'use client';

import { useState } from 'react';
import { CalendarCheck, Loader2 } from 'lucide-react';

/**
 * "Client said yes" — record an off-portal approval and book the order in
 * one click, from the job page.
 *
 * Wes 2026-09-09: "When the client approves a quote, the units reserved
 * should show booked as should the order. If they tell us this verbally or
 * via email, we should have a button to push that isn't 'on rental'
 * because it may not have started yet, but 'booked'."
 *
 * The two halves already existed as "Mark Approved" then "Book it" — two
 * clicks on the ORDER page, which is not where anyone is standing when the
 * client calls. This is the same two transitions plus the piece that was
 * missing: firming the held units.
 *
 * It CONFIRMS before firing because the book path emails people (the
 * client's booking welcome, and any sub-rental partner on the order). The
 * panel says so rather than letting a single click send mail.
 */

interface Props {
  orderId: string;
  orderNumber: string;
  /** Refresh the job after a successful book. */
  onDone: () => void | Promise<void>;
}

interface MarkBookedResult {
  ok: boolean;
  status?: string;
  holdsFirmed?: number;
  paperworkMissing?: string[];
  error?: string;
  reason?: string;
}

export function MarkBookedButton({ orderId, orderNumber, onDone }: Props) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<MarkBookedResult | null>(null);

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch(`/api/orders/${orderId}/mark-booked`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note: note.trim() || null }),
      });
      const data: MarkBookedResult = await r.json().catch(() => ({ ok: false }));
      if (!r.ok || !data.ok) {
        setErr(data.reason || data.error || `HTTP ${r.status}`);
        return;
      }
      setDone(data);
      setOpen(false);
      await onDone();
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    const missing = done.paperworkMissing ?? [];
    return (
      <div className="mt-2 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-[12px] text-emerald-900">
        <span className="font-semibold">Booked.</span>{' '}
        {done.holdsFirmed ? `${done.holdsFirmed} held unit${done.holdsFirmed === 1 ? '' : 's'} now firm.` : 'No soft holds needed promoting.'}
        {missing.length > 0 && (
          <>
            {' '}Still outstanding: {missing.join(', ')} — the hold is riding on your say-so until those land.
          </>
        )}
      </div>
    );
  }

  if (!open) {
    return (
      <button
        onClick={(e) => { e.stopPropagation(); setOpen(true); }}
        className="ml-2 shrink-0 inline-flex items-center gap-1.5 rounded-md border border-amber-600 bg-amber-600 px-2.5 py-1 text-[12px] font-bold text-white hover:bg-amber-500 transition-colors"
        title={`Record that the client approved ${orderNumber} verbally or by email, and book it`}
      >
        <CalendarCheck className="w-3.5 h-3.5" />
        Client said yes
      </button>
    );
  }

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      className="mt-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5"
    >
      <div className="text-[13px] font-semibold text-amber-900">
        Book {orderNumber} on the client’s word
      </div>
      <ul className="mt-1.5 space-y-0.5 text-[12px] text-amber-900/90 list-disc list-inside">
        <li>Order moves to <strong>Booked</strong>; the job reads Booked too.</li>
        <li>Held units go <strong>firm</strong> — they stop reading as backup holds.</li>
        <li>Sends the client the booking confirmation, and tells any partner on this order it’s a go.</li>
      </ul>
      <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="How did they say yes? e.g. call with Laura, 9/9"
        className="mt-2 w-full rounded-md border border-amber-300 bg-white px-2.5 py-1.5 text-[13px] text-lt-fg placeholder:text-lt-fg3 focus:outline-none focus:border-amber-500"
      />
      {err && <div className="mt-1.5 text-[12px] text-rose-700">{err}</div>}
      <div className="mt-2 flex items-center gap-2">
        <button
          onClick={submit}
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-md bg-amber-600 px-3 py-1.5 text-[12px] font-bold text-white hover:bg-amber-500 disabled:opacity-50 transition-colors"
        >
          {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
          {busy ? 'Booking…' : 'Mark booked'}
        </button>
        <button
          onClick={() => { setOpen(false); setErr(null); }}
          className="text-[12px] font-semibold text-amber-900/70 hover:text-amber-900"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
