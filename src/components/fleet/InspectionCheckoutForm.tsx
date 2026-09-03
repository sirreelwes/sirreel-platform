'use client';

/**
 * Mobile-first pre-rental inspection form.
 *
 * Photo capture moved to the shared GuidedPhotoCapture on 2026-09-02
 * (Wes: emulate the DamageID process). It is deliberately the SAME
 * component the return screen uses: DamageID's mechanism is that the
 * same angles are shot both directions so they can be compared, and
 * that only works if the check-out fills the slots the check-in expects.
 * A free-form pass here would leave every return with nothing to sit
 * beside. The hardened upload path — per-photo staged upload, individual
 * retry, separate camera and camera-roll inputs — went with it.
 *
 * The rest is unchanged: no dropdowns (condition / fuel / damage type /
 * severity are big tap-selectors), and fields mirror what
 * Inspection/CheckoutRecord already model — no invented columns.
 */

import { useCallback, useState } from 'react';
import { CheckCircle2, ArrowRight } from 'lucide-react';
import { GuidedPhotoCapture, type StagedPhoto } from './GuidedPhotoCapture';
import { missingPositions } from '@/lib/fleet/photoPositions';

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

const inputCls =
  'w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-3 text-white text-base focus:outline-none focus:border-amber-600';
const labelCls = 'block text-zinc-400 text-sm mb-1.5';

function TapSelector({
  options,
  value,
  onChange,
  format,
  columns,
}: {
  options: readonly string[];
  value: string;
  onChange: (v: string) => void;
  format?: (v: string) => string;
  columns?: number;
}) {
  return (
    <div
      className={columns ? 'grid gap-2' : 'flex flex-wrap gap-2'}
      style={columns ? { gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` } : undefined}
    >
      {options.map((opt) => {
        const selected = value === opt;
        return (
          <button
            key={opt}
            type="button"
            aria-pressed={selected}
            onClick={() => onChange(opt)}
            className={`min-h-[48px] px-4 rounded-lg border text-base font-medium ${
              columns ? '' : 'flex-1 basis-[30%]'
            } ${
              selected
                ? 'bg-amber-600 border-amber-500 text-white'
                : 'bg-zinc-800 border-zinc-700 text-zinc-300 active:bg-zinc-700'
            }`}
          >
            {format ? format(opt) : opt}
          </button>
        );
      })}
    </div>
  );
}

export function InspectionCheckoutForm({ bookingAssignmentId }: { bookingAssignmentId: string }) {
  const [condition, setCondition] = useState<string>('GOOD');
  const [mileage, setMileage] = useState('');
  const [fuel, setFuel] = useState<string>('full');
  const [notes, setNotes] = useState('');
  const [photos, setPhotos] = useState<StagedPhoto[]>([]);
  const [damages, setDamages] = useState<DamageDraft[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ photosAttached: number; photosMissing: number } | null>(null);
  const onPhotosChange = useCallback((next: StagedPhoto[]) => setPhotos(next), []);

  const addDamage = () =>
    setDamages((d) => [...d, { location: '', damageType: 'SCRATCH', severity: 'MINOR', notes: '' }]);
  const setDamage = (i: number, patch: Partial<DamageDraft>) =>
    setDamages((d) => d.map((row, j) => (j === i ? { ...row, ...patch } : row)));
  const removeDamage = (i: number) => setDamages((d) => d.filter((_, j) => j !== i));

  const uploadingCount = photos.filter((p) => p.status === 'uploading').length;
  const failedCount = photos.filter((p) => p.status === 'error').length;
  // A PROMPT, never a lock — see the note in GuidedPhotoCapture. A tech
  // in front of a truck at 6am has to be able to record what they can
  // see; an unshot angle is recorded as unshot rather than blocking.
  const missing = missingPositions(photos.map((p) => p.position));

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
          stagedPhotos: photos
            .filter((p) => p.status === 'done' && p.key)
            .map((p) => ({
              key: p.key,
              filename: p.filename ?? null,
              contentType: p.contentType ?? null,
              position: p.position,
            })),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `submit failed (${res.status})`);
      setDone({ photosAttached: data.photosAttached ?? 0, photosMissing: data.photosMissing ?? 0 });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'submit failed');
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <div className="bg-zinc-800 border border-zinc-700 rounded-xl p-5 text-center">
        <CheckCircle2 size={30} aria-hidden className="mx-auto mb-2 text-emerald-500" />
        <p className="text-white font-semibold">Inspection submitted</p>
        <p className="text-zinc-400 text-sm mt-1">
          {done.photosAttached} photo{done.photosAttached === 1 ? '' : 's'} attached
          {done.photosMissing > 0 ? ` — ${done.photosMissing} could not be found and were skipped` : ''}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Same slots the return screen will expect — see the note above. */}
      <GuidedPhotoCapture bookingAssignmentId={bookingAssignmentId} onChange={onPhotosChange} />

      <div>
        <label className={labelCls}>Overall condition</label>
        <TapSelector
          options={CONDITIONS}
          value={condition}
          onChange={setCondition}
          format={(c) => c.charAt(0) + c.slice(1).toLowerCase()}
        />
      </div>

      <div>
        <label className={labelCls}>Fuel level</label>
        <TapSelector options={FUEL_LEVELS} value={fuel} onChange={setFuel} columns={5} />
      </div>

      <div>
        <label className={labelCls}>Odometer (optional)</label>
        <input
          type="number"
          inputMode="numeric"
          value={mileage}
          onChange={(e) => setMileage(e.target.value)}
          placeholder="mi"
          className={inputCls}
        />
      </div>

      <div>
        <div className="flex items-center justify-between mb-1.5">
          <label className="text-zinc-400 text-sm">Existing damage</label>
          <button type="button" onClick={addDamage} className="min-h-[44px] px-3 text-amber-500 text-base font-medium">
            + Add damage
          </button>
        </div>
        {damages.length === 0 && (
          <p className="text-zinc-600 text-xs">None noted — add any pre-existing scratches, dents, or issues.</p>
        )}
        <div className="space-y-3">
          {damages.map((d, i) => (
            <div key={i} className="bg-zinc-800/60 border border-zinc-700 rounded-lg p-3 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-zinc-500 text-xs">Pre-existing damage #{i + 1}</span>
                <button
                  type="button"
                  onClick={() => removeDamage(i)}
                  className="min-h-[44px] px-3 text-zinc-500 active:text-red-400 text-sm"
                >
                  Remove
                </button>
              </div>
              <input
                value={d.location}
                onChange={(e) => setDamage(i, { location: e.target.value })}
                placeholder="Location — e.g. driver side rear panel"
                className={inputCls}
              />
              <TapSelector
                options={DAMAGE_TYPES}
                value={d.damageType}
                onChange={(v) => setDamage(i, { damageType: v })}
                format={(t) => t.replace('_', ' ').toLowerCase()}
              />
              <TapSelector
                options={SEVERITIES}
                value={d.severity}
                onChange={(v) => setDamage(i, { severity: v })}
                format={(s) => s.toLowerCase()}
                columns={3}
              />
              <input
                value={d.notes}
                onChange={(e) => setDamage(i, { notes: e.target.value })}
                placeholder="Notes (optional)"
                className={inputCls}
              />
            </div>
          ))}
        </div>
      </div>

      <div>
        <label className={labelCls}>Condition notes (optional)</label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          placeholder="Anything the return check should know about…"
          className={inputCls}
        />
      </div>

      {missing.length > 0 && (
        <p className="text-amber-400/90 text-xs bg-amber-950/30 border border-amber-900/60 rounded-lg px-3 py-2">
          Walk-around incomplete — no {missing.map((m) => m.label.toLowerCase()).join(', ')} shot.
          {' '}You can still submit; the gap is recorded as a gap.
        </p>
      )}
      {error && <p className="text-red-400 text-sm bg-red-950/40 border border-red-900 rounded-lg px-3 py-2">{error}</p>}

      <button
        type="button"
        onClick={submit}
        disabled={submitting || uploadingCount > 0}
        className="w-full bg-amber-600 active:bg-amber-500 disabled:opacity-50 text-white font-semibold rounded-xl py-4 text-lg"
      >
        {submitting
          ? 'Submitting…'
          : uploadingCount > 0
            ? `Waiting for ${uploadingCount} photo${uploadingCount === 1 ? '' : 's'}…`
            : 'Submit inspection'}
      </button>
      {failedCount > 0 && (
        <p className="text-zinc-500 text-xs text-center -mt-3">
          Failed photos won&apos;t be attached unless retried.
        </p>
      )}
    </div>
  );
}
