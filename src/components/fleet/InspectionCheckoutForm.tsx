'use client';

/**
 * Sprint 2A — mobile-first pre-rental inspection form, hardened for
 * real phone use in the yard:
 *   - Each photo uploads AS TAKEN to /api/fleet/inspections/photos/stage
 *     (thumbnail + uploading/failed state per photo, individual retry —
 *     one bad upload never blocks the rest).
 *   - Submit only finalizes: POST /api/fleet/inspections with the staged
 *     blob keys. Bytes are never re-sent.
 *   - Camera capture AND camera-roll selection are separate buttons
 *     (capture="environment" suppresses the library picker on iOS, so
 *     one input can't serve both).
 *   - No dropdowns: condition / fuel / damage type / severity are big
 *     tap-selectors. Fields mirror what Inspection/CheckoutRecord
 *     already model — no invented columns.
 */

import { useRef, useState } from 'react';

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

interface PhotoDraft {
  localId: string;
  file: File;
  preview: string; // object URL for the thumbnail
  status: 'uploading' | 'done' | 'error';
  key?: string; // staged blob key once uploaded
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

export function InspectionCheckoutForm({ bookingAssignmentId }: { bookingAssignmentId: string }) {
  const [condition, setCondition] = useState<string>('GOOD');
  const [mileage, setMileage] = useState('');
  const [fuel, setFuel] = useState<string>('full');
  const [notes, setNotes] = useState('');
  const [photos, setPhotos] = useState<PhotoDraft[]>([]);
  const [damages, setDamages] = useState<DamageDraft[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ photosAttached: number; photosMissing: number } | null>(null);
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
    // fire-and-forget: each photo uploads independently, in parallel
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
            .map((p) => ({ key: p.key, filename: p.filename ?? null, contentType: p.contentType ?? null })),
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
        <div className="text-3xl mb-2">✅</div>
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
      <div>
        <label className={labelCls}>Photos (walk-around — all four sides, interior, existing damage)</label>
        {/* iOS: capture="environment" locks the input to the camera, so the
            library needs its own un-captured input. */}
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
          <div className="grid grid-cols-3 gap-2 mt-3">
            {photos.map((p) => (
              <div key={p.localId} className="relative aspect-square rounded-lg overflow-hidden bg-zinc-800 border border-zinc-700">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.preview} alt={p.filename || 'inspection photo'} className="w-full h-full object-cover" />
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
                  <span className="absolute top-1 left-1 bg-emerald-600 text-white text-[10px] font-bold rounded px-1">✓</span>
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
            {failedCount} photo{failedCount === 1 ? '' : 's'} failed to upload — tap to retry, or remove. The rest are safe.
          </p>
        )}
      </div>

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
