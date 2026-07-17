'use client';

/**
 * /admin/payment-info — Wes sets/updates the payment & ACH details the
 * public request flow emails to verified clients, the canonical payee
 * name, and two PRIVATE-Blob PDF attachments. ADMIN-only (the API
 * enforces requireAdmin). Details/attachments are never rendered on any
 * public surface; the PDFs have no public route — they're emailed only.
 *
 * The details field is deliberately NOT inside a <form> and has no
 * Enter-to-submit binding, so multi-line entry works normally; it also
 * carries password-manager opt-outs so banking details are never
 * captured by 1Password/LastPass/etc.
 */

import { useEffect, useState } from 'react';
import { FRAUD_WARNING } from '@/lib/email/templates/paymentInfo';

type SlotKey = 'ach-form' | 'bank-info';
interface SlotState {
  filename: string | null;
  present: boolean;
}

const SLOT_LABELS: Record<SlotKey, string> = {
  'ach-form': 'ACH Payment Information Form (bank)',
  'bank-info': 'ACH / Wire Banking Information (SirReel)',
};

export default function AdminPaymentInfoPage() {
  const [details, setDetails] = useState('');
  const [payee, setPayee] = useState('');
  const [slots, setSlots] = useState<Record<SlotKey, SlotState>>({
    'ach-form': { filename: null, present: false },
    'bank-info': { filename: null, present: false },
  });
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busySlot, setBusySlot] = useState<SlotKey | null>(null);

  const load = () =>
    fetch('/api/admin/payment-info')
      .then((r) => r.json())
      .then((d) => {
        if (typeof d.paymentDetails === 'string') setDetails(d.paymentDetails);
        if (typeof d.payeeName === 'string') setPayee(d.payeeName);
        if (d.attachments) setSlots(d.attachments);
        setLoaded(true);
      })
      .catch(() => setError('Could not load current settings.'));

  useEffect(() => {
    void load();
  }, []);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/payment-info', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paymentDetails: details, payeeName: payee }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error || 'Save failed');
        return;
      }
      setSavedAt(new Date().toLocaleTimeString());
    } finally {
      setSaving(false);
    }
  };

  const uploadSlot = async (slot: SlotKey, file: File) => {
    setBusySlot(slot);
    setError(null);
    try {
      const fd = new FormData();
      fd.set('slot', slot);
      fd.set('file', file);
      const res = await fetch('/api/admin/payment-info', { method: 'POST', body: fd });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error || 'Upload failed');
        return;
      }
      await load();
    } finally {
      setBusySlot(null);
    }
  };

  const clearSlot = async (slot: SlotKey) => {
    setBusySlot(slot);
    setError(null);
    try {
      const res = await fetch(`/api/admin/payment-info?slot=${slot}`, { method: 'DELETE' });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        setError(json.error || 'Remove failed');
        return;
      }
      await load();
    } finally {
      setBusySlot(null);
    }
  };

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <header>
        <h1 className="text-2xl font-semibold text-lt-fg">Payment Info &amp; ACH</h1>
        <p className="text-sm text-lt-fg2 mt-1 max-w-[72ch]">
          These details, the payee name, and any attached PDFs are <b>emailed — never displayed</b> — to
          verified clients who request them via the public &ldquo;Payments made simple.&rdquo; page.
          Unknown requesters become pipeline inquiries instead. Every change is logged.
        </p>
      </header>

      {/* Payee name (rendered in the email; not hardcoded in the template) */}
      <div className="bg-lt-card border border-lt-hairline rounded-xl p-5 space-y-3">
        <label className="block">
          <span className="text-xs uppercase tracking-wide text-lt-fg3 font-semibold">Payee name</span>
          <input
            type="text"
            value={payee}
            disabled={!loaded}
            onChange={(e) => setPayee(e.target.value)}
            placeholder="e.g. SirReel Production Vehicles, Inc."
            autoComplete="off"
            spellCheck={false}
            data-1p-ignore
            data-lpignore="true"
            className="mt-2 w-full bg-lt-inner border border-lt-hairline rounded-lg p-2.5 text-sm text-lt-fg focus:outline-none focus:border-lt-fg2"
          />
        </label>

        <label className="block">
          <span className="text-xs uppercase tracking-wide text-lt-fg3 font-semibold">
            Payment details (one field per line, e.g. &ldquo;Routing number: 123456789&rdquo;)
          </span>
          <textarea
            value={details}
            onChange={(e) => setDetails(e.target.value)}
            rows={12}
            disabled={!loaded}
            placeholder={'Bank name: …\nAccount name: …\nRouting number: …\nAccount number: …\nRemittance email: …'}
            // Multi-line entry works: no form wrapper, no Enter handler.
            // Password-manager opt-outs keep banking details out of
            // 1Password/LastPass; spellcheck off avoids underlining codes.
            autoComplete="off"
            spellCheck={false}
            data-1p-ignore
            data-lpignore="true"
            data-form-type="other"
            className="mt-2 w-full bg-lt-inner border border-lt-hairline rounded-lg p-3 text-sm text-lt-fg font-mono leading-relaxed focus:outline-none focus:border-lt-fg2"
          />
        </label>
        <div className="text-[12px] text-lt-fg3 leading-relaxed">
          Lines with a &ldquo;Label: value&rdquo; shape render as clean rows in the email. The fraud
          warning is appended automatically as a callout: &ldquo;{FRAUD_WARNING}&rdquo;
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => void save()}
            disabled={saving || !loaded}
            className="px-4 py-2 bg-amber-600 hover:bg-amber-500 text-white text-sm font-semibold rounded-lg disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save details'}
          </button>
          {savedAt && <span className="text-xs text-emerald-700">Saved ✓ {savedAt}</span>}
          {error && <span className="text-xs text-red-600">{error}</span>}
        </div>
      </div>

      {/* PDF attachment slots — private storage, email attachment only */}
      <div className="bg-lt-card border border-lt-hairline rounded-xl p-5 space-y-4">
        <div>
          <h2 className="text-sm font-semibold text-lt-fg">PDF attachments</h2>
          <p className="text-xs text-lt-fg2 mt-0.5 max-w-[72ch]">
            Optional. Attached to the outbound email. Stored privately — there is no public link;
            they are never downloadable from the site.
          </p>
        </div>
        {(Object.keys(SLOT_LABELS) as SlotKey[]).map((slot) => (
          <div key={slot} className="flex items-center justify-between gap-3 border border-lt-hairline rounded-lg p-3">
            <div className="min-w-0">
              <div className="text-[13px] font-medium text-lt-fg">{SLOT_LABELS[slot]}</div>
              <div className="text-[11px] text-lt-fg3 truncate">
                {slots[slot].present ? (
                  <span className="text-emerald-700">✓ {slots[slot].filename || 'file on file'}</span>
                ) : (
                  <span className="italic">No file — this slot is skipped in the email.</span>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <label className="text-[11px] font-semibold bg-lt-fg hover:bg-black text-white px-3 py-1.5 rounded-lg cursor-pointer">
                {busySlot === slot ? 'Uploading…' : slots[slot].present ? 'Replace' : 'Upload PDF'}
                <input
                  type="file"
                  accept="application/pdf"
                  className="hidden"
                  disabled={busySlot === slot}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void uploadSlot(slot, f);
                    e.target.value = '';
                  }}
                />
              </label>
              {slots[slot].present && (
                <button
                  onClick={() => void clearSlot(slot)}
                  disabled={busySlot === slot}
                  className="text-[11px] font-semibold text-red-600 hover:text-red-700 px-2 py-1.5 disabled:opacity-40"
                >
                  Remove
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
