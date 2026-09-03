'use client';

/**
 * The guided walk-around, shared by check-out and check-in.
 *
 * Wes, 2026-09-02: emulate DamageID rather than invent a process. One
 * slot per angle, the SAME slots both directions, so a check-in photo
 * always has a check-out photo to sit next to. On the return screen
 * `compareTo` supplies the check-out shot and it renders directly above
 * the button that replaces it — the tech is looking at how the panel
 * used to be while photographing how it is now, which is the entire
 * mechanism behind "was that dent there before?".
 *
 * Everything about the upload path is carried over unchanged from the
 * original checkout form, because it was hardened for a real yard:
 *   - each photo uploads AS TAKEN, before the Inspection row exists, so
 *     a dropped connection costs one photo and not the session
 *   - per-photo status and individual retry
 *   - camera and camera-roll are separate inputs (iOS: capture=
 *     "environment" suppresses the library picker, so one input can't
 *     serve both)
 *
 * The required slots are a PROMPT, never a lock. A tech standing in
 * front of a truck at 6am has to be able to record what they can see;
 * missing slots warn on submit and are recorded as missing.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, Images, RotateCw, Check, X } from 'lucide-react';
import {
  REQUIRED_POSITIONS,
  DAMAGE_POSITION,
  type PhotoPosition,
} from '@/lib/fleet/photoPositions';

export interface StagedPhoto {
  localId: string;
  position: string | null;
  preview: string;
  status: 'uploading' | 'done' | 'error';
  key?: string;
  filename?: string;
  contentType?: string | null;
  error?: string;
}

/** A check-out photo to show above its check-in slot. */
export interface ComparePhoto {
  id: string;
  position: string | null;
}

let nextLocalId = 0;

function Thumb({ src, alt, badge }: { src: string; alt: string; badge?: string }) {
  return (
    <div className="relative aspect-[4/3] rounded-lg overflow-hidden bg-zinc-900 border border-zinc-700">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={alt} className="w-full h-full object-cover" loading="lazy" />
      {badge && (
        <span className="absolute bottom-1 left-1 bg-black/70 text-zinc-300 text-[10px] font-semibold rounded px-1.5 py-0.5">
          {badge}
        </span>
      )}
    </div>
  );
}

export function GuidedPhotoCapture({
  bookingAssignmentId,
  compareTo,
  onChange,
}: {
  bookingAssignmentId: string;
  /** Check-out photos keyed by position — return screen only. */
  compareTo?: ComparePhoto[];
  onChange: (photos: StagedPhoto[]) => void;
}) {
  const [photos, setPhotos] = useState<StagedPhoto[]>([]);
  const cameraInput = useRef<HTMLInputElement>(null);
  const libraryInput = useRef<HTMLInputElement>(null);
  // Which slot the next file lands in. Set right before the input is
  // clicked — the file dialog is async and the user can't change slot
  // while it's open, so a ref is both sufficient and race-free.
  const pendingPosition = useRef<string | null>(null);

  useEffect(() => {
    onChange(photos);
  }, [photos, onChange]);

  const patch = (localId: string, p: Partial<StagedPhoto>) =>
    setPhotos((all) => all.map((ph) => (ph.localId === localId ? { ...ph, ...p } : ph)));

  const upload = useCallback(
    async (draft: StagedPhoto, file: File) => {
      patch(draft.localId, { status: 'uploading', error: undefined });
      try {
        const fd = new FormData();
        fd.append('file', file);
        fd.append('bookingAssignmentId', bookingAssignmentId);
        if (draft.position) fd.append('position', draft.position);
        const res = await fetch('/api/fleet/inspections/photos/stage', { method: 'POST', body: fd });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `upload failed (${res.status})`);
        patch(draft.localId, {
          status: 'done',
          key: data.key,
          filename: data.filename,
          contentType: data.contentType ?? null,
        });
      } catch (err) {
        patch(draft.localId, {
          status: 'error',
          error: err instanceof Error ? err.message : 'upload failed',
        });
      }
    },
    [bookingAssignmentId],
  );

  // Files are held so a failed upload can be retried without asking the
  // tech to walk back round the truck and shoot it again.
  const files = useRef(new Map<string, File>());

  function addFiles(list: FileList | null) {
    if (!list?.length) return;
    const position = pendingPosition.current;
    const drafts = Array.from(list).map((file) => {
      const localId = `p${nextLocalId++}`;
      files.current.set(localId, file);
      return {
        draft: {
          localId,
          // Only the damage lane takes more than one file at a time, so
          // extras beyond the first land as damage close-ups rather than
          // silently overwriting a required slot.
          position,
          preview: URL.createObjectURL(file),
          status: 'uploading' as const,
        },
        file,
      };
    });
    setPhotos((all) => {
      // Re-shooting a required slot replaces it rather than stacking.
      const replaced = position && position !== DAMAGE_POSITION
        ? all.filter((p) => p.position !== position)
        : all;
      return [...replaced, ...drafts.map((d) => d.draft)];
    });
    drafts.forEach((d) => void upload(d.draft, d.file));
  }

  function remove(localId: string) {
    setPhotos((all) => {
      const target = all.find((p) => p.localId === localId);
      if (target) URL.revokeObjectURL(target.preview);
      files.current.delete(localId);
      return all.filter((p) => p.localId !== localId);
    });
  }

  function retry(p: StagedPhoto) {
    const file = files.current.get(p.localId);
    if (file) void upload(p, file);
  }

  function pick(position: string | null, source: 'camera' | 'library') {
    pendingPosition.current = position;
    (source === 'camera' ? cameraInput : libraryInput).current?.click();
  }

  const compareByPosition = new Map(
    (compareTo ?? []).filter((c) => c.position).map((c) => [c.position as string, c]),
  );
  const byPosition = new Map(photos.filter((p) => p.position).map((p) => [p.position as string, p]));
  const damagePhotos = photos.filter((p) => p.position === DAMAGE_POSITION);
  const doneRequired = REQUIRED_POSITIONS.filter((s) => byPosition.has(s.id)).length;

  const Overlay = ({ p }: { p: StagedPhoto }) => (
    <>
      {p.status === 'uploading' && (
        <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
          <span className="text-white text-xs animate-pulse">Uploading…</span>
        </div>
      )}
      {p.status === 'error' && (
        <button
          type="button"
          onClick={() => retry(p)}
          className="absolute inset-0 bg-red-950/80 flex flex-col items-center justify-center gap-1 text-red-300"
        >
          <RotateCw size={18} aria-hidden />
          <span className="text-xs font-medium">Failed — tap to retry</span>
        </button>
      )}
      {p.status === 'done' && (
        <span className="absolute top-1 left-1 bg-emerald-600 text-white rounded p-0.5">
          <Check size={11} aria-hidden />
        </span>
      )}
      <button
        type="button"
        aria-label="Remove photo"
        onClick={() => remove(p.localId)}
        className="absolute top-1 right-1 w-7 h-7 bg-black/70 text-zinc-300 rounded-full flex items-center justify-center"
      >
        <X size={13} aria-hidden />
      </button>
    </>
  );

  function Slot({ slot }: { slot: PhotoPosition }) {
    const taken = byPosition.get(slot.id);
    const before = compareByPosition.get(slot.id);
    return (
      <div className="rounded-xl border border-zinc-700 bg-zinc-800/40 p-3">
        <div className="flex items-baseline justify-between gap-2 mb-2">
          <span className="text-white text-sm font-semibold">{slot.label}</span>
          {taken ? (
            <span className="text-emerald-400 text-[11px] font-medium inline-flex items-center gap-1">
              <Check size={11} aria-hidden />
              Got it
            </span>
          ) : (
            <span className="text-zinc-500 text-[11px]">Needed</span>
          )}
        </div>
        <p className="text-zinc-500 text-xs mb-2">{slot.hint}</p>

        <div className={before ? 'grid grid-cols-2 gap-2' : ''}>
          {before && <Thumb src={`/api/fleet/photos/${before.id}`} alt={`${slot.label} at check-out`} badge="Out" />}
          {taken ? (
            <div className="relative aspect-[4/3] rounded-lg overflow-hidden bg-zinc-900 border border-zinc-700">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={taken.preview} alt={slot.label} className="w-full h-full object-cover" />
              {before && (
                <span className="absolute bottom-1 left-1 bg-black/70 text-zinc-300 text-[10px] font-semibold rounded px-1.5 py-0.5">
                  Back
                </span>
              )}
              <Overlay p={taken} />
            </div>
          ) : (
            <button
              type="button"
              onClick={() => pick(slot.id, 'camera')}
              className="w-full aspect-[4/3] rounded-lg border border-dashed border-zinc-600 bg-zinc-800 active:bg-zinc-700 text-zinc-300 text-sm font-semibold flex flex-col items-center justify-center gap-1.5"
            >
              <Camera size={20} aria-hidden />
              Take photo
            </button>
          )}
        </div>

        <button
          type="button"
          onClick={() => pick(slot.id, taken ? 'camera' : 'library')}
          className="mt-2 min-h-[44px] w-full text-zinc-400 text-xs active:text-zinc-200"
        >
          {taken ? 'Retake' : 'Choose from camera roll'}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
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

      <div className="flex items-baseline justify-between">
        <label className="text-zinc-400 text-sm">Walk-around</label>
        <span className={`text-xs font-medium ${doneRequired === REQUIRED_POSITIONS.length ? 'text-emerald-400' : 'text-zinc-500'}`}>
          {doneRequired} of {REQUIRED_POSITIONS.length}
        </span>
      </div>

      <div className="space-y-3">
        {REQUIRED_POSITIONS.map((slot) => (
          <Slot key={slot.id} slot={slot} />
        ))}
      </div>

      <div className="rounded-xl border border-zinc-700 bg-zinc-800/40 p-3">
        <div className="flex items-baseline justify-between gap-2 mb-2">
          <span className="text-white text-sm font-semibold">Damage close-ups</span>
          <span className="text-zinc-500 text-[11px]">
            {damagePhotos.length > 0 ? `${damagePhotos.length} added` : 'As needed'}
          </span>
        </div>
        <p className="text-zinc-500 text-xs mb-2">
          Close enough to show the extent. One per spot.
        </p>
        {damagePhotos.length > 0 && (
          <div className="grid grid-cols-3 gap-2 mb-2">
            {damagePhotos.map((p) => (
              <div key={p.localId} className="relative aspect-square rounded-lg overflow-hidden bg-zinc-900 border border-zinc-700">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.preview} alt="damage close-up" className="w-full h-full object-cover" />
                <Overlay p={p} />
              </div>
            ))}
          </div>
        )}
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => pick(DAMAGE_POSITION, 'camera')}
            className="min-h-[48px] bg-zinc-800 border border-zinc-700 active:bg-zinc-700 text-zinc-200 text-sm font-semibold rounded-lg inline-flex items-center justify-center gap-2"
          >
            <Camera size={16} aria-hidden />
            Close-up
          </button>
          <button
            type="button"
            onClick={() => pick(DAMAGE_POSITION, 'library')}
            className="min-h-[48px] bg-zinc-800 border border-zinc-700 active:bg-zinc-700 text-zinc-200 text-sm font-semibold rounded-lg inline-flex items-center justify-center gap-2"
          >
            <Images size={16} aria-hidden />
            Camera roll
          </button>
        </div>
      </div>
    </div>
  );
}
