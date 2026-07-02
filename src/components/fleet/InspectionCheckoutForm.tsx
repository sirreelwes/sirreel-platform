'use client';

/**
 * Sprint 2A — mobile-first pre-rental inspection form. Single column,
 * camera-friendly photo input. Submits to POST /api/fleet/inspections,
 * then uploads each photo to /api/fleet/inspections/[id]/photos.
 * Fields mirror what Inspection/CheckoutRecord already model — no
 * invented columns (mileageAtInspection, fuelLevel, notes, condition).
 */

import { useState } from 'react';

const CONDITIONS = ['EXCELLENT', 'GOOD', 'FAIR', 'POOR', 'DAMAGED'] as const;
const FUEL_LEVELS = ['full', '3/4', '1/2', '1/4', 'empty'] as const;
const DAMAGE_TYPES = ['SCRATCH', 'DENT', 'CRACK', 'MISSING_PART', 'MECHANICAL', 'INTERIOR', 'OTHER'] as const;
const SEVERITIES = ['MINOR', 'MODERATE', 'MAJOR'] as const;

interface DamageDraft {
  location: string;
  damageType: string;
  severity: string;
  notes: string;
}

const inputCls = 'w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2.5 text-white text-base focus:outline-none focus:border-amber-600';
const labelCls = 'block text-zinc-400 text-sm mb-1.5';

export function InspectionCheckoutForm({ bookingAssignmentId }: { bookingAssignmentId: string }) {
  const [condition, setCondition] = useState<string>('GOOD');
  const [mileage, setMileage] = useState('');
  const [fuel, setFuel] = useState<string>('full');
  const [notes, setNotes] = useState('');
  const [photos, setPhotos] = useState<File[]>([]);
  const [damages, setDamages] = useState<DamageDraft[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ photoCount: number; photoErrors: number } | null>(null);

  const addDamage = () =>
    setDamages((d) => [...d, { location: '', damageType: 'SCRATCH', severity: 'MINOR', notes: '' }]);
  const setDamage = (i: number, patch: Partial<DamageDraft>) =>
    setDamages((d) => d.map((row, j) => (j === i ? { ...row, ...patch } : row)));
  const removeDamage = (i: number) => setDamages((d) => d.filter((_, j) => j !== i));

  async function submit() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/fleet/inspections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bookingAssignmentId,
          overallCondition: condition,
          mileage: mileage.trim() === '' ? null : Number(mileage),
          fuelLevel: fuel,
          notes: notes.trim() || null,
          damages: damages
            .filter((d) => d.location.trim())
            .map((d) => ({ location: d.location, damageType: d.damageType, severity: d.severity, notes: d.notes || null })),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `submit failed (${res.status})`);

      let uploaded = 0;
      let failed = 0;
      for (const file of photos) {
        const fd = new FormData();
        fd.append('file', file);
        const up = await fetch(`/api/fleet/inspections/${data.inspectionId}/photos`, { method: 'POST', body: fd });
        if (up.ok) uploaded++;
        else failed++;
      }
      setDone({ photoCount: uploaded, photoErrors: failed });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'submit failed');
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <div className="bg-zinc-800 border border-zinc-700 rounded-xl p-5 text-center">
        <div className="text-3xl mb-2">✅</div>
        <p className="text-white font-semibold">Inspection submitted</p>
        <p className="text-zinc-400 text-sm mt-1">
          {done.photoCount} photo{done.photoCount === 1 ? '' : 's'} uploaded
          {done.photoErrors > 0 ? ` — ${done.photoErrors} failed (retry from the order page)` : ''}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <label className={labelCls}>Photos (walk-around — all four sides, interior, existing damage)</label>
        <input
          type="file"
          accept="image/*"
          capture="environment"
          multiple
          onChange={(e) => setPhotos((p) => [...p, ...Array.from(e.target.files ?? [])])}
          className="block w-full text-sm text-zinc-400 file:mr-3 file:rounded-lg file:border-0 file:bg-amber-600 file:px-4 file:py-2.5 file:text-white file:font-medium"
        />
        {photos.length > 0 && (
          <ul className="mt-2 space-y-1">
            {photos.map((f, i) => (
              <li key={i} className="flex items-center justify-between text-xs text-zinc-400 bg-zinc-800 rounded px-2 py-1.5">
                <span className="truncate">{f.name}</span>
                <button onClick={() => setPhotos((p) => p.filter((_, j) => j !== i))} className="text-zinc-500 hover:text-red-400 ml-2">✕</button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <label className={labelCls}>Overall condition</label>
        <select value={condition} onChange={(e) => setCondition(e.target.value)} className={inputCls}>
          {CONDITIONS.map((c) => <option key={c} value={c}>{c.charAt(0) + c.slice(1).toLowerCase()}</option>)}
        </select>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelCls}>Odometer</label>
          <input type="number" inputMode="numeric" value={mileage} onChange={(e) => setMileage(e.target.value)} placeholder="mi" className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>Fuel level</label>
          <select value={fuel} onChange={(e) => setFuel(e.target.value)} className={inputCls}>
            {FUEL_LEVELS.map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-1.5">
          <label className="text-zinc-400 text-sm">Existing damage</label>
          <button onClick={addDamage} className="text-amber-500 text-sm font-medium">+ Add damage</button>
        </div>
        {damages.length === 0 && <p className="text-zinc-600 text-xs">None noted — add any pre-existing scratches, dents, or issues.</p>}
        <div className="space-y-3">
          {damages.map((d, i) => (
            <div key={i} className="bg-zinc-800 border border-zinc-700 rounded-lg p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-zinc-500 text-xs">Pre-existing damage #{i + 1}</span>
                <button onClick={() => removeDamage(i)} className="text-zinc-500 hover:text-red-400 text-xs">Remove</button>
              </div>
              <input value={d.location} onChange={(e) => setDamage(i, { location: e.target.value })} placeholder="Location — e.g. driver side rear panel" className={inputCls} />
              <div className="grid grid-cols-2 gap-2">
                <select value={d.damageType} onChange={(e) => setDamage(i, { damageType: e.target.value })} className={inputCls}>
                  {DAMAGE_TYPES.map((t) => <option key={t} value={t}>{t.replace('_', ' ').toLowerCase()}</option>)}
                </select>
                <select value={d.severity} onChange={(e) => setDamage(i, { severity: e.target.value })} className={inputCls}>
                  {SEVERITIES.map((s) => <option key={s} value={s}>{s.toLowerCase()}</option>)}
                </select>
              </div>
              <input value={d.notes} onChange={(e) => setDamage(i, { notes: e.target.value })} placeholder="Notes (optional)" className={inputCls} />
            </div>
          ))}
        </div>
      </div>

      <div>
        <label className={labelCls}>Condition notes</label>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} placeholder="Anything the return check should know about…" className={inputCls} />
      </div>

      {error && <p className="text-red-400 text-sm bg-red-950/40 border border-red-900 rounded-lg px-3 py-2">{error}</p>}

      <button
        onClick={submit}
        disabled={submitting}
        className="w-full bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white font-semibold rounded-xl py-3.5 text-base"
      >
        {submitting ? 'Submitting…' : 'Submit inspection'}
      </button>
    </div>
  );
}
