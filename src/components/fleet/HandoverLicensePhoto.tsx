'use client';

/**
 * The driver's-license shot, at the moment the keys move.
 *
 * Julian, 2026-09-15: the licence is the last shot of the check-out
 * walk-around, and it is needed "even though it may have been uploaded"
 * from the driver's email check-in — productions swap drivers, and the
 * photo at the truck is the record of who actually drove off. But the
 * walk-around is often done before the driver turns up, so its licence
 * slot can be empty by design. This card fills it here, into the SAME
 * slot on the filed check-out (POST /api/fleet/inspections/[id]/photos
 * with position DRIVERS_LICENSE), so the record reads one way no matter
 * which screen took it. A second shot is allowed — a swapped driver —
 * and the filed record shows the newest.
 */

import { useRef, useState } from 'react';
import { Camera, Check, RotateCw } from 'lucide-react';
import { DRIVERS_LICENSE_POSITION } from '@/lib/fleet/photoPositions';

export function HandoverLicensePhoto({
  inspectionId,
  existingPhotoId,
}: {
  inspectionId: string;
  /** The newest licence photo already on the check-out, if any. */
  existingPhotoId: string | null;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [photoId, setPhotoId] = useState<string | null>(existingPhotoId);
  const [takenHere, setTakenHere] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lastFile = useRef<File | null>(null);

  async function upload(file: File) {
    lastFile.current = file;
    setBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('position', DRIVERS_LICENSE_POSITION);
      const res = await fetch(`/api/fleet/inspections/${inspectionId}/photos`, { method: 'POST', body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `upload failed (${res.status})`);
      setPhotoId(data.photo?.id ?? null);
      setTakenHere(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'upload failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      className={`mb-5 rounded-xl border p-3 ${photoId ? 'border-zinc-700 bg-zinc-800/40' : 'border-amber-600 bg-zinc-800'}`}
    >
      <input
        ref={input}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) void upload(f);
        }}
      />
      <div className="flex items-baseline justify-between gap-2 mb-1">
        <span className="text-white text-base font-semibold">Driver&rsquo;s license photo</span>
        {photoId ? (
          <span className="text-emerald-400 text-[13px] font-medium inline-flex items-center gap-1">
            <Check size={13} aria-hidden />
            {takenHere ? 'Added to the check-out' : 'On the check-out'}
          </span>
        ) : (
          <span className="text-amber-400 text-[13px] font-medium">Needed</span>
        )}
      </div>
      <p className="text-zinc-400 text-[13px] mb-2">
        {photoId
          ? 'If a different driver is taking it, shoot their license too.'
          : 'Shoot the license of whoever is driving it off — even if one is already on file.'}
      </p>

      {photoId && (
        <a href={`/api/fleet/photos/${photoId}`} target="_blank" rel="noreferrer" className="block mb-2">
          {/* Private blob, streamed behind the HQ session. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`/api/fleet/photos/${photoId}`}
            alt="Driver's license"
            className="w-full aspect-[4/3] object-cover rounded-lg border border-zinc-700"
          />
        </a>
      )}

      {error && (
        <p className="text-red-400 text-sm bg-red-950/40 border border-red-900 rounded-lg px-3 py-2 mb-2">{error}</p>
      )}

      <button
        type="button"
        disabled={busy}
        onClick={() => (error && lastFile.current ? void upload(lastFile.current) : input.current?.click())}
        className="w-full min-h-[48px] bg-zinc-800 border border-zinc-600 active:bg-zinc-700 disabled:opacity-50 text-zinc-100 text-base font-semibold rounded-lg inline-flex items-center justify-center gap-2"
      >
        {error ? <RotateCw size={16} aria-hidden /> : <Camera size={16} aria-hidden />}
        {busy ? 'Uploading…' : error ? 'Retry upload' : photoId ? 'Different driver — take another' : 'Take license photo'}
      </button>
    </section>
  );
}
