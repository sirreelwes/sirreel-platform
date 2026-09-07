'use client';

/**
 * The damage rows a tech logs on a check-out (pre-existing) or a
 * check-in (new). Both forms carried an identical copy of this — the
 * location input, the type and severity pills, the notes line — and it
 * is the one part of either form that changes shape most often.
 */

import { Plus, Trash2 } from 'lucide-react';
import { TapSelector, yardInput } from './YardControls';

export const DAMAGE_TYPES = ['SCRATCH', 'DENT', 'CRACK', 'MISSING_PART', 'MECHANICAL', 'INTERIOR', 'OTHER'] as const;
export const SEVERITIES = ['MINOR', 'MODERATE', 'MAJOR'] as const;

export interface DamageDraft {
  location: string;
  damageType: string;
  severity: string;
  notes: string;
}

export const emptyDamage = (): DamageDraft => ({ location: '', damageType: 'SCRATCH', severity: 'MINOR', notes: '' });

/** Rows that will actually be sent — a row with no location is noise. */
export const damagePayload = (rows: DamageDraft[]) =>
  rows
    .filter((d) => d.location.trim())
    .map((d) => ({ location: d.location, damageType: d.damageType, severity: d.severity, notes: d.notes || null }));

export function DamageDraftList({
  rows,
  onChange,
  rowLabel,
}: {
  rows: DamageDraft[];
  onChange: (rows: DamageDraft[]) => void;
  /** "Pre-existing damage" / "New damage" — numbered per row. */
  rowLabel: string;
}) {
  const set = (i: number, patch: Partial<DamageDraft>) =>
    onChange(rows.map((row, j) => (j === i ? { ...row, ...patch } : row)));
  const remove = (i: number) => onChange(rows.filter((_, j) => j !== i));

  return (
    <div className="space-y-3">
      {rows.map((d, i) => (
        <div key={i} className="rounded-2xl border border-zinc-800 bg-zinc-900 p-3 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-zinc-400 text-[13px] font-semibold">
              {rowLabel} #{i + 1}
            </span>
            <button
              type="button"
              onClick={() => remove(i)}
              aria-label={`Remove ${rowLabel.toLowerCase()} #${i + 1}`}
              className="min-h-[40px] px-2 inline-flex items-center gap-1 text-[13px] text-zinc-500 active:text-rose-300"
            >
              <Trash2 size={14} aria-hidden />
              Remove
            </button>
          </div>
          <input
            value={d.location}
            onChange={(e) => set(i, { location: e.target.value })}
            placeholder="Where — e.g. driver side rear panel"
            className={yardInput}
            autoFocus={!d.location}
          />
          <TapSelector
            options={DAMAGE_TYPES}
            value={d.damageType}
            onChange={(v) => set(i, { damageType: v })}
            format={(t) => t.replace('_', ' ').toLowerCase()}
          />
          <TapSelector
            options={SEVERITIES}
            value={d.severity}
            onChange={(v) => set(i, { severity: v })}
            format={(s) => s.toLowerCase()}
            columns={3}
          />
          <input
            value={d.notes}
            onChange={(e) => set(i, { notes: e.target.value })}
            placeholder="Notes (optional)"
            className={yardInput}
          />
        </div>
      ))}
      <button
        type="button"
        onClick={() => onChange([...rows, emptyDamage()])}
        className="w-full min-h-[48px] rounded-xl border border-dashed border-zinc-700 text-amber-400 text-[15px] font-semibold inline-flex items-center justify-center gap-1.5 active:bg-zinc-900"
      >
        <Plus size={16} aria-hidden />
        {rows.length === 0 ? `Add ${rowLabel.toLowerCase()}` : 'Add another'}
      </button>
    </div>
  );
}
