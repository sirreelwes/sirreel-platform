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
  AfterHoursBody,
  AfterHoursProblem,
  type AfterHoursViewData,
} from '@/components/portal/AfterHoursView';
import { JobPortalShell, JobPortalKicker, type JobPortalChromeData } from '@/components/portal/JobPortalChrome';
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
  const [chromeFacts, setChromeFacts] = useState<Partial<AfterHoursViewData> | null>(null);

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
          const body = (await res.json().catch(() => ({}))) as { message?: string } & Partial<AfterHoursViewData>;
          // Not released yet: the route still names the company and the
          // person, so the shared masthead is theirs even on the refusal.
          if (!cancelled && body.company) setChromeFacts(body as Partial<AfterHoursViewData>);
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

  // The route carries the chrome facts (company, contact, code) so this
  // page shares the job portal's masthead without a second data call.
  const facts = data ?? chromeFacts;
  const chrome: JobPortalChromeData | null = facts
    ? {
        company: { name: facts.company?.name ?? '', hasLogo: !!facts.company?.hasLogo },
        contact: facts.contact ?? null,
        headline: facts.projectName ?? '',
        code: facts.jobCode ?? '',
        rep: facts.agent?.email ? { name: facts.agent.name || facts.agent.email, email: facts.agent.email } : null,
        afterHoursLine: facts.support?.phone ?? '(888) 477-7335',
        ahaSms: facts.support?.aha ?? '(747) 335-1665',
        preview: facts.preview?.by ? { by: facts.preview.by } : null,
      }
    : null;

  return (
    <JobPortalShell chrome={chrome} width="narrow">
      <div>
        <JobPortalKicker className="mb-2">After-hours access</JobPortalKicker>
        <h1 className="text-xl font-semibold text-zinc-900">Picking up or dropping off.</h1>
      </div>
      {loading && <div className="text-sm text-zinc-500">Loading…</div>}
      {!loading && error && <AfterHoursProblem message={error} />}
      {!loading && data && (
        <>
          <AfterHoursBody data={data} />
          <AfterHoursSharePanel />
          <div className="text-center">
            <a
              href={`/portal/job/${slug}`}
              className="text-[13px] text-zinc-500 hover:text-zinc-900"
            >
              ← Back to your project page
            </a>
          </div>
        </>
      )}
    </JobPortalShell>
  );
}
