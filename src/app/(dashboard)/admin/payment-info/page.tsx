'use client';

/**
 * /admin/payment-info — Wes sets/updates the payment & ACH details the
 * public request flow emails to verified clients. ADMIN-only (the API
 * enforces requireAdmin; this page is just the editor). The details
 * live in SiteSetting.paymentDetails — never in the repo, never in
 * Blob, never rendered on any public surface. Changes are audit-logged.
 */

import { useEffect, useState } from 'react';
import { FRAUD_WARNING } from '@/lib/email/templates/paymentInfo';

export default function AdminPaymentInfoPage() {
  const [value, setValue] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/admin/payment-info')
      .then((r) => r.json())
      .then((d) => {
        if (typeof d.paymentDetails === 'string') setValue(d.paymentDetails);
        setLoaded(true);
      })
      .catch(() => setError('Could not load current details.'));
  }, []);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/payment-info', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paymentDetails: value }),
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

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <header>
        <h1 className="text-2xl font-semibold text-lt-fg">Payment Info &amp; ACH</h1>
        <p className="text-sm text-lt-fg2 mt-1 max-w-[70ch]">
          These details are emailed — never displayed — to verified clients who request them via
          the public &ldquo;Payments made simple.&rdquo; page. Unknown requesters become pipeline
          inquiries instead. Every change here is logged.
        </p>
      </header>

      <div className="bg-lt-card border border-lt-hairline rounded-xl p-5 space-y-3">
        <label className="block">
          <span className="text-xs uppercase tracking-wide text-lt-fg3 font-semibold">
            Payment details (plain text, exactly as it should appear in the email)
          </span>
          <textarea
            value={value}
            onChange={(e) => setValue(e.target.value)}
            rows={12}
            disabled={!loaded}
            placeholder={'Bank name: …\nAccount name: SirReel Production Vehicles, Inc.\nRouting number: …\nAccount number: …\nRemittance email: …'}
            className="mt-2 w-full bg-lt-inner border border-lt-hairline rounded-lg p-3 text-sm text-lt-fg font-mono leading-relaxed focus:outline-none focus:border-lt-fg2"
          />
        </label>
        <div className="text-[12px] text-lt-fg3 leading-relaxed">
          The email automatically appends the fraud warning: &ldquo;{FRAUD_WARNING}&rdquo;
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
    </div>
  );
}
