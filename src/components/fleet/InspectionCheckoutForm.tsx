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
 * The rest is unchanged in substance: no dropdowns (fuel / damage type /
 * severity are big tap-selectors), and fields mirror what
 * Inspection/CheckoutRecord already model — no invented columns.
 *
 * There is NO "overall condition" question (Wes, 2026-09-07: "don't ask
 * subjective condition of vehicles in forms"). Fuel, odometer, photos
 * and the damage list are facts; a tech's one-word verdict is not, and
 * it is the first thing a client argues with. The stored enum is derived
 * server-side from whether damage was logged.
 *
 * 2026-09-07 restyle: built on the yard kit (yard-ui / YardControls).
 * Photos first, then one Condition card, then damage, then notes; the
 * submit is pinned to the bottom of the phone with a status line that
 * says what it is waiting for.
 */

import { useCallback, useState } from 'react';
import { CheckCircle2, ArrowRight } from 'lucide-react';
import { GuidedPhotoCapture, type StagedPhoto } from './GuidedPhotoCapture';
import { DamageDraftList, damagePayload, type DamageDraft } from './DamageDraftList';
import { YardCard, YardOutcome, YardSectionTitle, yardBtnPrimary } from './yard-ui';
import { StickyBar, TapSelector, YardAlert, YardField, YardNote, yardInput, yardSubmit } from './YardControls';
import { missingPositions } from '@/lib/fleet/photoPositions';

const FUEL_LEVELS = ['full', '3/4', '1/2', '1/4', 'empty'] as const;

export function InspectionCheckoutForm({
  bookingAssignmentId,
  pickupHref,
}: {
  bookingAssignmentId: string;
  /** Where the tech goes next — the handover screen for this unit. */
  pickupHref?: string;
}) {
  const [mileage, setMileage] = useState('');
  const [fuel, setFuel] = useState<string>('full');
  const [notes, setNotes] = useState('');
  const [photos, setPhotos] = useState<StagedPhoto[]>([]);
  const [damages, setDamages] = useState<DamageDraft[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ photosAttached: number; photosMissing: number } | null>(null);
  const onPhotosChange = useCallback((next: StagedPhoto[]) => setPhotos(next), []);

  const uploadingCount = photos.filter((p) => p.status === 'uploading').length;
  const failedCount = photos.filter((p) => p.status === 'error').length;
  const savedCount = photos.filter((p) => p.status === 'done').length;
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
          mileage: mileage.trim() === '' ? null : Number(mileage),
          fuelLevel: fuel,
          notes: notes.trim() || null,
          damages: damagePayload(damages),
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
      <YardOutcome
        icon={CheckCircle2}
        title="Inspection recorded"
        actions={
          pickupHref ? (
            <a href={pickupHref} className={yardBtnPrimary}>
              Hand over to driver
              <ArrowRight size={16} aria-hidden />
            </a>
          ) : undefined
        }
      >
        <p>
          {done.photosAttached} photo{done.photosAttached === 1 ? '' : 's'} attached
          {done.photosMissing > 0 ? ` — ${done.photosMissing} could not be found and were skipped` : ''}.
        </p>
        <p className="text-zinc-400 text-[13px]">The driver&rsquo;s walk-around can be laid beside these when it comes back.</p>
      </YardOutcome>
    );
  }

  const status =
    uploadingCount > 0
      ? `Waiting for ${uploadingCount} photo${uploadingCount === 1 ? '' : 's'} to finish uploading…`
      : failedCount > 0
        ? `${failedCount} photo${failedCount === 1 ? '' : 's'} failed — tap to retry, or submit without`
        : `${savedCount} photo${savedCount === 1 ? '' : 's'} saved${missing.length ? ` · ${missing.length} angle${missing.length === 1 ? '' : 's'} not shot` : ''}`;

  return (
    <div className="space-y-5">
      {/* Same slots the return screen will expect — see the note above. */}
      <GuidedPhotoCapture bookingAssignmentId={bookingAssignmentId} onChange={onPhotosChange} />

      <YardCard>
        <YardSectionTitle hint="Read off the dash. No opinions — the photos and the damage list are the record.">
          Going out
        </YardSectionTitle>
        <div className="space-y-5">
          <YardField label="Fuel">
            <TapSelector options={FUEL_LEVELS} value={fuel} onChange={setFuel} columns={5} />
          </YardField>

          <YardField label="Odometer" optional>
            <div className="relative">
              <input
                type="number"
                inputMode="numeric"
                value={mileage}
                onChange={(e) => setMileage(e.target.value)}
                placeholder="Reading on the dash"
                className={`${yardInput} pr-12`}
              />
              <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-zinc-500 text-[14px]">mi</span>
            </div>
          </YardField>
        </div>
      </YardCard>

      <div>
        <YardSectionTitle
          aside={damages.length > 0 ? `${damages.length} noted` : undefined}
          hint="Scratches, dents, anything already on it. This is what protects the client from paying for someone else's damage."
        >
          Existing damage
        </YardSectionTitle>
        <DamageDraftList rows={damages} onChange={setDamages} rowLabel="Pre-existing damage" />
      </div>

      <YardField label="Notes" optional>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          placeholder="Anything the return check should know about…"
          className={yardInput}
        />
      </YardField>

      {missing.length > 0 && (
        <YardAlert tone="warn">
          Walk-around incomplete — no {missing.map((m) => m.label.toLowerCase()).join(', ')} shot. You can
          still submit; the gap is recorded as a gap.
        </YardAlert>
      )}
      {error && <YardAlert tone="bad">{error}</YardAlert>}

      <StickyBar status={<YardNote tone={failedCount > 0 ? 'warn' : 'muted'}>{status}</YardNote>}>
        <button type="button" onClick={submit} disabled={submitting || uploadingCount > 0} className={yardSubmit}>
          {submitting ? 'Submitting…' : 'Submit inspection'}
        </button>
      </StickyBar>
    </div>
  );
}
