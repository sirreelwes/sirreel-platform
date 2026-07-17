'use client';

/**
 * Shoot-days claims panel (Wes ruling B) — the agent-side resolution
 * surface. Renders only when the order carries day claims or resolved
 * claim history. Per line: computed vs claimed vs billable, a
 * billable-days input (NO clamping — SirReel has final say, above or
 * below the claim), optional note, Approve-as-claimed shortcut.
 * Bulk action is scoped to a (pickup, return) DATE GROUP only — no
 * global all-lines stamp (different ranges need different numbers).
 * All writes go through POST /api/orders/[id]/day-claims (session-
 * guarded, audit-logged, totals recomputed server-side).
 */

import { useMemo, useState } from 'react';

export interface DayClaimLine {
  id: string;
  description: string;
  type: string;
  department: string;
  pickupDate: string;
  returnDate: string;
  computedDays: number | null;
  claimedDays: number | null;
  claimStatus: string;
  claimNote: string | null;
  billableDays: number | null;
}

const STATUS_CHIP: Record<string, { label: string; cls: string }> = {
  PENDING: { label: 'Pending claim', cls: 'bg-amber-100 text-amber-800 border-amber-300' },
  APPROVED: { label: 'Claim approved', cls: 'bg-emerald-100 text-emerald-700 border-emerald-300' },
  ADJUSTED: { label: 'Adjusted by SirReel', cls: 'bg-sky-100 text-sky-700 border-sky-300' },
};

const ymd = (d: string) => d.slice(0, 10);

export function DayClaimsPanel({
  orderId,
  lines,
  onChanged,
}: {
  orderId: string;
  lines: DayClaimLine[];
  onChanged: () => void;
}) {
  const relevant = useMemo(
    () =>
      lines.filter(
        (l) =>
          (l.type === 'VEHICLE' || l.type === 'EQUIPMENT') &&
          l.department !== 'STAGES' &&
          (l.claimStatus !== 'NONE' || l.claimedDays != null),
      ),
    [lines],
  );
  const [drafts, setDrafts] = useState<Record<string, { days: string; note: string }>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [bulkDays, setBulkDays] = useState<Record<string, string>>({});

  if (relevant.length === 0) return null;

  const pendingCount = relevant.filter((l) => l.claimStatus === 'PENDING').length;

  // Date-range groups with 2+ pending-or-claimed lines get a bulk row.
  const groups = new Map<string, DayClaimLine[]>();
  for (const l of relevant) {
    const k = `${ymd(l.pickupDate)}|${ymd(l.returnDate)}`;
    groups.set(k, [...(groups.get(k) ?? []), l]);
  }

  const post = async (payload: Record<string, unknown>, busyKey: string) => {
    setBusy(busyKey);
    setError(null);
    try {
      const res = await fetch(`/api/orders/${orderId}/day-claims`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error || 'Failed to set billable days');
        return;
      }
      onChanged();
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="bg-amber-500/5 border border-amber-500/40 rounded-xl p-4 mb-6">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-lg">🎬</span>
        <h2 className="text-sm font-semibold text-lt-fg">Shoot-days claims</h2>
        {pendingCount > 0 && (
          <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-amber-500 text-white uppercase tracking-wider">
            {pendingCount} pending — blocks approval
          </span>
        )}
      </div>
      <p className="text-xs text-lt-fg2 mb-3">
        The client claimed working days on these lines. Billable days is authoritative once set — above or
        below the claim, SirReel has final say. Every set is logged.
      </p>

      {error && <div className="text-xs text-red-600 font-semibold mb-2">{error}</div>}

      <div className="space-y-2">
        {[...groups.entries()].map(([key, groupLines]) => {
          const [pickup, ret] = key.split('|');
          return (
            <div key={key} className="border border-lt-hairline rounded-lg bg-lt-card">
              <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-lt-hairline flex-wrap">
                <span className="text-[11px] font-semibold text-lt-fg2">
                  Rental period {pickup} → {ret}
                </span>
                {groupLines.length > 1 && (
                  <span className="inline-flex items-center gap-1.5">
                    <span className="text-[10px] text-lt-fg3">Set all {groupLines.length} lines in this range:</span>
                    <input
                      type="number"
                      min={0}
                      max={730}
                      value={bulkDays[key] ?? ''}
                      onChange={(e) => setBulkDays((p) => ({ ...p, [key]: e.target.value }))}
                      placeholder="days"
                      className="w-16 px-1.5 py-0.5 bg-lt-card border border-lt-hairline rounded text-xs text-lt-fg"
                    />
                    <button
                      disabled={busy !== null || bulkDays[key] === undefined || bulkDays[key] === ''}
                      onClick={() =>
                        void post(
                          { pickupDate: pickup, returnDate: ret, billableDays: parseInt(bulkDays[key], 10) },
                          `bulk:${key}`,
                        )
                      }
                      className="text-[10px] font-bold px-2 py-1 rounded bg-lt-fg text-white hover:bg-black disabled:opacity-40"
                    >
                      {busy === `bulk:${key}` ? '…' : 'Apply to group'}
                    </button>
                  </span>
                )}
              </div>
              {groupLines.map((l) => {
                const chip = STATUS_CHIP[l.claimStatus];
                const draft = drafts[l.id] ?? {
                  days: String(l.billableDays ?? l.claimedDays ?? l.computedDays ?? ''),
                  note: l.claimNote ?? '',
                };
                return (
                  <div key={l.id} className="px-3 py-2.5 border-b border-lt-hairline last:border-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[12.5px] font-medium text-lt-fg">{l.description}</span>
                      {chip && (
                        <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border uppercase tracking-wider ${chip.cls}`}>
                          {chip.label}
                        </span>
                      )}
                    </div>
                    <div className="mt-1 text-[11px] text-lt-fg2 flex items-center gap-3 flex-wrap">
                      <span>
                        Rental period: <b>{l.computedDays ?? '—'}d</b>
                      </span>
                      <span>
                        Client claims: <b>{l.claimedDays != null ? `${l.claimedDays}d` : '—'}</b>
                      </span>
                      <span>
                        Billable: <b>{l.billableDays != null ? `${l.billableDays}d` : 'not set'}</b>
                      </span>
                    </div>
                    <div className="mt-1.5 flex items-center gap-1.5 flex-wrap">
                      <input
                        type="number"
                        min={0}
                        max={730}
                        value={draft.days}
                        onChange={(e) => setDrafts((p) => ({ ...p, [l.id]: { ...draft, days: e.target.value } }))}
                        className="w-16 px-1.5 py-1 bg-lt-card border border-lt-hairline rounded text-xs text-lt-fg"
                        aria-label="Billable days"
                      />
                      <input
                        type="text"
                        value={draft.note}
                        onChange={(e) => setDrafts((p) => ({ ...p, [l.id]: { ...draft, note: e.target.value } }))}
                        placeholder="Note (optional — shown internally)"
                        className="flex-1 min-w-[160px] px-2 py-1 bg-lt-card border border-lt-hairline rounded text-xs text-lt-fg"
                      />
                      <button
                        disabled={busy !== null || draft.days === ''}
                        onClick={() =>
                          void post(
                            { lineId: l.id, billableDays: parseInt(draft.days, 10), note: draft.note || undefined },
                            l.id,
                          )
                        }
                        className="text-[10px] font-bold px-2.5 py-1 rounded bg-lt-fg text-white hover:bg-black disabled:opacity-40"
                      >
                        {busy === l.id ? '…' : 'Set billable days'}
                      </button>
                      {l.claimStatus === 'PENDING' && l.claimedDays != null && (
                        <button
                          disabled={busy !== null}
                          onClick={() => void post({ lineId: l.id, billableDays: l.claimedDays }, `approve:${l.id}`)}
                          className="text-[10px] font-bold px-2.5 py-1 rounded bg-emerald-600 text-white hover:bg-emerald-500 disabled:opacity-40"
                        >
                          {busy === `approve:${l.id}` ? '…' : `✓ Approve ${l.claimedDays}d`}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
