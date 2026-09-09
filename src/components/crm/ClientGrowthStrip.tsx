"use client";

/**
 * "Book growth" strip on /crm — new contacts added this week, month
 * and year, with new companies underneath each and the running book
 * size on the end.
 *
 * Deltas compare against the SAME POINT in the previous period (last
 * week to date, not all of last week), because a Tuesday-morning week
 * measured against a finished week reads as a 70% collapse every
 * Monday. The comparison is spelled out under each number rather than
 * left to a bare arrow.
 *
 * Counts come from /api/crm/growth — population aggregates over the
 * whole book, not the take:100 page slice, same rule as the
 * Needs-attention strip above it.
 */

import { useEffect, useState } from "react";

type GrowthPeriod = {
  key: "week" | "month" | "year";
  label: string;
  priorLabel: string;
  start: string;
  priorStart: string;
  priorEnd: string;
  people: number;
  peoplePrior: number;
  companies: number;
  companiesPrior: number;
};

type GrowthPayload = {
  generatedAt: string;
  periods: GrowthPeriod[];
  totals: { people: number; companies: number };
};

const num = (n: number) => n.toLocaleString("en-US");

const PLACEHOLDER_LABELS = ["This week", "This month", "This year"];

const formatStart = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", {
    timeZone: "America/Los_Angeles",
    month: "short",
    day: "numeric",
    year: "numeric",
  });

function DeltaChip({ current, prior }: { current: number; prior: number }) {
  const diff = current - prior;
  // A percentage against zero is not a number anyone can act on, so
  // these two cases say the plain thing instead. The sub-line under
  // the chip already carries the prior count either way.
  if (prior === 0 && current === 0) return null;
  if (prior === 0) {
    return (
      <span className="text-[11px] font-semibold px-1.5 py-0.5 rounded bg-chip-good-bg text-chip-good-fg">
        ▲ up from 0
      </span>
    );
  }
  const pct = Math.round((diff / prior) * 100);
  const tone =
    diff > 0 ? "bg-chip-good-bg text-chip-good-fg"
    : diff < 0 ? "bg-chip-bad-bg text-chip-bad-fg"
    : "bg-chip-neutral-bg text-chip-neutral-fg";
  const arrow = diff > 0 ? "▲" : diff < 0 ? "▼" : "—";
  return (
    <span className={`text-[11px] font-semibold px-1.5 py-0.5 rounded ${tone}`}>
      {arrow} {diff === 0 ? "flat" : `${Math.abs(pct)}%`}
    </span>
  );
}

export function ClientGrowthStrip() {
  const [data, setData] = useState<GrowthPayload | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    fetch("/api/crm/growth")
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((json: GrowthPayload) => { if (live) setData(json); })
      .catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, []);

  // A strip that can't load its numbers renders nothing rather than a
  // row of zeros — zeros here would read as "we added no one".
  if (failed) return null;

  const cards: (GrowthPeriod | null)[] = data ? data.periods : [null, null, null];

  return (
    <div className="mb-4">
      <div className="text-[10px] uppercase tracking-wider font-semibold text-lt-fg3 mb-2">
        Book growth
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {cards.map((loaded, i) => {
          const label = loaded?.label ?? PLACEHOLDER_LABELS[i];
          return (
            <div
              key={loaded?.key ?? label}
              className="rounded-xl border border-lt-hairline bg-lt-card p-3"
              title={
                loaded
                  ? `${num(loaded.people)} contacts and ${num(loaded.companies)} companies added since ${formatStart(loaded.start)}. Compared against ${num(loaded.peoplePrior)} contacts over the same stretch of the previous period.`
                  : undefined
              }
            >
              <div className="text-[11px] uppercase tracking-wider font-semibold text-lt-fg2">
                {label}
              </div>
              {loaded ? (
                <>
                  <div className="mt-1 flex items-baseline gap-2 flex-wrap">
                    <span className="text-2xl font-semibold font-mono text-lt-fg">
                      {num(loaded.people)}
                    </span>
                    <span className="text-[11px] text-lt-fg3">
                      new contact{loaded.people === 1 ? "" : "s"}
                    </span>
                    <DeltaChip current={loaded.people} prior={loaded.peoplePrior} />
                  </div>
                  <div className="mt-1 text-[11px] text-lt-fg3">
                    {num(loaded.peoplePrior)} {loaded.priorLabel}
                    {" · "}
                    {num(loaded.companies)} new compan{loaded.companies === 1 ? "y" : "ies"}
                  </div>
                </>
              ) : (
                <div className="mt-1 h-[2.75rem] rounded bg-lt-inner animate-pulse" />
              )}
            </div>
          );
        })}

        {/* Denominator. The three cards above are only readable next to
            the size of the book they are growing. */}
        <div className="rounded-xl border border-lt-hairline bg-lt-inner p-3">
          <div className="text-[11px] uppercase tracking-wider font-semibold text-lt-fg2">
            In the book
          </div>
          {data ? (
            <>
              <div className="mt-1 flex items-baseline gap-2 flex-wrap">
                <span className="text-2xl font-semibold font-mono text-lt-fg">
                  {num(data.totals.people)}
                </span>
                <span className="text-[11px] text-lt-fg3">contacts</span>
              </div>
              <div className="mt-1 text-[11px] text-lt-fg3">
                across {num(data.totals.companies)} compan{data.totals.companies === 1 ? "y" : "ies"}
              </div>
            </>
          ) : (
            <div className="mt-1 h-[2.75rem] rounded bg-lt-card animate-pulse" />
          )}
        </div>
      </div>
      <div className="mt-1.5 text-[10px] text-lt-fg3">
        Counted on the date each record was created, Pacific time. SirReel staff
        addresses are left out.
      </div>
    </div>
  );
}
