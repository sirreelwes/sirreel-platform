'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';

/**
 * Job Page portal (CRH Phase 3.2). Read-only base layout — header, schedule,
 * equipment, contacts, activity feed. Paperwork uploads and quick-action
 * CTAs land in Phase 3.3.
 *
 * Token-to-cookie handshake: when ?token=... is in the URL, the page first
 * calls /api/portal/job/[slug]?token=... to exchange the link for a session
 * cookie, then strips ?token from the URL and proceeds to fetch /data with
 * the cookie. This keeps the magic-link token out of any subsequent fetches
 * and the URL bar.
 */

interface PortalData {
  contact: { id: string; firstName: string; lastName: string; email: string } | null;
  company: { id: string; name: string };
  order: {
    id: string;
    orderNumber: string;
    startDate: string | null;
    endDate: string | null;
    status: string;
    cadenceState: string;
    total: string;
  };
  job: { id: string; name: string; jobCode: string; productionType: string } | null;
  agent: { id: string; name: string; email: string; phone: string | null; avatarUrl: string | null };
  afterHoursLine: string;
  opsContact: { name: string; phone: string };
  countdown: { msUntilPickup: number } | null;
  lineItems: {
    id: string;
    type: string;
    description: string;
    rateType: string;
    rate: string;
    quantity: number;
    days: number | null;
    inventoryCode: string | null;
    categoryName: string | null;
  }[];
  agreement: {
    status: string;
    documentType: string;
    signedAt: string | null;
    signerName: string | null;
  } | null;
  team: { id: string; firstName: string; lastName: string; email: string; lastAccessedAt: string | null }[];
  activity: { at: string; kind: string; label: string }[];
}

const STATUS_LABEL: Record<string, string> = {
  QUOTE_DRAFT: 'Draft',
  QUOTE_SENT: 'Quote',
  QUOTE_ACKNOWLEDGED: 'Quote',
  QUOTE_DISCUSSING: 'Quote',
  BOOKED: 'Booked',
  PICKUP_CONFIRMED: 'Pickup',
  IN_PROGRESS: 'Active',
  RETURNED: 'Returned',
  INVOICED: 'Invoiced',
  PAID: 'Wrapped',
  WRAPPED: 'Wrapped',
  LOST: 'Closed',
  CANCELLED: 'Cancelled',
};

const STATUS_STAGE: { key: string; label: string; matches: string[] }[] = [
  { key: 'quote', label: 'Quote', matches: ['QUOTE_DRAFT', 'QUOTE_SENT', 'QUOTE_ACKNOWLEDGED', 'QUOTE_DISCUSSING'] },
  { key: 'booked', label: 'Booked', matches: ['BOOKED', 'PICKUP_CONFIRMED'] },
  { key: 'pickup', label: 'Pickup', matches: ['IN_PROGRESS'] },
  { key: 'return', label: 'Return', matches: ['RETURNED', 'INVOICED'] },
  { key: 'wrapped', label: 'Wrapped', matches: ['PAID', 'WRAPPED'] },
];

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', { weekday: 'short', month: 'long', day: 'numeric', year: 'numeric' });
}

function fmtTime(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function fmtRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function fmtCountdown(ms: number): string {
  if (ms <= 0) return 'In progress';
  const days = Math.floor(ms / 86_400_000);
  if (days >= 2) return `${days} days to pickup`;
  const hours = Math.floor(ms / 3_600_000);
  return hours > 0 ? `${hours}h to pickup` : 'Pickup soon';
}

function fmtCurrency(n: string): string {
  const value = Number(n);
  if (!Number.isFinite(value)) return n;
  return value.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}

export default function JobPortalPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const slug = String(params?.slug || '');
  const tokenInUrl = searchParams?.get('token') || null;

  const [data, setData] = useState<PortalData | null>(null);
  const [error, setError] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [activityOpen, setActivityOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      setLoading(true);
      try {
        // Step 1 (first visit only): exchange ?token=... for a session cookie.
        if (tokenInUrl) {
          const r = await fetch(`/api/portal/job/${slug}?token=${encodeURIComponent(tokenInUrl)}`);
          if (!r.ok) {
            setError('This link has expired or been revoked. Ask your SirReel rep for a new one.');
            return;
          }
          // Strip the token from the URL so it's not in browser history / referer.
          const next = new URLSearchParams(Array.from(searchParams?.entries() || []));
          next.delete('token');
          const qs = next.toString();
          router.replace(qs ? `?${qs}` : '?', { scroll: false });
        }
        // Step 2: load the actual portal data.
        const res = await fetch('/api/portal/job/data');
        if (!res.ok) {
          setError('Your session has expired. Click the magic link in your email again.');
          return;
        }
        const body = (await res.json()) as PortalData;
        if (!cancelled) setData(body);
      } catch (err) {
        if (!cancelled) setError('Unable to load the portal. Please try again.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    run();
    return () => {
      cancelled = true;
    };
    // tokenInUrl is captured once on mount — fetch only re-runs if slug
    // changes, which it doesn't within a session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  const currentStage = useMemo(() => {
    if (!data) return 0;
    const idx = STATUS_STAGE.findIndex((s) => s.matches.includes(data.order.cadenceState));
    return idx >= 0 ? idx : 0;
  }, [data]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-gray-400 text-sm">Loading your job portal…</div>
    );
  }
  if (error || !data) {
    return (
      <div className="min-h-screen flex items-center justify-center px-6">
        <div className="max-w-md text-center space-y-3">
          <div className="text-5xl">🔒</div>
          <h1 className="text-xl font-semibold text-gray-900">{error || 'Access not available'}</h1>
          <p className="text-sm text-gray-500">Contact your SirReel rep if you need help.</p>
        </div>
      </div>
    );
  }

  const jobTitle = data.job?.name || data.order.orderNumber;
  const initials = data.agent.name.split(' ').map((s) => s[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();

  return (
    <div className="min-h-screen bg-gray-50">
      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-8 space-y-6">
        {/* ── Header ─────────────────────────────────────────────────────── */}
        <section className="bg-white rounded-2xl border border-gray-200 p-6 space-y-5 shadow-sm">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="min-w-0">
              <div className="text-xs uppercase tracking-widest text-gray-400 font-semibold">{data.company.name}</div>
              <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 mt-0.5 truncate">{jobTitle}</h1>
              <div className="text-xs text-gray-500 mt-1 font-mono">
                {data.job?.jobCode || data.order.orderNumber}
              </div>
            </div>
            {data.countdown && (
              <div className="text-right">
                <div className="text-[10px] uppercase tracking-widest text-gray-400 font-semibold">Status</div>
                <div className="text-sm font-semibold text-gray-900 mt-0.5">
                  {fmtCountdown(data.countdown.msUntilPickup)}
                </div>
              </div>
            )}
          </div>

          {/* Status progress bar */}
          <div className="flex items-center gap-1.5">
            {STATUS_STAGE.map((stage, i) => {
              const reached = i <= currentStage;
              return (
                <div key={stage.key} className="flex-1 flex flex-col items-center gap-1">
                  <div
                    className={`w-full h-1.5 rounded-full ${
                      reached ? 'bg-amber-500' : 'bg-gray-200'
                    }`}
                  />
                  <div className={`text-[10px] font-semibold ${reached ? 'text-gray-900' : 'text-gray-400'}`}>
                    {stage.label}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Rep contact */}
          <div className="border-t border-gray-100 pt-4 flex items-center gap-3">
            <div className="w-12 h-12 rounded-full bg-amber-100 flex items-center justify-center text-amber-700 font-bold text-sm flex-shrink-0">
              {data.agent.avatarUrl ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img src={data.agent.avatarUrl} alt={data.agent.name} className="w-12 h-12 rounded-full object-cover" />
              ) : (
                initials
              )}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-xs uppercase tracking-widest text-gray-400 font-semibold">Your SirReel rep</div>
              <div className="text-sm font-semibold text-gray-900">{data.agent.name}</div>
              <div className="text-xs text-gray-500 mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5">
                {data.agent.phone && <a href={`tel:${data.agent.phone}`} className="hover:text-gray-900">{data.agent.phone}</a>}
                <a href={`mailto:${data.agent.email}`} className="hover:text-gray-900">{data.agent.email}</a>
              </div>
            </div>
          </div>
          <div className="text-[11px] text-gray-400 -mt-2">
            After-hours line: <a href={`tel:${data.afterHoursLine}`} className="text-gray-600 hover:text-gray-900">{data.afterHoursLine}</a>
          </div>
        </section>

        {/* ── Schedule ────────────────────────────────────────────────────── */}
        <section className="bg-white rounded-2xl border border-gray-200 p-6 space-y-4 shadow-sm">
          <h2 className="text-base font-bold text-gray-900">Schedule</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <div className="text-[10px] uppercase tracking-widest text-gray-400 font-semibold">Pickup</div>
              <div className="text-sm font-semibold text-gray-900 mt-1">{fmtDate(data.order.startDate)}</div>
              <div className="text-xs text-gray-500">{fmtTime(data.order.startDate)}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-widest text-gray-400 font-semibold">Return</div>
              <div className="text-sm font-semibold text-gray-900 mt-1">{fmtDate(data.order.endDate)}</div>
              <div className="text-xs text-gray-500">{fmtTime(data.order.endDate)}</div>
            </div>
          </div>
          <div className="border-t border-gray-100 pt-3 text-[11px] text-gray-500">
            SirReel Studio Rentals · 8500 Lankershim Blvd, Sun Valley, CA 91352
          </div>
        </section>

        {/* ── Equipment ───────────────────────────────────────────────────── */}
        <section className="bg-white rounded-2xl border border-gray-200 p-6 space-y-3 shadow-sm">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold text-gray-900">Equipment</h2>
            <span className="text-xs text-gray-400">{data.lineItems.length} item{data.lineItems.length === 1 ? '' : 's'}</span>
          </div>
          {data.lineItems.length === 0 ? (
            <div className="text-xs text-gray-500">Your equipment list will appear here once it&rsquo;s finalized.</div>
          ) : (
            <div className="divide-y divide-gray-100">
              {data.lineItems.map((li) => (
                <div key={li.id} className="py-2 flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm text-gray-900 truncate">{li.description}</div>
                    <div className="text-[11px] text-gray-500 mt-0.5">
                      {li.categoryName && <span>{li.categoryName} · </span>}
                      Qty {li.quantity}
                      {li.days != null && <> · {li.days} {li.days === 1 ? 'day' : 'days'}</>}
                    </div>
                  </div>
                  <div className="text-[11px] text-gray-500 text-right flex-shrink-0">
                    {fmtCurrency(li.rate)}
                    <div className="text-[10px] text-gray-400">{li.rateType.toLowerCase()}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
          <div className="border-t border-gray-100 pt-3 flex items-center justify-between text-sm">
            <span className="text-gray-500 font-semibold">Total</span>
            <span className="text-gray-900 font-bold">{fmtCurrency(data.order.total)}</span>
          </div>
        </section>

        {/* ── Contacts ────────────────────────────────────────────────────── */}
        <section className="bg-white rounded-2xl border border-gray-200 p-6 space-y-4 shadow-sm">
          <h2 className="text-base font-bold text-gray-900">Contacts</h2>
          <div className="space-y-4">
            <div>
              <div className="text-[10px] uppercase tracking-widest text-gray-400 font-semibold mb-2">Your team</div>
              <div className="space-y-1.5">
                {data.contact && (
                  <ContactRow
                    name={`${data.contact.firstName} ${data.contact.lastName}`}
                    email={data.contact.email}
                    badge="You"
                  />
                )}
                {data.team.map((t) => (
                  <ContactRow
                    key={t.id}
                    name={`${t.firstName} ${t.lastName}`}
                    email={t.email}
                  />
                ))}
                {!data.contact && data.team.length === 0 && (
                  <div className="text-xs text-gray-500">No team members added yet.</div>
                )}
              </div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-widest text-gray-400 font-semibold mb-2">Your SirReel team</div>
              <div className="space-y-1.5">
                <ContactRow
                  name={data.agent.name}
                  email={data.agent.email}
                  badge="Rep"
                  detail={data.agent.phone || ''}
                />
                <ContactRow
                  name={data.opsContact.name}
                  email=""
                  badge="Ops"
                  detail={data.opsContact.phone}
                />
                <ContactRow
                  name="After-hours line"
                  email=""
                  detail={data.afterHoursLine}
                />
              </div>
            </div>
          </div>
        </section>

        {/* ── Activity ────────────────────────────────────────────────────── */}
        <section className="bg-white rounded-2xl border border-gray-200 p-5 shadow-sm">
          <button
            type="button"
            onClick={() => setActivityOpen((v) => !v)}
            className="w-full flex items-center justify-between gap-3 text-left"
          >
            <div>
              <div className="text-base font-bold text-gray-900">Activity</div>
              <div className="text-[11px] text-gray-500 mt-0.5">{data.activity.length} event{data.activity.length === 1 ? '' : 's'}</div>
            </div>
            <span className="text-xs text-gray-500">{activityOpen ? '▾' : '▸'}</span>
          </button>
          {activityOpen && (
            <ol className="mt-4 space-y-2">
              {data.activity.length === 0 && (
                <li className="text-xs text-gray-500">No activity yet.</li>
              )}
              {data.activity.map((a, i) => (
                <li key={`${a.kind}-${i}-${a.at}`} className="flex items-start gap-3 text-xs">
                  <div className="w-2 h-2 rounded-full bg-gray-300 mt-1.5 flex-shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="text-gray-800">{a.label}</div>
                    <div className="text-gray-400">{fmtRelative(a.at)}</div>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </section>

        <div className="text-center text-[10px] text-gray-400 py-6">
          SirReel Studio Rentals · 8500 Lankershim Blvd, Sun Valley, CA 91352
        </div>
      </main>
    </div>
  );
}

function ContactRow({
  name,
  email,
  detail,
  badge,
}: {
  name: string;
  email: string;
  detail?: string;
  badge?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0 flex-1">
        <div className="text-sm text-gray-900 truncate flex items-center gap-2">
          {name}
          {badge && (
            <span className="text-[9px] uppercase tracking-widest px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">
              {badge}
            </span>
          )}
        </div>
        <div className="text-[11px] text-gray-500 flex gap-2 flex-wrap">
          {email && (
            <a href={`mailto:${email}`} className="hover:text-gray-900 truncate">
              {email}
            </a>
          )}
          {detail && <span className="text-gray-500">{detail}</span>}
        </div>
      </div>
    </div>
  );
}
