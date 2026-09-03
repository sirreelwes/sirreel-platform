'use client';

/**
 * The driver's copy — /after-hours/[token].
 *
 * Reached by a truck driver or a PA the production forwarded the run to.
 * No login, no portal session: the token in the URL is the credential, the
 * same contract as /coi/[token] and /drive/[token]. It opens exactly one
 * page and shows exactly what someone standing at the gate needs.
 *
 * Client-rendered rather than a server component so the fetch is a plain
 * GET the API route can rate-check and stamp — and so a dead link renders
 * the same phone-number-first error the client's page does, rather than a
 * Next.js 404 that leaves a driver in a car with nothing to call.
 */

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import {
  AfterHoursShell,
  AfterHoursBody,
  AfterHoursProblem,
  type AfterHoursViewData,
} from '@/components/portal/AfterHoursView';

export default function AfterHoursSharePage() {
  const params = useParams();
  const token = String(params?.token || '');

  const [data, setData] = useState<AfterHoursViewData | null>(null);
  const [error, setError] = useState<string>('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`/api/after-hours/${encodeURIComponent(token)}`);
        if (!r.ok) {
          const body = (await r.json().catch(() => ({}))) as { message?: string };
          if (!cancelled)
            setError(
              body.message ||
                'This link is no longer active. Call (888) 477-7335 — the line is answered around the clock.',
            );
          return;
        }
        const body = (await r.json()) as AfterHoursViewData;
        if (!cancelled) setData(body);
      } catch {
        if (!cancelled)
          setError(
            'We could not load the instructions. Call (888) 477-7335 — the line is answered around the clock.',
          );
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  return (
    <AfterHoursShell subtitle={data?.projectName}>
      {loading && <div className="text-sm text-gray-500">Loading…</div>}
      {!loading && error && <AfterHoursProblem message={error} />}
      {!loading && data && <AfterHoursBody data={data} />}
    </AfterHoursShell>
  );
}
