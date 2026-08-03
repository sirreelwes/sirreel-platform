"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { STAGE_AREAS } from "@/lib/contracts/stageAreas";

/**
 * Sales-facing form for capturing negotiated stage-booking terms, plus a
 * "Generate Stage Contract" button that POSTs to the generator endpoint.
 *
 * Dates are picked on a real calendar (non-contiguous days are normal for
 * stage bookings — prep / shoot / strike with gaps), spaces are checkboxes
 * off the STAGE_AREAS single source with an escape hatch for anything not
 * on the list, and the day count × rate total is shown live so the rep sees
 * what the client will owe before generating.
 *
 * The API contract is unchanged: rentalDates is still string[] of
 * 'yyyy-MM-dd' and specificSpaces is still string[] of labels.
 */

interface StageContractSummary {
  id: string;
  contractType: string;
  status: string;
  documentToSignUrl: string | null;
  baselineVersion: string | null;
  updatedAt: string;
}

interface Terms {
  id?: string;
  rentalDates: string[];
  dailyRate: string;
  dayLengthHours: string;
  overtimeHourlyRate: string;
  productionOfficeRental: boolean;
  specificSpaces: string[];
  securityGuardRequired: boolean;
  salesNotes: string | null;
  updatedAt?: string;
}

const EMPTY_TERMS: Terms = {
  rentalDates: [],
  dailyRate: "",
  dayLengthHours: "12",
  overtimeHourlyRate: "",
  productionOfficeRental: false,
  specificSpaces: [],
  securityGuardRequired: false,
  salesNotes: null,
};

const AREA_LABELS = STAGE_AREAS.map((a) => a.label);
const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const DOW = ["S", "M", "T", "W", "T", "F", "S"];

/** 'yyyy-MM-dd' for a UTC-safe calendar cell. */
function iso(y: number, m: number, d: number): string {
  return `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}
function parseIso(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.trim());
  return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : null;
}
const fmtDay = (d: Date) =>
  d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

/** "Aug 10–12, Aug 15" — groups consecutive runs, matching the PDF. */
function summarizeDates(dates: string[]): string {
  const ds = dates.map(parseIso).filter((d): d is Date => !!d).sort((a, b) => +a - +b);
  if (!ds.length) return "";
  const runs: Date[][] = [[ds[0]]];
  for (let i = 1; i < ds.length; i++) {
    const prev = runs[runs.length - 1][runs[runs.length - 1].length - 1];
    if (+ds[i] - +prev === 86_400_000) runs[runs.length - 1].push(ds[i]);
    else runs.push([ds[i]]);
  }
  return runs
    .map((r) =>
      r.length === 1
        ? fmtDay(r[0])
        : `${fmtDay(r[0])}–${r[r.length - 1].toLocaleDateString("en-US", { day: "numeric", timeZone: "UTC" })}`,
    )
    .join(", ");
}

export function StageBookingTermsSection({
  orderId,
  onContractGenerated,
}: {
  orderId: string;
  onContractGenerated?: (agreement: StageContractSummary) => void;
}) {
  const [terms, setTerms] = useState<Terms>(EMPTY_TERMS);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [otherSpaces, setOtherSpaces] = useState("");
  const [cursor, setCursor] = useState(() => {
    const n = new Date();
    return { y: n.getUTCFullYear(), m: n.getUTCMonth() };
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [contract, setContract] = useState<StageContractSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  const applyTerms = useCallback((t: Terms) => {
    setTerms(t);
    setSelected(new Set(t.rentalDates));
    // Anything stored that isn't a known area goes back in the "other" box.
    setOtherSpaces(t.specificSpaces.filter((s) => !AREA_LABELS.includes(s)).join(", "));
    // Open the calendar on the first booked month so edits start in context.
    const first = t.rentalDates.map(parseIso).filter(Boolean).sort((a, b) => +a! - +b!)[0];
    if (first) setCursor({ y: first.getUTCFullYear(), m: first.getUTCMonth() });
    setDirty(false);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/orders/${orderId}/stage-booking-terms`);
      if (res.ok) {
        const d = await res.json();
        if (d.terms) {
          applyTerms({
            id: d.terms.id,
            rentalDates: d.terms.rentalDates ?? [],
            dailyRate: d.terms.dailyRate ?? "",
            dayLengthHours: d.terms.dayLengthHours != null ? String(d.terms.dayLengthHours) : "12",
            overtimeHourlyRate: d.terms.overtimeHourlyRate ?? "",
            productionOfficeRental: !!d.terms.productionOfficeRental,
            specificSpaces: d.terms.specificSpaces ?? [],
            securityGuardRequired: !!d.terms.securityGuardRequired,
            salesNotes: d.terms.salesNotes ?? null,
            updatedAt: d.terms.updatedAt,
          });
        }
        if (d.contract) setContract(d.contract);
      }
    } finally {
      setLoading(false);
    }
  }, [orderId, applyTerms]);

  useEffect(() => { load(); }, [load]);

  const patch = (p: Partial<Terms>) => { setTerms((t) => ({ ...t, ...p })); setDirty(true); };
  const toggleDay = (d: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(d) ? next.delete(d) : next.add(d);
      return next;
    });
    setDirty(true);
  };

  const sortedDates = useMemo(() => [...selected].sort(), [selected]);
  const dayCount = sortedDates.length;
  const rateNum = Number(terms.dailyRate || 0);
  const estTotal = Number.isFinite(rateNum) ? rateNum * dayCount : 0;

  // Calendar grid for the visible month.
  const grid = useMemo(() => {
    const first = new Date(Date.UTC(cursor.y, cursor.m, 1));
    const startPad = first.getUTCDay();
    const days = new Date(Date.UTC(cursor.y, cursor.m + 1, 0)).getUTCDate();
    const cells: Array<{ iso: string; day: number } | null> = Array(startPad).fill(null);
    for (let d = 1; d <= days; d++) cells.push({ iso: iso(cursor.y, cursor.m, d), day: d });
    while (cells.length % 7 !== 0) cells.push(null);
    return cells;
  }, [cursor]);

  const buildSpaces = () => {
    const extra = otherSpaces.split(/[\n,]/g).map((s) => s.trim()).filter(Boolean);
    return [...terms.specificSpaces.filter((s) => AREA_LABELS.includes(s)), ...extra];
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/orders/${orderId}/stage-booking-terms`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rentalDates: sortedDates,
          dailyRate: terms.dailyRate,
          dayLengthHours: terms.dayLengthHours || null,
          overtimeHourlyRate: terms.overtimeHourlyRate || null,
          productionOfficeRental: terms.productionOfficeRental,
          specificSpaces: buildSpaces(),
          securityGuardRequired: terms.securityGuardRequired,
          salesNotes: terms.salesNotes,
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error || `Save failed (HTTP ${res.status})`);
        return;
      }
      const d = await res.json();
      applyTerms({
        id: d.terms.id,
        rentalDates: d.terms.rentalDates ?? [],
        dailyRate: d.terms.dailyRate ?? "",
        dayLengthHours: d.terms.dayLengthHours != null ? String(d.terms.dayLengthHours) : "12",
        overtimeHourlyRate: d.terms.overtimeHourlyRate ?? "",
        productionOfficeRental: !!d.terms.productionOfficeRental,
        specificSpaces: d.terms.specificSpaces ?? [],
        securityGuardRequired: !!d.terms.securityGuardRequired,
        salesNotes: d.terms.salesNotes ?? null,
        updatedAt: d.terms.updatedAt,
      });
    } finally {
      setSaving(false);
    }
  };

  const generate = async () => {
    setGenerating(true);
    setError(null);
    try {
      const res = await fetch(`/api/orders/${orderId}/generate-stage-contract`, { method: "POST" });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error || `Generate failed (HTTP ${res.status})`);
        return;
      }
      const d = await res.json();
      setContract(d.agreement);
      onContractGenerated?.(d.agreement);
    } finally {
      setGenerating(false);
    }
  };

  const selectedAreas = terms.specificSpaces.filter((s) => AREA_LABELS.includes(s));
  // Both are required on the contract, so Generate stays disabled until
  // they're filled — clicking into a server 409 is a worse experience
  // than a disabled button with a reason on it.
  const hasDayLength = terms.dayLengthHours.trim() !== "";
  const hasOvertime = terms.overtimeHourlyRate.trim() !== "";
  const canGenerate =
    terms.id !== undefined && !saving && !dirty && hasDayLength && hasOvertime;

  return (
    <div className="bg-gradient-to-b from-zinc-900 to-zinc-950 border border-zinc-800 rounded-2xl p-5 mb-6 space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-[15px] font-semibold text-white flex items-center gap-2.5 before:content-[''] before:w-1 before:h-4 before:rounded-full before:bg-amber-500/80">
            Stage Booking Terms
          </h2>
          <div className="text-[12px] text-zinc-300 mt-1">
            The negotiated terms that print on the client&rsquo;s stage contract.
          </div>
        </div>
        {terms.updatedAt && (
          <span className="text-[11px] text-zinc-400">
            Saved {new Date(terms.updatedAt).toLocaleString()}
          </span>
        )}
      </div>

      {loading ? (
        <div className="text-[13px] text-zinc-400 py-3">Loading…</div>
      ) : (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-[auto_1fr] gap-5">
            {/* ── Calendar ── */}
            <div>
              <div className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold mb-1.5">
                Rental days
              </div>
              <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-3 w-fit">
                <div className="flex items-center justify-between mb-2">
                  <button
                    type="button"
                    onClick={() => setCursor((c) => (c.m === 0 ? { y: c.y - 1, m: 11 } : { ...c, m: c.m - 1 }))}
                    className="w-7 h-7 rounded-lg text-zinc-300 hover:bg-zinc-800"
                    aria-label="Previous month"
                  >
                    ‹
                  </button>
                  <div className="text-[13px] font-semibold text-white">
                    {MONTHS[cursor.m]} {cursor.y}
                  </div>
                  <button
                    type="button"
                    onClick={() => setCursor((c) => (c.m === 11 ? { y: c.y + 1, m: 0 } : { ...c, m: c.m + 1 }))}
                    className="w-7 h-7 rounded-lg text-zinc-300 hover:bg-zinc-800"
                    aria-label="Next month"
                  >
                    ›
                  </button>
                </div>
                <div className="grid grid-cols-7 gap-1 mb-1">
                  {DOW.map((d, i) => (
                    <div key={i} className="w-9 text-center text-[10px] font-semibold text-zinc-500">{d}</div>
                  ))}
                </div>
                <div className="grid grid-cols-7 gap-1">
                  {grid.map((cell, i) =>
                    cell === null ? (
                      <div key={i} className="w-9 h-9" />
                    ) : (
                      <button
                        key={cell.iso}
                        type="button"
                        onClick={() => toggleDay(cell.iso)}
                        className={`w-9 h-9 rounded-lg text-[13px] tabular-nums transition-colors ${
                          selected.has(cell.iso)
                            ? "bg-amber-600 text-white font-bold"
                            : "text-zinc-300 hover:bg-zinc-800"
                        }`}
                      >
                        {cell.day}
                      </button>
                    ),
                  )}
                </div>
                <div className="mt-2 pt-2 border-t border-zinc-800 flex items-center gap-2">
                  <span className="text-[12px] text-zinc-300">
                    {dayCount > 0 ? summarizeDates(sortedDates) : "Click days to select"}
                  </span>
                  {dayCount > 0 && (
                    <button
                      type="button"
                      onClick={() => { setSelected(new Set()); setDirty(true); }}
                      className="ml-auto text-[11px] text-zinc-400 hover:text-white"
                    >
                      Clear
                    </button>
                  )}
                </div>
              </div>

              {/* Day length + overtime. A production "day" is a contracted
                  number of hours, negotiated per booking — so it is set
                  HERE, before the contract is generated, and printed on
                  the contract next to the rate it qualifies. */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <label className="block">
                  <span className="block text-[10px] uppercase tracking-wider text-zinc-400 font-semibold mb-1.5">
                    Day length (hours) <span className="text-amber-400">*</span>
                  </span>
                  <input
                    type="number"
                    min="1"
                    max="24"
                    step="1"
                    value={terms.dayLengthHours}
                    onChange={(e) => patch({ dayLengthHours: e.target.value })}
                    placeholder="10"
                    className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-[15px] text-white placeholder-zinc-500 focus:outline-none focus:border-zinc-500"
                  />
                  <span className="block mt-1 text-[11px] text-zinc-500">
                    What the daily rate buys. Required — defaults to 12.
                  </span>
                </label>
                <label className="block">
                  <span className="block text-[10px] uppercase tracking-wider text-zinc-400 font-semibold mb-1.5">
                    Overtime rate (USD / hour) <span className="text-amber-400">*</span>
                  </span>
                  <input
                    type="number"
                    min="0"
                    step="25"
                    value={terms.overtimeHourlyRate}
                    onChange={(e) => patch({ overtimeHourlyRate: e.target.value })}
                    placeholder="350"
                    className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-[15px] text-white placeholder-zinc-500 focus:outline-none focus:border-zinc-500"
                  />
                  <span className="block mt-1 text-[11px] text-zinc-500">
                    Charged per hour beyond the day length. Required — enter 0 if not charged.
                  </span>
                </label>
              </div>
              <div className="text-[11px] text-zinc-400 mt-1.5">
                Non-contiguous days are fine — the contract groups runs.
              </div>
            </div>

            {/* ── Rate, spaces, options ── */}
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <label className="block">
                  <span className="block text-[10px] uppercase tracking-wider text-zinc-400 font-semibold mb-1.5">
                    Daily rate (USD)
                  </span>
                  <input
                    type="number"
                    min="0"
                    step="100"
                    value={terms.dailyRate}
                    onChange={(e) => patch({ dailyRate: e.target.value })}
                    placeholder="2500"
                    className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-[15px] text-white placeholder-zinc-500 focus:outline-none focus:border-zinc-500"
                  />
                </label>
                <div>
                  <span className="block text-[10px] uppercase tracking-wider text-zinc-400 font-semibold mb-1.5">
                    Location fee
                  </span>
                  <div className="px-3 py-2 rounded-lg border border-amber-700/40 bg-amber-950/20">
                    <div className="text-[18px] font-bold text-amber-300 tabular-nums">
                      {estTotal > 0
                        ? estTotal.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })
                        : "—"}
                    </div>
                    <div className="text-[11px] text-zinc-400">
                      {dayCount} day{dayCount === 1 ? "" : "s"}
                      {rateNum > 0 && ` × ${rateNum.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })}`}
                    </div>
                  </div>
                </div>
              </div>

              <div>
                <span className="block text-[10px] uppercase tracking-wider text-zinc-400 font-semibold mb-1.5">
                  Spaces booked
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {STAGE_AREAS.map((a) => {
                    const on = selectedAreas.includes(a.label);
                    return (
                      <button
                        key={a.key}
                        type="button"
                        onClick={() =>
                          patch({
                            specificSpaces: on
                              ? terms.specificSpaces.filter((s) => s !== a.label)
                              : [...terms.specificSpaces, a.label],
                          })
                        }
                        className={`px-3 py-1.5 rounded-lg text-[13px] font-medium border transition-colors ${
                          on
                            ? "bg-amber-600 border-amber-600 text-white"
                            : "bg-zinc-800 border-zinc-700 text-zinc-300 hover:border-zinc-600"
                        }`}
                      >
                        {on ? "✓ " : ""}{a.label}
                      </button>
                    );
                  })}
                </div>
                <input
                  value={otherSpaces}
                  onChange={(e) => { setOtherSpaces(e.target.value); setDirty(true); }}
                  placeholder="Anything else (comma separated)…"
                  className="mt-2 w-full px-3 py-1.5 bg-zinc-800 border border-zinc-700 rounded-lg text-[13px] text-white placeholder-zinc-500 focus:outline-none focus:border-zinc-500"
                />
              </div>

              <div className="flex flex-wrap gap-2">
                {([
                  ["productionOfficeRental", "Production office rental"],
                  ["securityGuardRequired", "Security guard required"],
                ] as const).map(([key, label]) => {
                  const on = terms[key];
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => patch({ [key]: !on } as Partial<Terms>)}
                      title={key === "securityGuardRequired" ? "Clause 4 — at Producer's expense" : undefined}
                      className={`px-3 py-1.5 rounded-lg text-[13px] font-medium border transition-colors ${
                        on
                          ? "bg-zinc-700 border-zinc-600 text-white"
                          : "bg-zinc-800 border-zinc-700 text-zinc-400 hover:border-zinc-600"
                      }`}
                    >
                      {on ? "✓ " : ""}{label}
                    </button>
                  );
                })}
              </div>

              <label className="block">
                <span className="block text-[10px] uppercase tracking-wider text-zinc-400 font-semibold mb-1.5">
                  Sales notes <span className="normal-case font-normal text-zinc-500">— internal, not on the contract</span>
                </span>
                <textarea
                  value={terms.salesNotes ?? ""}
                  onChange={(e) => patch({ salesNotes: e.target.value || null })}
                  rows={2}
                  placeholder="e.g. negotiated down from $3,000 — client mentioned a competing quote"
                  className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-[13px] text-white placeholder-zinc-500 focus:outline-none focus:border-zinc-500 resize-y"
                />
              </label>
            </div>
          </div>

          {error && (
            <div className="text-[13px] text-red-300 bg-red-900/20 border border-red-800 rounded-lg px-3 py-2">{error}</div>
          )}

          <div className="flex items-center gap-3 flex-wrap pt-1">
            <button
              onClick={save}
              disabled={saving}
              className="px-4 py-2 bg-zinc-700 hover:bg-zinc-600 disabled:opacity-50 text-white text-[13px] font-semibold rounded-lg transition-colors"
            >
              {saving ? "Saving…" : dirty ? "Save terms" : "Saved"}
            </button>
            <button
              onClick={generate}
              disabled={!canGenerate || generating}
              title={
                dirty ? "Save your changes first" :
                terms.id === undefined ? "Save terms before generating the contract" :
                !hasDayLength ? "Set the day length — the contract must state what a day is" :
                !hasOvertime ? "Set the overtime rate — enter 0 if overtime isn't charged" :
                "Render the pre-signed stage contract PDF"
              }
              className="px-4 py-2 bg-amber-600 hover:bg-amber-500 disabled:bg-zinc-800 disabled:text-zinc-500 text-white text-[13px] font-semibold rounded-lg transition-colors"
            >
              {generating ? "Generating…" : contract ? "Re-generate contract" : "Generate contract"}
            </button>
            {dirty && <span className="text-[11px] text-amber-300">Unsaved changes</span>}
            {contract?.documentToSignUrl && (
              <a
                href={`/api/orders/${orderId}/agreement/pdf?type=STAGE_CONTRACT`}
                target="_blank"
                rel="noreferrer"
                className="text-[13px] font-semibold text-amber-300 hover:text-amber-200 ml-auto"
              >
                View contract PDF →
              </a>
            )}
          </div>
        </>
      )}
    </div>
  );
}
