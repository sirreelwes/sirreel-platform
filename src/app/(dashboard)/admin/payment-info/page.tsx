'use client';

/**
 * /admin/payment-info — Wes sets/updates the STRUCTURED payment & ACH
 * details the public request flow emails to verified clients, plus two
 * PRIVATE-Blob PDF attachments. ADMIN-only (the API enforces
 * requireAdmin). Details/attachments are never rendered on any public
 * surface; the PDFs have no public route — they're emailed only.
 *
 * There is EXACTLY ONE way to enter banking details: these structured
 * fields (the old free-text blob is gone). Routing numbers are
 * ABA-validated server-side. All fields carry password-manager
 * opt-outs so banking details are never captured by a manager, and the
 * fields are NOT inside a <form> so nothing submits on Enter.
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

interface Details {
  payeeName: string;
  bankName: string;
  accountType: string;
  accountNumber: string;
  routingAch: string;
  routingWire: string;
  remittanceEmail: string;
  bankAddress: string;
  instructions: string;
}
const EMPTY: Details = {
  payeeName: '', bankName: '', accountType: '', accountNumber: '',
  routingAch: '', routingWire: '', remittanceEmail: '', bankAddress: '', instructions: '',
};

// Shared password-manager / autofill opt-outs for every field.
const HARDEN = {
  autoComplete: 'off',
  spellCheck: false,
  'data-1p-ignore': true,
  'data-lpignore': 'true',
  'data-form-type': 'other',
} as const;

export default function AdminPaymentInfoPage() {
  const [d, setD] = useState<Details>(EMPTY);
  const [slots, setSlots] = useState<Record<SlotKey, SlotState>>({
    'ach-form': { filename: null, present: false },
    'bank-info': { filename: null, present: false },
  });
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorField, setErrorField] = useState<string | null>(null);
  const [busySlot, setBusySlot] = useState<SlotKey | null>(null);

  const load = () =>
    fetch('/api/admin/payment-info')
      .then((r) => r.json())
      .then((data) => {
        if (data.details) setD({ ...EMPTY, ...data.details });
        if (data.attachments) setSlots(data.attachments);
        setLoaded(true);
      })
      .catch(() => setError('Could not load current settings.'));

  useEffect(() => {
    void load();
  }, []);

  const set = (k: keyof Details) => (v: string) => setD((prev) => ({ ...prev, [k]: v }));

  const save = async () => {
    setSaving(true);
    setError(null);
    setErrorField(null);
    try {
      const res = await fetch('/api/admin/payment-info', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(d),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error || 'Save failed');
        setErrorField(json.field || null);
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

  const field = (
    key: keyof Details,
    label: string,
    opts: { required?: boolean; placeholder?: string; hint?: string } = {},
  ) => (
    <label className="block">
      <span className="text-xs uppercase tracking-wide text-lt-fg3 font-semibold">
        {label} {opts.required ? <span className="text-red-500">*</span> : <span className="text-lt-fg3 normal-case">(optional)</span>}
      </span>
      <input
        type="text"
        value={d[key]}
        disabled={!loaded}
        onChange={(e) => set(key)(e.target.value)}
        placeholder={opts.placeholder}
        {...HARDEN}
        className={`mt-1.5 w-full bg-lt-inner border rounded-lg p-2.5 text-sm text-lt-fg focus:outline-none focus:border-lt-fg2 ${
          errorField === key ? 'border-red-400' : 'border-lt-hairline'
        }`}
      />
      {opts.hint && <span className="text-[11px] text-lt-fg3 mt-0.5 block">{opts.hint}</span>}
    </label>
  );

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <header>
        <h1 className="text-2xl font-semibold text-lt-fg">Payment Info &amp; ACH</h1>
        <p className="text-sm text-lt-fg2 mt-1 max-w-[72ch]">
          These details, plus any attached PDFs, are <b>emailed — never displayed</b> — to verified
          clients who request them via the public &ldquo;Payments made simple.&rdquo; page. Unknown
          requesters become pipeline inquiries instead. Changes are logged (field names only).
        </p>
      </header>

      {/* Structured banking fields — the ONLY entry path */}
      <div className="bg-lt-card border border-lt-hairline rounded-xl p-5 space-y-4">
        {field('payeeName', 'Payee / account holder name', { required: true, placeholder: 'SirReel Production Vehicles, Inc.', hint: 'The name AP matches against the bank account.' })}
        {field('bankName', 'Bank name', { required: true, placeholder: 'e.g. Chase' })}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {field('accountType', 'Account type', { required: true, placeholder: 'Checking' })}
          {field('accountNumber', 'Account number', { required: true, placeholder: 'digits only', hint: 'Digits only.' })}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {field('routingAch', 'Routing number (ACH)', { required: true, placeholder: '9 digits', hint: '9-digit ABA — validated on save.' })}
          {field('routingWire', 'Routing number (Wire)', { required: true, placeholder: '9 digits', hint: '9-digit ABA — validated on save.' })}
        </div>
        {field('remittanceEmail', 'Remittance email', { required: true, placeholder: 'ap@sirreel.com' })}
        {field('bankAddress', 'Bank address', { placeholder: 'Street, city, state ZIP' })}
        <label className="block">
          <span className="text-xs uppercase tracking-wide text-lt-fg3 font-semibold">
            Additional instructions <span className="text-lt-fg3 normal-case">(optional)</span>
          </span>
          <textarea
            value={d.instructions}
            disabled={!loaded}
            onChange={(e) => set('instructions')(e.target.value)}
            rows={3}
            placeholder="SWIFT/BIC, intermediary bank, beneficiary address — edge cases only."
            {...HARDEN}
            className="mt-1.5 w-full bg-lt-inner border border-lt-hairline rounded-lg p-2.5 text-sm text-lt-fg leading-relaxed focus:outline-none focus:border-lt-fg2"
          />
          <span className="text-[11px] text-lt-fg3 mt-0.5 block">
            For edge cases only — not a home for the core details above.
          </span>
        </label>

        <div className="text-[12px] text-lt-fg3 leading-relaxed">
          The fraud warning is appended automatically as a callout in the email: &ldquo;{FRAUD_WARNING}&rdquo;
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
