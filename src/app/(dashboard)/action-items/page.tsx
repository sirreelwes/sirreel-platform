'use client';

/**
 * /action-items — the top-level Action Items surface. One list fed by
 * the provider registry (/api/action-items). Defaults to "mine"
 * (items matching the user's role); admins get an "all" toggle.
 * "Mark handled" dismisses via the shared per-user dismiss pattern.
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';

interface ActionItem {
  id: string;
  type: string;
  title: string;
  subtitle: string;
  priority: 'high' | 'medium' | 'low';
  href: string | null;
  occurredAt: string;
  source: string;
  dismissal: { kind: 'alert'; alertId: string } | { kind: 'sideRow' };
}

const PRIORITY_STYLE: Record<string, { dot: string; chip: string; label: string }> = {
  high: { dot: 'bg-red-500', chip: 'bg-red-50 text-red-700 border-red-200', label: 'High' },
  medium: { dot: 'bg-amber-500', chip: 'bg-amber-50 text-amber-700 border-amber-200', label: 'Medium' },
  low: { dot: 'bg-gray-400', chip: 'bg-gray-50 text-gray-600 border-gray-200', label: 'Low' },
};

const SOURCE_LABEL: Record<string, string> = {
  'payment-info': 'Payment',
  'coi-missing': 'COI',
  'quote-aging': 'Quote',
};

function fmtWhen(iso: string): string {
  const d = new Date(iso);
  const days = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  if (days < 1) return 'today';
  if (days < 30) return `${days}d ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export default function ActionItemsPage() {
  const [items, setItems] = useState<ActionItem[]>([]);
  const [view, setView] = useState<'mine' | 'all'>('mine');
  const [canSeeAll, setCanSeeAll] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback((v: 'mine' | 'all') => {
    setLoading(true);
    fetch(`/api/action-items?view=${v}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.ok) {
          setItems(d.items || []);
          setCanSeeAll(!!d.canSeeAll);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load(view);
  }, [view, load]);

  const dismiss = async (item: ActionItem) => {
    setBusyId(item.id);
    setItems((prev) => prev.filter((i) => i.id !== item.id));
    try {
      await fetch('/api/action-items/dismiss', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemId: item.id, dismissal: item.dismissal }),
      });
    } catch {
      /* optimistic — reappears on next load if the write failed */
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-4">
      <header className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Action Items</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Everything that needs a human, in one place. {view === 'mine' ? 'Items for your role.' : 'All items across the org.'}
          </p>
        </div>
        {canSeeAll && (
          <div className="flex bg-gray-100 rounded-lg p-0.5">
            <button
              onClick={() => setView('mine')}
              className={`px-3 py-1 rounded-md text-[12px] font-semibold transition-all ${view === 'mine' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}
            >
              Mine
            </button>
            <button
              onClick={() => setView('all')}
              className={`px-3 py-1 rounded-md text-[12px] font-semibold transition-all ${view === 'all' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}
            >
              All
            </button>
          </div>
        )}
      </header>

      {loading ? (
        <div className="bg-white border border-gray-200 rounded-xl px-4 py-10 text-center text-gray-400 text-sm">Loading…</div>
      ) : items.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-xl px-4 py-12 text-center">
          <div className="text-3xl mb-2">✅</div>
          <div className="text-sm font-semibold text-gray-700">All caught up</div>
          <div className="text-xs text-gray-400 mt-0.5">No action items{view === 'mine' ? ' for your role' : ''} right now.</div>
        </div>
      ) : (
        <div className="space-y-2">
          {items.map((item) => {
            const p = PRIORITY_STYLE[item.priority] ?? PRIORITY_STYLE.low;
            const Row = (
              <div className="flex items-start gap-3 p-3.5 bg-white border border-gray-200 rounded-xl hover:border-gray-300 transition-colors">
                <span className={`mt-1.5 w-2 h-2 rounded-full flex-shrink-0 ${p.dot}`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[13px] font-semibold text-gray-900">{item.title}</span>
                    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border uppercase tracking-wide ${p.chip}`}>{p.label}</span>
                    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 uppercase tracking-wide">
                      {SOURCE_LABEL[item.source] ?? item.source}
                    </span>
                  </div>
                  <div className="text-[12px] text-gray-500 mt-0.5">{item.subtitle}</div>
                  <div className="text-[10px] text-gray-400 mt-0.5">{fmtWhen(item.occurredAt)}</div>
                </div>
                <button
                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); void dismiss(item); }}
                  disabled={busyId === item.id}
                  className="flex-shrink-0 text-[11px] font-semibold text-gray-400 hover:text-gray-700 border border-gray-200 hover:border-gray-300 rounded-lg px-2.5 py-1.5 disabled:opacity-40"
                >
                  Mark handled
                </button>
              </div>
            );
            return item.href ? (
              <Link key={item.id} href={item.href} className="block">
                {Row}
              </Link>
            ) : (
              <div key={item.id}>{Row}</div>
            );
          })}
        </div>
      )}
    </div>
  );
}
