'use client';

/**
 * Return-side inspection form. Shares the checkout form's hardened
 * mechanics — per-photo staged upload with individual retry, tap
 * selectors instead of dropdowns, 48px targets — because it is the same
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
 *
 * 2026-09-07 restyle: on the yard kit. "How it went out" is a stat row
 * rather than a sentence, the check-out photo sits inside each slot,
 * and the submit is pinned to the bottom with its status. No "overall
 * condition" question either way (Wes: "don't ask subjective condition
 * of vehicles in forms") — see InspectionCheckoutForm.
 */

import { useCallback, useState } from 'react';
import { CheckCircle2, ArrowRight, FileText } from 'lucide-react';
import { GuidedPhotoCapture, type StagedPhoto, type ComparePhoto } from './GuidedPhotoCapture';
import { DamageDraftList, damagePayload, type DamageDraft } from './DamageDraftList';
import { YardCard, YardOutcome, YardSectionTitle, YardStat, fmtYardWhen, yardBtnPrimary, yardBtnLink } from './yard-ui';
import { StickyBar, TapSelector, YardAlert, YardField, YardNote, yardInput, yardSubmit } from './YardControls';
import { missingPositions } from '@/lib/fleet/photoPositions';

const FUEL_LEVELS = ['full', '3/4', '1/2', '1/4', 'empty'] as const;

/** Fuel as a fraction, for the "came back lower" comparison. */
const FUEL_FRACTION: Record<string, number> = { full: 1, '3/4': 0.75, '1/2': 0.5, '1/4': 0.25, empty: 0 };

export interface CheckoutSnapshot {
  inspectionDate: string;
  inspectorName: string | null;
  overallCondition: string;
  fuelLevel: string | null;
  mileage: number | null;
  notes: string | null;
  /** Check-out walk-around, shown slot-by-slot beside the new shots. */
  photos: ComparePhoto[];
  preExisting: {
    id: string;
    locationOnVehicle: string;
    damageType: string;
    severity: string;
    notes: string | null;
  }[];
}

const titleCase = (v: string) => v.charAt(0) + v.slice(1).toLowerCase().replace(/_/g, ' ');

export function InspectionReturnForm({
  bookingAssignmentId,
  checkout,
  reportHref,
}: {
  bookingAssignmentId: string;
  checkout: CheckoutSnapshot | null;
  /** The out-vs-back PDF for this unit, offered once the check-in is recorded. */
  reportHref?: string;
}) {
  const [mileage, setMileage] = useState('');
  const [fuel, setFuel] = useState<string>(checkout?.fuelLevel ?? 'full');
  const [notes, setNotes] = useState('');
  const [photos, setPhotos] = useState<StagedPhoto[]>([]);
  const [damages, setDamages] = useState<DamageDraft[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{
    photosAttached: number;
    photosMissing: number;
    damageCount: number;
    jobReturned: boolean;
  } | null>(null);
  const onPhotosChange = useCallback((next: StagedPhoto[]) => setPhotos(next), []);

  const uploadingCount = photos.filter((p) => p.status === 'uploading').length;
  const failedCount = photos.filter((p) => p.status === 'error').length;
  const savedCount = photos.filter((p) => p.status === 'done').length;
  // A PROMPT, never a lock — see the note in GuidedPhotoCapture. A tech
  // in front of a truck at 6am has to be able to record what they can
  // see; an unshot angle is recorded as unshot rather than blocking.
  const missing = missingPositions(photos.map((p) => p.position));

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
      <YardOutcome
        icon={CheckCircle2}
        tone={done.damageCount > 0 ? 'warn' : 'good'}
        title="Unit checked in"
        actions={
          <>
            <a href="/yard" className={yardBtnPrimary}>
              Back to today
              <ArrowRight size={16} aria-hidden />
            </a>
            {reportHref && (
              <a href={reportHref} target="_blank" rel="noreferrer" className={yardBtnLink}>
                <FileText size={14} aria-hidden />
                Condition report (out vs back)
              </a>
            )}
          </>
        }
      >
        <p>
          {done.photosAttached} photo{done.photosAttached === 1 ? '' : 's'} attached
          {done.photosMissing > 0 ? ` — ${done.photosMissing} could not be found and were skipped` : ''}.
        </p>
        {done.damageCount > 0 && (
          <p className="text-yellow-200">
            {done.damageCount} new damage item{done.damageCount === 1 ? '' : 's'} logged — waiting on a billing decision.
          </p>
        )}
        <p className="text-zinc-400 text-[13px]">
          {done.jobReturned
            ? 'That was the last thing out on this job — it now reads as returned.'
            : 'Other items on this job are still out.'}
        </p>
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
      {/* The comparison card. Everything below it is judged against
          this, so it sits above the form rather than in a footnote. */}
      {checkout ? (
        <YardCard>
          <YardSectionTitle
            hint={`${fmtYardWhen(checkout.inspectionDate)}${checkout.inspectorName ? ` · ${checkout.inspectorName}` : ''}`}
          >
            How it went out
          </YardSectionTitle>
          <div className="grid grid-cols-3 gap-3">
            <YardStat label="Fuel" value={checkout.fuelLevel ? titleCase(checkout.fuelLevel) : '—'} />
            <YardStat label="Odometer" value={checkout.mileage != null ? `${checkout.mileage.toLocaleString()} mi` : '—'} />
            <YardStat
              label="Damage on file"
              value={checkout.preExisting.length === 0 ? 'None' : checkout.preExisting.length}
              tone={checkout.preExisting.length ? 'warn' : undefined}
            />
          </div>
          {checkout.notes && (
            <p className="text-zinc-300 text-[14px] leading-relaxed mt-3 pl-3 border-l-2 border-zinc-700">
              {checkout.notes}
            </p>
          )}

          {checkout.preExisting.length > 0 && (
            <div className="mt-4 pt-3 border-t border-zinc-800">
              <p className="text-yellow-300 text-[13px] font-semibold mb-2">
                Already on file — do not log these again
              </p>
              <ul className="space-y-2">
                {checkout.preExisting.map((d) => (
                  <li key={d.id} className="flex items-start gap-2.5 text-[14px]">
                    <span className="flex-none mt-0.5 rounded-md bg-zinc-800 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-zinc-400">
                      On file
                    </span>
                    <span className="min-w-0 text-zinc-200">
                      {d.locationOnVehicle}
                      <span className="text-zinc-500">
                        {' '}
                        — {titleCase(d.damageType).toLowerCase()}, {d.severity.toLowerCase()}
                      </span>
                      {d.notes && <span className="text-zinc-500"> ({d.notes})</span>}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </YardCard>
      ) : (
        <YardCard tone="warn">
          <p className="text-yellow-200 text-[15px] font-semibold">This unit went out without a pre-rental inspection.</p>
          <p className="text-yellow-100/70 text-[13px] leading-relaxed mt-1">
            There is nothing to compare against, so anything you log as new damage cannot be proven new. Record
            what you see and note the gap.
          </p>
        </YardCard>
      )}

      {/* The guided walk-around — same slots the check-out shot, with
          each check-out photo inside the slot that replaces it. */}
      <GuidedPhotoCapture
        bookingAssignmentId={bookingAssignmentId}
        compareTo={checkout?.photos}
        onChange={onPhotosChange}
      />

      <YardCard>
        <YardSectionTitle hint="Read off the dash — both are compared to the check-out live.">Coming back</YardSectionTitle>
        <div className="space-y-5">
          <YardField
            label="Fuel"
            hint={fuelDown ? <YardNote tone="warn">Came back lower — {fuelDown}.</YardNote> : undefined}
          >
            <TapSelector options={FUEL_LEVELS} value={fuel} onChange={setFuel} columns={5} />
          </YardField>

          <YardField
            label="Odometer"
            optional={checkout?.mileage == null}
            hint={
              milesDriven !== null ? (
                milesDriven < 0 ? (
                  <YardNote tone="bad">
                    That is {Math.abs(milesDriven).toLocaleString()} mi BELOW the reading at check-out — check the number.
                  </YardNote>
                ) : (
                  <YardNote tone="good">{milesDriven.toLocaleString()} mi driven.</YardNote>
                )
              ) : undefined
            }
          >
            <div className="relative">
              <input
                type="number"
                inputMode="numeric"
                value={mileage}
                onChange={(e) => setMileage(e.target.value)}
                placeholder={checkout?.mileage != null ? `Out at ${checkout.mileage.toLocaleString()}` : 'Reading on the dash'}
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
          hint={
            damages.length === 0
              ? `Leave empty if it came back the way it left.${checkout && checkout.preExisting.length > 0 ? ' Damage already on file is listed above.' : ''}`
              : 'New damage goes to billing triage — somebody decides whether the client is charged.'
          }
        >
          New damage
        </YardSectionTitle>
        <DamageDraftList rows={damages} onChange={setDamages} rowLabel="New damage" />
      </div>

      <YardField label="Notes" optional>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          placeholder="Anything worth recording about how it came back…"
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
          {submitting ? 'Checking in…' : 'Check in unit'}
        </button>
      </StickyBar>
    </div>
  );
}
