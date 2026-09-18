/**
 * The two ends of a rental, slot by slot, for the side-by-side viewer.
 *
 * Hugo, 2026-09-17: "On Damage ID, he has the ability to scroll through
 * the check out and check in photos side by side to see if there was
 * any damage done to the vehicle." The record page had the pairing —
 * each slot with the other end's shot under it as a small thumbnail —
 * but not the VIEW: two big frames of the same angle, out on the left,
 * back on the right, and a way to step through the whole walk.
 *
 * This is the list that viewer walks, built from a filed record whichever
 * end was opened. Check-out is ALWAYS the left side: the question is
 * "what changed", and that reads before → after. The walk's numbered
 * slots come first in Julian's order (both ends share the sequence —
 * that is what makes a pair a pair), then the seat rows and retired
 * angles that hold a photo, then the close-ups and free-form extras from
 * each end, which answer to no slot and so pair with nothing.
 *
 * Pure — the page loads the record and this shapes it; the test runs it
 * offline against a hand-built record.
 */

import type { FiledInspectionDetail, FiledPhoto, InspectionEdge } from '@/lib/fleet/inspectionHistory'
import { slotTitle } from '@/lib/fleet/photoStamp'
import { DAMAGE_POSITION } from '@/lib/fleet/photoPositions'

export interface CompareSide {
  id: string
  takenAt: string
}

export interface ComparePair {
  /** Stable key for the URL (`?slot=`) and the filmstrip. */
  key: string
  /** "5. Driver side rear", "Damage close-up", "Other". */
  title: string
  group: string
  /** True for a walk-around slot (both ends could have shot it). False
   *  for a close-up or extra, which exists on one end only. */
  slot: boolean
  out: CompareSide | null
  back: CompareSide | null
}

export interface CompareRecord {
  unitName: string
  category: string
  jobName: string | null
  company: string | null
  out: { inspectionId: string; at: string; inspectorName: string | null } | null
  back: { inspectionId: string; at: string; inspectorName: string | null } | null
  pairs: ComparePair[]
}

const side = (p: FiledPhoto | null): CompareSide | null =>
  p ? { id: p.id, takenAt: p.takenAt.toISOString() } : null

export function buildCompareRecord(rec: FiledInspectionDetail): CompareRecord {
  const mineIsOut = rec.edge === 'OUT'
  const me = { inspectionId: rec.inspectionId, at: rec.inspectedAt.toISOString(), inspectorName: rec.inspectorName }
  const other = rec.counterpart
    ? { inspectionId: rec.counterpart.inspectionId, at: rec.counterpart.inspectedAt.toISOString(), inspectorName: rec.counterpart.inspectorName }
    : null

  const pairs: ComparePair[] = rec.slots.map((s) => ({
    key: s.position,
    // The number is the check-OUT's (23 shots); the check-in walks the
    // same list minus the licence, so the numbers agree for every slot
    // both ends can hold.
    title: slotTitle('OUT', s.position),
    group: s.group,
    slot: true,
    out: side(mineIsOut ? s.mine : s.theirs),
    back: side(mineIsOut ? s.theirs : s.mine),
  }))

  // Close-ups and extras: one end each. Listed out first, then back, so
  // stepping past the last slot reads "what they saw going out, then what
  // came back" rather than interleaving two unrelated sets.
  const loose = (edge: InspectionEdge, photos: FiledPhoto[], kind: 'damage' | 'other') =>
    photos.map((p, i): ComparePair => ({
      key: `${edge.toLowerCase()}-${kind}-${p.id}`,
      title: `${slotTitle(edge, kind === 'damage' ? DAMAGE_POSITION : null)}${photos.length > 1 ? ` ${i + 1}` : ''}`,
      group: kind === 'damage' ? 'Damage close-ups' : 'Other photos',
      slot: false,
      out: edge === 'OUT' ? side(p) : null,
      back: edge === 'IN' ? side(p) : null,
    }))
  const mineDamage = loose(rec.edge, rec.damagePhotos, 'damage')
  const mineOther = loose(rec.edge, rec.otherPhotos, 'other')
  const theirsDamage = rec.counterpart ? loose(rec.counterpart.edge, rec.counterpart.damagePhotos, 'damage') : []
  const theirsOther = rec.counterpart ? loose(rec.counterpart.edge, rec.counterpart.otherPhotos, 'other') : []
  const outLoose = mineIsOut ? [...mineDamage, ...mineOther] : [...theirsDamage, ...theirsOther]
  const backLoose = mineIsOut ? [...theirsDamage, ...theirsOther] : [...mineDamage, ...mineOther]

  return {
    unitName: rec.unitName,
    category: rec.category,
    jobName: rec.jobName,
    company: rec.company,
    out: mineIsOut ? me : other,
    back: mineIsOut ? other : me,
    pairs: [...pairs, ...outLoose, ...backLoose],
  }
}

/** Where the viewer opens: the slot asked for, else the first pair that
 *  has a photo on either end, else 0. */
export function startIndex(pairs: ComparePair[], slot: string | null | undefined): number {
  if (slot) {
    const i = pairs.findIndex((p) => p.key === slot)
    if (i >= 0) return i
  }
  const first = pairs.findIndex((p) => p.out || p.back)
  return first >= 0 ? first : 0
}
