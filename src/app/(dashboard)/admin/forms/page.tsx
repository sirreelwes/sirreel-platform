'use client';

/**
 * /admin/forms — public downloadable forms for the marketing site
 * (requireAdmin on every API call). Reuses the site-settings pattern.
 *
 * PUBLIC forms only: Sample COI, W-9, Rental Agreement, Studio Contract.
 * There are intentionally NO slots for ACH / payment info (request-only
 * via the contact intake) or Credit-Card Authorization (CardPointe's
 * domain — SirReel never stores or serves card data).
 *
 * Each uploads a PDF to the PRIVATE Blob store and is served publicly
 * through /api/public/forms/[slot].
 */

import { useCallback, useEffect, useRef, useState } from 'react';

type Slot = 'coi' | 'w9' | 'rental-agreement' | 'studio-contract';

interface FormsState {
  coi: boolean;
  w9: boolean;
  rentalAgreement: boolean;
  studioContract: boolean;
  updatedAt: string | null;
}

const SLOTS: { slot: Slot; title: string; stateKey: keyof FormsState }[] = [
  { slot: 'coi', title: 'Sample COI', stateKey: 'coi' },
  { slot: 'w9', title: 'W-9', stateKey: 'w9' },
  { slot: 'rental-agreement', title: 'Rental Agreement', stateKey: 'rentalAgreement' },
  { slot: 'studio-contract', title: 'Studio Contract', stateKey: 'studioContract' },
];

export default function AdminFormsPage() {
  const [forms, setForms] = useState<FormsState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<Slot | null>(null);
  const [rev, setRev] = useState(0);
  const inputs = {
    coi: useRef<HTMLInputElement>(null),
    w9: useRef<HTMLInputElement>(null),
    'rental-agreement': useRef<HTMLInputElement>(null),
    'studio-contract': useRef<HTMLInputElement>(null),
  };

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/forms');
      if (res.status === 401 || res.status === 403) { setError('Admin access required.'); return; }
      setForms(await res.json());
      setError(null);
    } catch {
      setError('Failed to load forms.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const upload = async (slot: Slot, file: File) => {
    setBusy(slot);
    setError(null);
    try {
      const fd = new FormData();
      fd.set('slot', slot);
      fd.set('file', file);
      const res = await fetch('/api/admin/forms', { method: 'POST', body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data.error || `HTTP ${res.status}`); return; }
      setRev((r) => r + 1);
      await load();
    } finally {
      setBusy(null);
    }
  };

  const clear = async (slot: Slot, title: string) => {
    if (!confirm(`Remove the ${title} PDF? The Forms menu link will 404 until re-uploaded.`)) return;
    setBusy(slot);
    try {
      const res = await fetch(`/api/admin/forms?slot=${slot}`, { method: 'DELETE' });
      if (!res.ok) { const d = await res.json().catch(() => ({})); setError(d.error || `HTTP ${res.status}`); return; }
      setRev((r) => r + 1);
      await load();
    } finally {
      setBusy(null);
    }
  };

  if (loading) return <div className="p-6 text-lt-fg2">Loading…</div>;

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-bold text-lt-fg">Forms</h1>
        <p className="text-sm text-lt-fg2 mt-1">
          Public downloadable PDFs for the marketing site&rsquo;s Forms menu.
        </p>
      </div>

      {error && <div className="px-4 py-2 rounded-lg bg-chip-bad-bg text-chip-bad-fg text-sm">{error}</div>}

      <div className="space-y-4">
        {SLOTS.map(({ slot, title, stateKey }) => {
          const isSet = !!forms?.[stateKey];
          return (
            <div key={slot} className="bg-lt-card border border-lt-hairline rounded-xl p-5">
              <div className="flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <h2 className="font-semibold text-lt-fg">{title}</h2>
                  {isSet ? (
                    <a
                      href={`/api/public/forms/${slot}?v=${rev}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs text-amber-700 hover:underline"
                    >
                      Preview current PDF ↗
                    </a>
                  ) : (
                    <p className="text-xs text-lt-fg3 mt-0.5">Not uploaded — the menu link 404s until set. PDF, up to 15 MB.</p>
                  )}
                </div>
                <span className={`text-xs px-2 py-1 rounded flex-none ${isSet ? 'bg-chip-good-bg text-chip-good-fg' : 'bg-chip-neutral-bg text-chip-neutral-fg'}`}>
                  {isSet ? 'set' : 'not set'}
                </span>
              </div>
              <input
                ref={inputs[slot]}
                type="file"
                accept="application/pdf"
                className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(slot, f); e.target.value = ''; }}
              />
              <div className="flex gap-2 mt-3">
                <button
                  onClick={() => inputs[slot].current?.click()}
                  disabled={busy === slot}
                  className="px-3 py-1.5 bg-amber-600 hover:bg-amber-500 text-white text-sm font-semibold rounded-lg disabled:opacity-40 transition-colors"
                >
                  {busy === slot ? 'Uploading…' : isSet ? 'Replace PDF' : 'Upload PDF'}
                </button>
                {isSet && (
                  <button
                    onClick={() => clear(slot, title)}
                    disabled={busy === slot}
                    className="px-3 py-1.5 border border-lt-hairline text-chip-bad-fg text-sm rounded-lg hover:bg-lt-inner transition-colors"
                  >
                    Remove
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <p className="text-xs text-lt-fg3">
        Payment info / ACH is request-only (routed to the contact intake), and Credit-Card Authorization is
        handled in CardPointe — neither is uploaded or served here. Changes may take up to an hour to
        propagate through the CDN cache.
      </p>
    </div>
  );
}
