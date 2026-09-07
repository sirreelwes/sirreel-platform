'use client';

/**
 * The guided walk-around, shared by check-out and check-in.
 *
 * Wes, 2026-09-02: emulate DamageID rather than invent a process. One
 * slot per angle, the SAME slots both directions, so a check-in photo
 * always has a check-out photo to sit next to. On the return screen
 * `compareTo` supplies the check-out shot and it renders INSIDE the
 * empty slot, dimmed, with the camera button over it — the tech is
 * looking at how the panel used to be while lining up how it is now,
 * which is the entire mechanism behind "was that dent there before?".
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
 *
 * 2026-09-07 restyle: slots are a two-column grid of tiles rather than
 * seven full-width cards, so the whole walk-around is visible on one
 * phone screen and the tech can see at a glance which angles are
 * still open. Previews show the WHOLE frame (contain, not cover): what
 * the tech sees in the tile is what was saved, edges included.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, Images, RotateCw, Check, X } from 'lucide-react';
import {
  REQUIRED_POSITIONS,
  DAMAGE_POSITION,
  type PhotoPosition,
} from '@/lib/fleet/photoPositions';
import { YardSectionTitle } from './yard-ui';

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

/** A check-out photo to show inside its check-in slot. */
export interface ComparePhoto {
  id: string;
  position: string | null;
}

let nextLocalId = 0;

const chipCls =
  'inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide';

export function GuidedPhotoCapture({
  bookingAssignmentId,
  compareTo,
  onChange,
  uploadEndpoint = '/api/fleet/inspections/photos/stage',
  requiredPositions = REQUIRED_POSITIONS,
  optionalPositions = [],
  title = 'Walk-around',
}: {
  bookingAssignmentId: string;
  /** Check-out photos keyed by position — return screen only. */
  compareTo?: ComparePhoto[];
  onChange: (photos: StagedPhoto[]) => void;
  /**
   * Where each photo is POSTed as taken. The staff form uses the
   * session-gated fleet route; the driver's page (blind pickup,
   * 2026-09-05) passes its own token-gated twin. Same multipart shape,
   * same response, same staging prefix — only the credential differs.
   */
  uploadEndpoint?: string;
  /** Slots that count toward "N of M". Default: the full seven. */
  requiredPositions?: readonly PhotoPosition[];
  /** Slots offered but not counted — rendered after the required ones. */
  optionalPositions?: readonly PhotoPosition[];
  title?: string;
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
        const res = await fetch(uploadEndpoint, { method: 'POST', body: fd });
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
    [bookingAssignmentId, uploadEndpoint],
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
  const doneRequired = requiredPositions.filter((s) => byPosition.has(s.id)).length;
  const allDone = doneRequired === requiredPositions.length;
  const uploading = photos.filter((p) => p.status === 'uploading').length;

  /** Upload state over a taken photo — spinner, retry, tick, remove.
   *  `compact` is for the small close-up thumbs, where a labelled chip
   *  and the remove button would collide. */
  const Overlay = ({ p, compact }: { p: StagedPhoto; compact?: boolean }) => (
    <>
      {p.status === 'uploading' && (
        <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
          <span className="text-white text-[12px] font-semibold animate-pulse">Uploading…</span>
        </div>
      )}
      {p.status === 'error' && (
        <button
          type="button"
          onClick={() => retry(p)}
          className="absolute inset-0 bg-rose-950/85 flex flex-col items-center justify-center gap-1 text-rose-200"
        >
          <RotateCw size={20} aria-hidden />
          <span className="text-[12px] font-semibold">Failed — tap to retry</span>
        </button>
      )}
      {p.status === 'done' && (
        <span
          className={`absolute top-1.5 left-1.5 ${chipCls} bg-emerald-500 text-white ${compact ? 'w-5 h-5 justify-center px-0' : ''}`}
          aria-label="Saved"
        >
          <Check size={10} aria-hidden strokeWidth={3} />
          {!compact && 'Saved'}
        </span>
      )}
      <button
        type="button"
        aria-label="Remove photo"
        onClick={() => remove(p.localId)}
        className={`absolute top-1 right-1 ${compact ? 'w-6 h-6' : 'w-8 h-8'} bg-black/70 text-zinc-200 rounded-full flex items-center justify-center active:bg-black`}
      >
        <X size={compact ? 12 : 14} aria-hidden />
      </button>
    </>
  );

  function Slot({ slot, optional }: { slot: PhotoPosition; optional?: boolean }) {
    const taken = byPosition.get(slot.id);
    const before = compareByPosition.get(slot.id);
    const beforeSrc = before ? `/api/fleet/photos/${before.id}` : null;

    return (
      <div
        className={`rounded-2xl border overflow-hidden ${
          taken ? 'border-zinc-700 bg-zinc-900' : 'border-dashed border-zinc-700 bg-zinc-900/60'
        }`}
      >
        <div className="flex items-center justify-between gap-2 px-3 pt-2.5 pb-1.5">
          <span className="text-white text-[15px] font-semibold leading-tight">{slot.label}</span>
          {taken ? null : (
            <span className={`${chipCls} ${optional ? 'bg-zinc-800 text-zinc-500' : 'bg-zinc-800 text-zinc-400'}`}>
              {optional ? 'Optional' : 'Needed'}
            </span>
          )}
        </div>

        {taken ? (
          <div className="relative aspect-[4/3] bg-zinc-950">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={taken.preview} alt={slot.label} className="w-full h-full object-contain" />
            {/* On a return, the check-out shot rides along as an inset
                so the two can be compared without leaving the tile. */}
            {beforeSrc && (
              <span className="absolute bottom-1.5 left-1.5 w-[38%] aspect-[4/3] rounded-md overflow-hidden border border-white/40 bg-zinc-950 shadow">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={beforeSrc} alt={`${slot.label} at check-out`} className="w-full h-full object-contain" loading="lazy" />
                <span className="absolute bottom-0 inset-x-0 bg-black/70 text-center text-[9px] font-bold uppercase tracking-wide text-zinc-200">
                  Out
                </span>
              </span>
            )}
            <Overlay p={taken} />
          </div>
        ) : (
          <button
            type="button"
            onClick={() => pick(slot.id, 'camera')}
            className="relative block w-full aspect-[4/3] bg-zinc-950 active:bg-zinc-900 text-zinc-200"
          >
            {beforeSrc && (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={beforeSrc}
                  alt={`${slot.label} at check-out`}
                  className="absolute inset-0 w-full h-full object-contain opacity-45"
                  loading="lazy"
                />
                <span className={`absolute top-1.5 left-1.5 ${chipCls} bg-black/70 text-zinc-200`}>Out · match this</span>
              </>
            )}
            <span className="relative flex flex-col items-center justify-center h-full gap-1.5">
              <span className="w-12 h-12 rounded-full bg-amber-600 text-white flex items-center justify-center shadow-lg">
                <Camera size={22} aria-hidden />
              </span>
              <span className="text-[14px] font-semibold drop-shadow">Take photo</span>
            </span>
          </button>
        )}

        <div className="flex items-center justify-between gap-2 px-3 py-2">
          <p className="text-zinc-500 text-[12px] leading-snug min-w-0">{slot.hint}</p>
          {taken ? (
            <button
              type="button"
              onClick={() => pick(slot.id, 'camera')}
              className="flex-none min-h-[36px] px-2 text-[13px] font-semibold text-amber-400 active:text-amber-300"
            >
              Retake
            </button>
          ) : (
            <button
              type="button"
              onClick={() => pick(slot.id, 'library')}
              aria-label={`${slot.label}: choose from camera roll`}
              className="flex-none w-9 h-9 rounded-lg text-zinc-500 active:text-white active:bg-zinc-800 flex items-center justify-center"
            >
              <Images size={16} aria-hidden />
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div>
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

      <YardSectionTitle
        aside={
          <span className={`font-semibold tabular-nums ${allDone ? 'text-emerald-400' : 'text-zinc-300'}`}>
            {doneRequired} of {requiredPositions.length}
            {uploading > 0 && <span className="text-zinc-500 font-normal"> · {uploading} uploading</span>}
          </span>
        }
        hint={compareTo?.length ? 'Same angles as the check-out. Each slot shows how it went out.' : 'Circle the vehicle, then get in.'}
      >
        {title}
      </YardSectionTitle>

      {/* Progress: one segment per required slot, in walk-around order. */}
      <div className="flex gap-1 mb-3" aria-hidden>
        {requiredPositions.map((s) => (
          <span
            key={s.id}
            className={`h-1.5 flex-1 rounded-full ${byPosition.has(s.id) ? 'bg-emerald-500' : 'bg-zinc-800'}`}
          />
        ))}
      </div>

      <div className="grid grid-cols-2 gap-2.5">
        {requiredPositions.map((slot) => (
          <Slot key={slot.id} slot={slot} />
        ))}
        {optionalPositions.map((slot) => (
          <Slot key={slot.id} slot={slot} optional />
        ))}
      </div>

      {/* Damage close-ups — unlimited, never required. */}
      <div className="mt-3 rounded-2xl border border-zinc-800 bg-zinc-900 p-3">
        <div className="flex items-baseline justify-between gap-2 mb-1">
          <span className="text-white text-[15px] font-semibold">Damage close-ups</span>
          <span className="text-zinc-500 text-[12px]">
            {damagePhotos.length > 0 ? `${damagePhotos.length} added` : 'As needed'}
          </span>
        </div>
        <p className="text-zinc-500 text-[12px] mb-2.5">Close enough to show the extent. One per spot.</p>
        {damagePhotos.length > 0 && (
          <div className="flex gap-2 overflow-x-auto pb-1 mb-2.5 -mx-1 px-1">
            {damagePhotos.map((p) => (
              <div
                key={p.localId}
                className="relative flex-none w-24 aspect-square rounded-lg overflow-hidden bg-zinc-950 border border-zinc-700"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.preview} alt="damage close-up" className="w-full h-full object-contain" />
                <Overlay p={p} compact />
              </div>
            ))}
          </div>
        )}
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => pick(DAMAGE_POSITION, 'camera')}
            className="min-h-[48px] rounded-xl border border-zinc-700 bg-zinc-950 active:bg-zinc-800 text-zinc-100 text-[14px] font-semibold inline-flex items-center justify-center gap-2"
          >
            <Camera size={16} aria-hidden />
            Close-up
          </button>
          <button
            type="button"
            onClick={() => pick(DAMAGE_POSITION, 'library')}
            className="min-h-[48px] rounded-xl border border-zinc-700 bg-zinc-950 active:bg-zinc-800 text-zinc-100 text-[14px] font-semibold inline-flex items-center justify-center gap-2"
          >
            <Images size={16} aria-hidden />
            Camera roll
          </button>
        </div>
      </div>
    </div>
  );
}
