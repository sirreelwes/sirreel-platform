'use client';

/**
 * After-hours pickup & drop-off — the client's copy, inside their portal
 * session. Replaces the emailed PDF ("Afer Hours EQ P:R.pdf").
 *
 * The presentation lives in AfterHoursView, shared with the driver's copy
 * at /after-hours/[token]; this file is the client-only surround: the
 * session handshake, the share panel, and the way back to the project.
 *
 * TOKEN HANDSHAKE: unlike the other portal sub-pages, this one is deep-
 * linked from its own email, so a reader can arrive with no session cookie.
 * It runs the same ?token= exchange the portal landing page runs, then
 * strips the token out of the URL.
 */

import { useEffect, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import {
  AfterHoursShell,
  AfterHoursBody,
  AfterHoursProblem,
  type AfterHoursViewData,
} from '@/components/portal/AfterHoursView';
import { AfterHoursSharePanel } from '@/components/portal/AfterHoursSharePanel';

export default function AfterHoursPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const slug = String(params?.slug || '');
  const tokenInUrl = searchParams?.get('token') || null;

  const [data, setData] = useState<AfterHoursViewData | null>(null);
  const [error, setError] = useState<string>('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (tokenInUrl) {
          const r = await fetch(`/api/portal/job/${slug}?token=${encodeURIComponent(tokenInUrl)}`);
          if (!r.ok) {
            if (!cancelled)
              setError(
                'This link has expired or been revoked. Ask your SirReel rep to send it again — or call us on the number below, any hour.',
              );
            return;
          }
          const next = new URLSearchParams(Array.from(searchParams?.entries() || []));
          next.delete('token');
          const qs = next.toString();
          router.replace(qs ? `?${qs}` : '?', { scroll: false });
        }
        const res = await fetch('/api/portal/job/after-hours');
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { message?: string };
          if (!cancelled)
            setError(
              body.message ||
                (res.status === 401
                  ? 'Your session has expired. Open the link in your SirReel email again.'
                  : 'Could not load your after-hours instructions.'),
            );
          return;
        }
        const body = (await res.json()) as AfterHoursViewData;
        if (!cancelled) setData(body);
      } catch {
        if (!cancelled) setError('Could not load your after-hours instructions.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // tokenInUrl is captured once on mount, matching the portal landing page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  return (
    <AfterHoursShell subtitle={data?.projectName}>
      {loading && <div className="text-sm text-gray-500">Loading…</div>}
      {!loading && error && <AfterHoursProblem message={error} />}
      {!loading && data && (
        <>
          <AfterHoursBody data={data} />
          <AfterHoursSharePanel />
          <div className="text-center">
            <a
              href={`/portal/job/${slug}`}
              className="text-[13px] text-gray-500 hover:text-gray-900"
            >
              ← Back to your project page
            </a>
          </div>
        </>
      )}
    </AfterHoursShell>
  );
}
