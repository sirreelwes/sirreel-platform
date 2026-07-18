'use client';

/**
 * Shared "⚡ Needs Attention" alert list — the dashboard Action Queue,
 * backed by the global Alert engine (GET /api/alerts, dismiss via
 * POST /api/alerts/dismiss with the signed-in user's email so
 * per-user dismissal is recorded correctly).
 *
 * Extracted so the same queue can surface on the Admin, Dani, and
 * Collections dashboards — payment-info requests (high severity) must
 * reach Dani + Wes + billing, not only the Admin dashboard. No new
 * scoping mechanism: alerts stay global; this just renders the widget
 * where those roles land.
 */

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';

interface AlertRow {
  id: string;
  type: string;
  title: string;
  body: string;
  severity: string;
  link: string | null;
}

export function NeedsAttentionAlerts({ className = '' }: { className?: string }) {
  const { data: session } = useSession();
  const email = session?.user?.email ?? '';
  const [alerts, setAlerts] = useState<AlertRow[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!email) return;
    let cancelled = false;
    fetch(`/api/alerts?user=${encodeURIComponent(email)}`)
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled && d.ok) setAlerts(d.alerts || []);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [email]);

  const dismiss = async (id: string) => {
    setAlerts((prev) => prev.filter((a) => a.id !== id));
    if (!email) return;
    try {
      await fetch('/api/alerts/dismiss', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ alertId: id, userEmail: email }),
      });
    } catch {
      /* optimistic — a failed dismiss just reappears on next load */
    }
  };

  if (loaded && alerts.length === 0) return null;

  return (
    <div className={`p-4 bg-white rounded-xl border border-gray-200 ${className}`}>
      <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-3">⚡ Needs Attention</div>
      <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
        {alerts.map((alert) => (
          <div
            key={alert.id}
            className={`rounded-lg border text-[11px] overflow-hidden ${
              alert.severity === 'critical'
                ? 'border-red-200 bg-red-50'
                : alert.severity === 'high'
                ? 'border-amber-200 bg-amber-50'
                : 'border-gray-200 bg-gray-50'
            }`}
          >
            <div className="px-3 py-2 flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <div
                  className={`font-bold flex items-center gap-1 ${
                    alert.severity === 'critical'
                      ? 'text-red-700'
                      : alert.severity === 'high'
                      ? 'text-amber-700'
                      : 'text-gray-700'
                  }`}
                >
                  <span>{alert.severity === 'critical' ? '🔴' : alert.severity === 'high' ? '🟡' : '⚪'}</span>
                  {alert.link ? (
                    <a href={alert.link} className="hover:underline">
                      {alert.title}
                    </a>
                  ) : (
                    alert.title
                  )}
                </div>
                {alert.body && <div className="text-[10px] text-gray-500 mt-0.5">{alert.body}</div>}
              </div>
              <button
                onClick={() => void dismiss(alert.id)}
                className="text-[9px] text-gray-400 hover:text-gray-600 font-semibold flex-shrink-0 px-1.5 py-0.5 rounded hover:bg-white/60"
              >
                Mark handled
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
