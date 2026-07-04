'use client';

/**
 * Client board for /fleet/today. Server passes the initial payload;
 * this component owns refresh:
 *   - pull-to-refresh via a ~40-line touch handler (no new dependency —
 *     nothing suitable in deps; threshold 70px from scrollTop 0)
 *   - auto-refresh when the tab/app regains focus or visibility
 *   - explicit refresh button in the section header as the fallback
 * Buttons only — deliberately NO swipe gestures in this pass.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { FleetMovement } from '@/lib/fleet/todayBoard';

interface Payload {
  date: string;
  departing: FleetMovement[];
  returning: FleetMovement[];
}

const PULL_THRESHOLD = 70;

function inspectionTime(iso: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(iso));
}

function StatusChip({ m }: { m: FleetMovement }) {
  if (m.inspection) {
    return (
      <span className="inline-flex items-center gap-1 bg-emerald-950/60 border border-emerald-800 text-emerald-400 text-xs font-medium rounded-full px-2.5 py-1">
        ✓ Inspected {inspectionTime(m.inspection.inspectionDate)}
        {m.inspection.inspectorName ? ` · ${m.inspection.inspectorName.split(' ')[0]}` : ''}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 bg-amber-950/60 border border-amber-800 text-amber-400 text-xs font-medium rounded-full px-2.5 py-1">
      Needs inspection
    </span>
  );
}

function MovementCard({ m, edge }: { m: FleetMovement; edge: 'start' | 'end' }) {
  const time = edge === 'start' ? m.deliveryTime : m.pickupTime;
  return (
    <a
      href={`/fleet/inspection/${m.assignmentId}`}
      className="block bg-zinc-800 border border-zinc-700 active:border-amber-600 rounded-xl p-4"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-white font-semibold text-base">
            Unit {m.unitName} <span className="text-zinc-400 font-normal">· {m.category}</span>
          </div>
          <div className="text-zinc-400 text-sm mt-0.5 truncate">
            {m.jobName} — {m.company}
          </div>
          <div className="text-zinc-500 text-xs mt-0.5">
            {m.bookingNumber}
            {time ? ` · ${edge === 'start' ? 'out' : 'back'} ${time}` : ''}
          </div>
        </div>
        <span className="text-zinc-600 text-lg leading-none mt-1">›</span>
      </div>
      <div className="mt-2.5">
        <StatusChip m={m} />
      </div>
    </a>
  );
}

function Section({
  title,
  items,
  edge,
  empty,
}: {
  title: string;
  items: FleetMovement[];
  edge: 'start' | 'end';
  empty: string;
}) {
  return (
    <section>
      <h2 className="text-zinc-400 text-xs font-semibold uppercase tracking-wide mb-2">
        {title} <span className="text-zinc-600">({items.length})</span>
      </h2>
      {items.length === 0 ? (
        <p className="text-zinc-500 text-sm bg-zinc-800/40 border border-zinc-800 rounded-xl px-4 py-5 text-center">{empty}</p>
      ) : (
        <div className="space-y-2.5">
          {items.map((m) => (
            <MovementCard key={m.assignmentId} m={m} edge={edge} />
          ))}
        </div>
      )}
    </section>
  );
}

export function FleetTodayBoard({ initial }: { initial: Payload }) {
  const [data, setData] = useState<Payload>(initial);
  const [refreshing, setRefreshing] = useState(false);
  const [pull, setPull] = useState(0);
  const touchStartY = useRef<number | null>(null);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const res = await fetch('/api/fleet/today');
      if (res.ok) setData(await res.json());
    } catch {
      // yard connectivity is flaky — keep showing the last good data
    } finally {
      setRefreshing(false);
    }
  }, []);

  // Auto-refresh on refocus / app switch-back.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    window.addEventListener('focus', onVisible);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('focus', onVisible);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [refresh]);

  // Pull-to-refresh: only arms when the page is scrolled to the top.
  const onTouchStart = (e: React.TouchEvent) => {
    if (window.scrollY <= 0) touchStartY.current = e.touches[0].clientY;
    else touchStartY.current = null;
  };
  const onTouchMove = (e: React.TouchEvent) => {
    if (touchStartY.current == null) return;
    const dy = e.touches[0].clientY - touchStartY.current;
    setPull(dy > 0 ? Math.min(dy, PULL_THRESHOLD * 1.5) : 0);
  };
  const onTouchEnd = () => {
    if (pull >= PULL_THRESHOLD) void refresh();
    setPull(0);
    touchStartY.current = null;
  };

  return (
    <div onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}>
      {(pull > 0 || refreshing) && (
        <p className="text-center text-zinc-500 text-xs mb-2">
          {refreshing ? 'Refreshing…' : pull >= PULL_THRESHOLD ? 'Release to refresh' : 'Pull to refresh'}
        </p>
      )}
      <div className="flex items-center justify-between mb-3">
        <p className="text-zinc-600 text-xs">Tap a vehicle to open its inspection.</p>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={refreshing}
          className="min-h-[44px] px-4 bg-zinc-800 border border-zinc-700 active:bg-zinc-700 disabled:opacity-50 text-zinc-300 text-sm font-medium rounded-lg"
        >
          {refreshing ? 'Refreshing…' : '↻ Refresh'}
        </button>
      </div>
      <div className="space-y-6" style={{ transform: pull > 0 ? `translateY(${pull / 3}px)` : undefined }}>
        <Section title="Departing today" items={data.departing} edge="start" empty="No departures today. 🎉" />
        <Section title="Returning today" items={data.returning} edge="end" empty="No returns today." />
      </div>
    </div>
  );
}
