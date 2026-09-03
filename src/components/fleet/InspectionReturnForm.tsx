'use client';

/**
 * Return-side inspection form. Shares the checkout form's hardened
 * mechanics — per-photo staged upload with individual retry, tap
 * selectors instead of dropdowns, 44px targets — because it is the same
 * person on the same phone in the same yard.
 *
 * What is different is the whole point of the screen: a return check is
 * a COMPARISON, not a fresh survey. So the checkout's condition, fuel,
 * odometer and pre-existing damage are on screen while the tech works,
 * and the two places that most often go wrong are computed rather than
 * remembered:
 *
 *   - Pre-existing damage is listed BEFORE the "new damage" section and
 *     labelled as already on file. Re-logging a scratch that was on the
 *     truck when it left bills a client for someone else's dent, and a
 *     tech who never saw the checkout has no way to know.
 *   - Miles driven and fuel are worked out live from the checkout
 *     numbers, so "returned a quarter tank down" is a fact on the screen
 *     rather than arithmetic someone does later from two records.
 */

import { useRef, useState } from 'react';

const CONDITIONS = ['EXCELLENT', 'GOOD', 'FAIR', 'POOR', 'DAMAGED'] as const;
const FUEL_LEVELS = ['full', '3/4', '1/2', '1/4', 'empty'] as const;
const DAMAGE_TYPES = ['SCRATCH', 'DENT', 'CRACK', 'MISSING_PART', 'MECHANICAL', 'INTERIOR', 'OTHER'] as const;
const SEVERITIES = ['MINOR', 'MODERATE', 'MAJOR'] as const;

/** Fuel as a fraction, for the "came back lower" comparison. */
const FUEL_FRACTION: Record<string, number> = { full: 1, '3/4': 0.75, '1/2': 0.5, '1/4': 0.25, empty: 0 };

export interface CheckoutSnapshot {
  inspectionDate: string;
  inspectorName: string | null;
  overallCondition: string;
  fuelLevel: string | null;
  mileage: number | null;
  notes: string | null;
  preExisting: {
    id: string;
    locationOnVehicle: string;
    damageType: string;
    severity: string;
    notes: string | null;
  }[];
}

interface DamageDraft {
  location: string;
  damageType: string;
  severity: string;
  notes: string;
}

interface PhotoDraft {
  localId: string;
  file: File;
  preview: string;
  status: 'uploading' | 'done' | 'error';
  key?: string;
  filename?: string;
  contentType?: string | null;
  error?: string;
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

let nextLocalId = 0;

export function InspectionReturnForm({
  bookingAssignmentId,
  checkout,
}: {
  bookingAssignmentId: string;
  checkout: CheckoutSnapshot | null;
}) {
  const [condition, setCondition] = useState<string>(checkout?.overallCondition ?? 'GOOD');
  const [mileage, setMileage] = useState('');
  const [fuel, setFuel] = useState<string>(checkout?.fuelLevel ?? 'full');
  const [notes, setNotes] = useState('');
  const [photos, setPhotos] = useState<PhotoDraft[]>([]);
  const [damages, setDamages] = useState<DamageDraft[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{
    photosAttached: number;
    photosMissing: number;
    damageCount: number;
    jobReturned: boolean;
  } | null>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
  const libraryInput = useRef<HTMLInputElement>(null);

  const patchPhoto = (localId: string, patch: Partial<PhotoDraft>) =>
    setPhotos((p) => p.map((ph) => (ph.localId === localId ? { ...ph, ...patch } : ph)));

  async function uploadPhoto(draft: PhotoDraft) {
    patchPhoto(draft.localId, { status: 'uploading', error: undefined });
    try {
      const fd = new FormData();
      fd.append('file', draft.file);
      fd.append('bookingAssignmentId', bookingAssignmentId);
      const res = await fetch('/api/fleet/inspections/photos/stage', { method: 'POST', body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `upload failed (${res.status})`);
      patchPhoto(draft.localId, {
        status: 'done',
        key: data.key,
        filename: data.filename,
        contentType: data.contentType ?? null,
      });
    } catch (err) {
      patchPhoto(draft.localId, {
        status: 'error',
        error: err instanceof Error ? err.message : 'upload failed',
      });
    }
  }

  function addFiles(list: FileList | null) {
    if (!list?.length) return;
    const drafts: PhotoDraft[] = Array.from(list).map((file) => ({
      localId: `p${nextLocalId++}`,
      file,
      preview: URL.createObjectURL(file),
      status: 'uploading',
    }));
    setPhotos((p) => [...p, ...drafts]);
    drafts.forEach((d) => void uploadPhoto(d));
  }

  function removePhoto(localId: string) {
    setPhotos((p) => {
      const target = p.find((ph) => ph.localId === localId);
      if (target) URL.revokeObjectURL(target.preview);
      return p.filter((ph) => ph.localId !== localId);
    });
  }

  const addDamage = () =>
    setDamages((d) => [...d, { location: '', damageType: 'SCRATCH', severity: 'MINOR', notes: '' }]);
  const setDamage = (i: number, patch: Partial<DamageDraft>) =>
    setDamages((d) => d.map((row, j) => (j === i ? { ...row, ...patch } : row)));
  const removeDamage = (i: number) => setDamages((d) => d.filter((_, j) => j !== i));

  const uploadingCount = photos.filter((p) => p.status === 'uploading').length;
  const failedCount = photos.filter((p) => p.status === 'error').length;

  // Live comparisons against the checkout. Both are stated as facts on
  // the screen rather than left as arithmetic for whoever reads the two
  // records later.
  const milesDriven =
    checkout?.mileage != null && mileage.trim() !== '' && Number.isFinite(Number(mileage))
      ? Math.floor(Number(mileage)) - checkout.mileage
      : null;
  const fuelDown =
    checkout?.fuelLevel && FUEL_FRACTION[fuel] < FUEL_FRACTION[checkout.fuelLevel]
      ? `${checkout.fuelLevel} → ${fuel}`
      : null;

  async function submit() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/fleet/inspections/return', {
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
            .map((d) => ({
              location: d.location,
              damageType: d.damageType,
              severity: d.severity,
              notes: d.notes || null,
            })),
          stagedPhotos: photos
            .filter((p) => p.status === 'done' && p.key)
            .map((p) => ({ key: p.key, filename: p.filename ?? null, contentType: p.contentType ?? null })),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `submit failed (${res.status})`);
      setDone({
        photosAttached: data.photosAttached ?? 0,
        photosMissing: data.photosMissing ?? 0,
        damageCount: data.damageCount ?? 0,
        jobReturned: !!data.jobReturned,
      });
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
        <p className="text-white font-semibold">Unit checked in</p>
        <p className="text-zinc-400 text-sm mt-1">
          {done.photosAttached} photo{done.photosAttached === 1 ? '' : 's'} attached
          {done.photosMissing > 0 ? ` — ${done.photosMissing} could not be found and were skipped` : ''}
        </p>
        {done.damageCount > 0 && (
          <p className="text-amber-400 text-sm mt-2">
            {done.damageCount} new damage item{done.damageCount === 1 ? '' : 's'} logged — waiting on a billing
            decision.
          </p>
        )}
        <p className="text-zinc-500 text-xs mt-3">
          {done.jobReturned
            ? 'That was the last thing out on this job — it now reads as returned.'
            : 'Other items on this job are still out.'}
        </p>
        <a
          href="/yard"
          className="mt-4 inline-block rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-500"
        >
          Back to today →
        </a>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* The comparison card. Everything below it is judged against
          this, so it sits above the form rather than in a footnote. */}
      {checkout ? (
        <section className="rounded-xl border border-zinc-700 bg-zinc-800/50 p-4">
          <h2 className="text-zinc-400 text-xs font-semibold uppercase tracking-wide mb-2">
            How it went out
          </h2>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
            <span className="text-zinc-300">
              {checkout.overallCondition.charAt(0) + checkout.overallCondition.slice(1).toLowerCase()}
            </span>
            {checkout.fuelLevel && <span className="text-zinc-300">Fuel {checkout.fuelLevel}</span>}
            {checkout.mileage != null && (
              <span className="text-zinc-300">{checkout.mileage.toLocaleString()} mi</span>
            )}
          </div>
          <p className="text-zinc-500 text-xs mt-1">
            {new Date(checkout.inspectionDate).toISOString().slice(0, 16).replace('T', ' ')}
            {checkout.inspectorName ? ` · ${checkout.inspectorName}` : ''}
          </p>
          {checkout.notes && <p className="text-zinc-400 text-sm mt-2 italic">“{checkout.notes}”</p>}

          {checkout.preExisting.length > 0 && (
            <div className="mt-3 pt-3 border-t border-zinc-700">
              <p className="text-zinc-400 text-xs font-semibold mb-2">
                Already on file — do NOT log these again
              </p>
              <ul className="space-y-1.5">
                {checkout.preExisting.map((d) => (
                  <li key={d.id} className="text-sm text-zinc-300 flex gap-2">
                    <span className="text-zinc-600 flex-none">•</span>
                    <span>
                      {d.locationOnVehicle}
                      <span className="text-zinc-500">
                        {' '}
                        — {d.damageType.replace('_', ' ').toLowerCase()}, {d.severity.toLowerCase()}
                      </span>
                      {d.notes && <span className="text-zinc-500"> ({d.notes})</span>}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      ) : (
        <section className="rounded-xl border border-amber-900 bg-amber-950/40 p-4">
          <p className="text-amber-300 text-sm font-medium">This unit went out without a pre-rental inspection.</p>
          <p className="text-amber-200/70 text-xs mt-1">
            There is nothing to compare against, so anything you log as new damage cannot be proven new. Record
            what you see and note the gap.
          </p>
        </section>
      )}

      <div>
        <label className={labelCls}>Photos (all four sides, interior, anything new)</label>
        <input
          ref={cameraInput}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => {
            addFiles(e.target.files);
            e.target.value = '';
          }}
        />
        <input
          ref={libraryInput}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => {
            addFiles(e.target.files);
            e.target.value = '';
          }}
        />
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => cameraInput.current?.click()}
            className="min-h-[52px] bg-amber-600 active:bg-amber-500 text-white font-semibold rounded-lg text-base"
          >
            📷 Take photo
          </button>
          <button
            type="button"
            onClick={() => libraryInput.current?.click()}
            className="min-h-[52px] bg-zinc-800 border border-zinc-700 active:bg-zinc-700 text-zinc-200 font-semibold rounded-lg text-base"
          >
            🖼️ Camera roll
          </button>
        </div>

        {photos.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mt-3">
            {photos.map((p) => (
              <div
                key={p.localId}
                className="relative aspect-square rounded-lg overflow-hidden bg-zinc-800 border border-zinc-700"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.preview} alt={p.filename || 'return photo'} className="w-full h-full object-cover" />
                {p.status === 'uploading' && (
                  <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
                    <span className="text-white text-xs animate-pulse">Uploading…</span>
                  </div>
                )}
                {p.status === 'error' && (
                  <button
                    type="button"
                    onClick={() => void uploadPhoto(p)}
                    className="absolute inset-0 bg-red-950/80 flex flex-col items-center justify-center gap-1"
                  >
                    <span className="text-red-300 text-lg">↻</span>
                    <span className="text-red-300 text-xs font-medium">Failed — tap to retry</span>
                  </button>
                )}
                {p.status === 'done' && (
                  <span className="absolute top-1 left-1 bg-emerald-600 text-white text-[10px] font-bold rounded px-1">
                    ✓
                  </span>
                )}
                <button
                  type="button"
                  aria-label="Remove photo"
                  onClick={() => removePhoto(p.localId)}
                  className="absolute top-1 right-1 w-7 h-7 bg-black/70 text-zinc-300 rounded-full text-sm leading-none"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}
        {failedCount > 0 && (
          <p className="text-red-400 text-xs mt-2">
            {failedCount} photo{failedCount === 1 ? '' : 's'} failed to upload — tap to retry, or remove. The rest
            are safe.
          </p>
        )}
      </div>

      <div>
        <label className={labelCls}>Condition back</label>
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
        {fuelDown && <p className="text-amber-400 text-xs mt-2">Came back lower — {fuelDown}.</p>}
      </div>

      <div>
        <label className={labelCls}>Odometer{checkout?.mileage != null ? '' : ' (optional)'}</label>
        <input
          type="number"
          inputMode="numeric"
          value={mileage}
          onChange={(e) => setMileage(e.target.value)}
          placeholder={checkout?.mileage != null ? `out at ${checkout.mileage.toLocaleString()}` : 'mi'}
          className={inputCls}
        />
        {milesDriven !== null && (
          <p className={`text-xs mt-2 ${milesDriven < 0 ? 'text-red-400' : 'text-zinc-400'}`}>
            {milesDriven < 0
              ? `That is ${Math.abs(milesDriven).toLocaleString()} mi BELOW the odometer at checkout — check the reading.`
              : `${milesDriven.toLocaleString()} mi driven.`}
          </p>
        )}
      </div>

      <div>
        <div className="flex items-center justify-between mb-1.5">
          <label className="text-zinc-400 text-sm">New damage</label>
          <button type="button" onClick={addDamage} className="min-h-[44px] px-3 text-amber-500 text-base font-medium">
            + Add damage
          </button>
        </div>
        {damages.length === 0 && (
          <p className="text-zinc-600 text-xs">
            Nothing new — leave empty if it came back the way it left.
            {checkout && checkout.preExisting.length > 0 ? ' Damage already on file is listed above.' : ''}
          </p>
        )}
        <div className="space-y-3">
          {damages.map((d, i) => (
            <div key={i} className="bg-zinc-800/60 border border-zinc-700 rounded-lg p-3 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-zinc-500 text-xs">New damage #{i + 1}</span>
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
        {damages.some((d) => d.location.trim()) && (
          <p className="text-amber-400/80 text-xs mt-3">
            New damage goes to billing triage — somebody decides whether the client is charged.
          </p>
        )}
      </div>

      <div>
        <label className={labelCls}>Notes (optional)</label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          placeholder="Anything worth recording about how it came back…"
          className={inputCls}
        />
      </div>

      {error && <p className="text-red-400 text-sm bg-red-950/40 border border-red-900 rounded-lg px-3 py-2">{error}</p>}

      <button
        type="button"
        onClick={submit}
        disabled={submitting || uploadingCount > 0}
        className="w-full bg-amber-600 active:bg-amber-500 disabled:opacity-50 text-white font-semibold rounded-xl py-4 text-lg"
      >
        {submitting
          ? 'Checking in…'
          : uploadingCount > 0
            ? `Waiting for ${uploadingCount} photo${uploadingCount === 1 ? '' : 's'}…`
            : 'Check in unit'}
      </button>
      {failedCount > 0 && (
        <p className="text-zinc-500 text-xs text-center -mt-3">
          Failed photos won&apos;t be attached unless retried.
        </p>
      )}
    </div>
  );
}
