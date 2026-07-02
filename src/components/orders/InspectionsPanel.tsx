'use client';

/**
 * Sprint 2A — staff-only "Inspections" section on the internal order
 * detail page. Lists pre-rental (CHECKOUT) inspections for the order's
 * linked booking: timestamp, inspector, photo thumbnails (via the
 * session-gated /api/fleet/photos proxy — never a raw blob URL),
 * notes, and pre-existing damage items. Renders nothing when the order
 * has no booking or no inspections yet.
 */

import { useEffect, useState } from 'react';

interface PanelInspection {
  id: string;
  inspectionDate: string;
  overallCondition: string;
  mileageAtInspection: number | null;
  fuelLevel: string | null;
  notes: string | null;
  inspectedByUser: { name: string | null; email: string };
  bookingAssignment: { id: string; asset: { unitName: string } } | null;
  photos: { id: string; filename: string | null }[];
  damageItems: { id: string; locationOnVehicle: string; damageType: string; severity: string; notes: string | null }[];
}

export function InspectionsPanel({ orderId }: { orderId: string }) {
  const [inspections, setInspections] = useState<PanelInspection[] | null>(null);

  useEffect(() => {
    fetch(`/api/fleet/inspections?orderId=${orderId}`)
      .then((r) => (r.ok ? r.json() : { inspections: [] }))
      .then((d) => setInspections(d.inspections ?? []))
      .catch(() => setInspections([]));
  }, [orderId]);

  if (!inspections || inspections.length === 0) return null;

  return (
    <div className="bg-zinc-900 border border-zinc-700 rounded-xl p-5 mt-6">
      <h2 className="text-white font-semibold mb-4">🔍 Pre-Rental Inspections</h2>
      <div className="space-y-4">
        {inspections.map((insp) => (
          <div key={insp.id} className="bg-zinc-800 border border-zinc-700 rounded-lg p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2 mb-2">
              <div className="text-white text-sm font-medium">
                Unit {insp.bookingAssignment?.asset.unitName ?? '—'}
                <span className="text-zinc-500 font-normal"> · {insp.overallCondition.toLowerCase()}</span>
                {insp.mileageAtInspection != null && (
                  <span className="text-zinc-500 font-normal"> · {insp.mileageAtInspection.toLocaleString()} mi</span>
                )}
                {insp.fuelLevel && <span className="text-zinc-500 font-normal"> · fuel {insp.fuelLevel}</span>}
              </div>
              <div className="text-zinc-500 text-xs">
                {new Date(insp.inspectionDate).toLocaleString()} — {insp.inspectedByUser.name || insp.inspectedByUser.email}
              </div>
            </div>
            {insp.notes && <p className="text-zinc-400 text-sm mb-2">{insp.notes}</p>}
            {insp.damageItems.length > 0 && (
              <ul className="mb-3 space-y-1">
                {insp.damageItems.map((d) => (
                  <li key={d.id} className="text-xs text-amber-500/90">
                    ⚠ Pre-existing: {d.locationOnVehicle} — {d.damageType.replace('_', ' ').toLowerCase()} ({d.severity.toLowerCase()})
                    {d.notes ? ` — ${d.notes}` : ''}
                  </li>
                ))}
              </ul>
            )}
            {insp.photos.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {insp.photos.map((p) => (
                  <a key={p.id} href={`/api/fleet/photos/${p.id}`} target="_blank" rel="noreferrer">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={`/api/fleet/photos/${p.id}`}
                      alt={p.filename || 'inspection photo'}
                      className="h-20 w-20 object-cover rounded-lg border border-zinc-700"
                    />
                  </a>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
