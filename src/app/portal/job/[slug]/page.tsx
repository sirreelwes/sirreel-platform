'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import type { AgreementStatus } from '@prisma/client';
import { describeAgreementStatus } from '@/lib/portal/agreementStatus';
import { PortalPayPanel } from '@/components/portal/PortalPayPanel';

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
  agent: { id: string; name: string; email: string; phone: string | null; avatarUrl: string | null; displayTitle: string | null };
  afterHoursLine: string;
  leadership: { id: string; name: string; email: string; phone: string | null; displayTitle: string | null } | null;
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
    documentToSignUrl?: string | null;
    signedDocumentUrl?: string | null;
  } | null;
  team: { id: string; firstName: string; lastName: string; email: string; lastAccessedAt: string | null }[];
  activity: { at: string; kind: string; label: string }[];
  paperwork: {
    quotePdfUrl: string | null;
    quotePdfGeneratedAt: string | null;
    agreement: {
      status: string;
      documentType: string;
      signedAt: string | null;
      signerName: string | null;
      // Pre-signed PDF the client reviews / signs from inside the
      // portal session. Present once the agreement is past
      // PORTAL_GENERATED — commit 6 will key the in-portal Sign button
      // off this URL (mirrors the stage-contract row pattern).
      documentToSignUrl?: string | null;
      signedDocumentUrl?: string | null;
    } | null;
    stageContract: { contractType: string; status: string; documentType: string; signedAt: string | null; signerName: string | null; documentToSignUrl?: string | null; signedDocumentUrl?: string | null } | null;
    coi: {
      id: string;
      fileUrl: string;
      originalFilename: string;
      humanDecision: string;
      aiRiskLevel: string | null;
      policyExpiryDate: string | null;
      coverageVerified: boolean;
      additionalInsured: boolean;
      uploadedAt: string;
    } | null;
    legacyPaperworkPortalUrl: string | null;
    vehicles: {
      assetId: string;
      unitName: string;
      title: string;
      licensePlate: string | null;
      registrationUrl: string | null;
      registrationExpiresAt: string | null;
      bitCertificateUrl: string | null;
      bitCertificateExpiresAt: string | null;
    }[];
  };
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
  // Resend-link UI state. Lives on the error screen so the client can
  // request a fresh magic link without leaving the page or contacting
  // a rep. Three states: idle → requesting → sent (or rate-limited).
  const [resendState, setResendState] = useState<'idle' | 'requesting' | 'sent' | 'limited'>(
    'idle',
  );
  const [activityOpen, setActivityOpen] = useState(false);
  const [coiFile, setCoiFile] = useState<File | null>(null);
  const [coiUploading, setCoiUploading] = useState(false);
  const [coiError, setCoiError] = useState<string>('');

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
          // Distinguish "never had a token in the URL" from "exchanged a
          // token earlier but the session has now expired" — both 401
          // here, but the user-facing copy should match the actual cause
          // so we don't tell first-visit clients to "click again".
          setError(
            tokenInUrl
              ? 'Your session has expired. Click the magic link in your email again.'
              : 'This portal link is missing its access token. Reply to your SirReel email or ask your rep to resend the link.',
          );
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

  const uploadCoi = async () => {
    if (!coiFile) return;
    setCoiUploading(true);
    setCoiError('');
    try {
      const fd = new FormData();
      fd.append('file', coiFile);
      const r = await fetch('/api/portal/job/coi', { method: 'POST', body: fd });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) {
        setCoiError(body.error || 'Upload failed');
        return;
      }
      // Refresh the portal data so the COI section now shows received state.
      setCoiFile(null);
      const res = await fetch('/api/portal/job/data');
      if (res.ok) setData(await res.json());
    } catch {
      setCoiError('Upload failed');
    } finally {
      setCoiUploading(false);
    }
  };

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
    const requestFreshLink = async () => {
      if (resendState !== 'idle') return;
      setResendState('requesting');
      try {
        const res = await fetch(`/api/portal/job/${slug}/resend-link`, { method: 'POST' });
        if (res.status === 429) {
          setResendState('limited');
          return;
        }
        // Endpoint always returns 200 ok regardless of mint outcome —
        // opaque to prevent enumeration. UX is the same either way.
        setResendState('sent');
      } catch {
        // Treat network errors the same as "ok" from the user's
        // perspective — they can retry; we don't want to expose
        // whether the server actually queued a send.
        setResendState('sent');
      }
    };

    const sentTitle = error || 'Access not available';

    return (
      <div className="min-h-screen flex items-center justify-center px-6">
        <div className="max-w-md text-center space-y-4">
          <div className="text-5xl">🔒</div>
          <h1 className="text-xl font-semibold text-gray-900">{sentTitle}</h1>

          {resendState === 'sent' ? (
            <p className="text-sm text-gray-600">
              If this portal has a contact on file, a fresh secure link is on its way. Check
              your inbox in the next minute or two.
            </p>
          ) : resendState === 'limited' ? (
            <p className="text-sm text-amber-700">
              Too many requests just now. Give it a few minutes and try again, or reach your
              SirReel rep directly.
            </p>
          ) : (
            <>
              <p className="text-sm text-gray-500">
                We can email you a fresh secure link to the contact on file for this portal.
              </p>
              <button
                onClick={() => { void requestFreshLink(); }}
                disabled={resendState === 'requesting'}
                className="inline-flex items-center justify-center px-5 py-2.5 bg-gray-900 hover:bg-gray-800 disabled:opacity-50 text-white text-sm font-semibold rounded-lg transition"
              >
                {resendState === 'requesting' ? 'Sending…' : 'Email me a secure link'}
              </button>
              <p className="text-xs text-gray-400">
                Still stuck? Reach your SirReel rep for help.
              </p>
            </>
          )}
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

        {/* ── Paperwork ───────────────────────────────────────────────────── */}
        <section className="bg-white rounded-2xl border border-gray-200 p-6 space-y-5 shadow-sm">
          <h2 className="text-base font-bold text-gray-900">Paperwork</h2>

          {/* Your paperwork */}
          <div>
            <div className="text-[10px] uppercase tracking-widest text-gray-400 font-semibold mb-2">Your paperwork</div>

            <div className="space-y-3">
              {/* Rental Agreement */}
              <PaperworkRow
                label="Rental Agreement"
                status={agreementStatusLabel(data.paperwork.agreement)}
                statusKind={agreementStatusKind(data.paperwork.agreement)}
              >
                {data.paperwork.agreement?.signedAt ? (
                  data.paperwork.agreement.signedDocumentUrl ? (
                    <a
                      href={data.paperwork.agreement.signedDocumentUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs font-semibold text-amber-700 hover:text-amber-900"
                    >
                      Download signed copy
                    </a>
                  ) : null
                ) : data.paperwork.legacyPaperworkPortalUrl ? (
                  <a
                    href={data.paperwork.legacyPaperworkPortalUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-block px-3 py-1.5 bg-gray-900 hover:bg-gray-800 text-white text-xs font-semibold rounded-lg"
                  >
                    Sign agreement →
                  </a>
                ) : (
                  <span className="text-xs text-gray-500">Your SirReel rep will send the agreement shortly.</span>
                )}
              </PaperworkRow>

              {/* Stage Contract — only renders when one has been generated.
                  Independent signing status from the rental agreement; an
                  order that needs both must complete both before pickup. */}
              {data.paperwork.stageContract && (
                <PaperworkRow
                  label="Stage Contract"
                  status={agreementStatusLabel(data.paperwork.stageContract)}
                  statusKind={agreementStatusKind(data.paperwork.stageContract)}
                >
                  {data.paperwork.stageContract.signedAt ? (
                    data.paperwork.stageContract.signedDocumentUrl ? (
                      <a
                        href={data.paperwork.stageContract.signedDocumentUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs font-semibold text-amber-700 hover:text-amber-900"
                      >
                        Download signed copy
                      </a>
                    ) : null
                  ) : data.paperwork.stageContract.documentToSignUrl ? (
                    <div className="flex items-center gap-2 flex-wrap">
                      <a
                        href={data.paperwork.stageContract.documentToSignUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs font-semibold text-gray-700 hover:text-gray-900 underline"
                      >
                        View pre-signed PDF
                      </a>
                      <a
                        href={`/portal/job/${slug}/sign/stage`}
                        className="inline-block px-3 py-1.5 bg-gray-900 hover:bg-gray-800 text-white text-xs font-semibold rounded-lg"
                      >
                        Sign stage contract →
                      </a>
                    </div>
                  ) : (
                    <span className="text-xs text-gray-500">Your SirReel rep will send the stage contract shortly.</span>
                  )}
                </PaperworkRow>
              )}

              {/* COI */}
              <PaperworkRow
                label="Certificate of Insurance"
                status={coiStatusLabel(data.paperwork.coi)}
                statusKind={coiStatusKind(data.paperwork.coi)}
              >
                {data.paperwork.coi ? (
                  <div className="text-xs text-gray-500">
                    Received {new Date(data.paperwork.coi.uploadedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                    {data.paperwork.coi.policyExpiryDate && (
                      <> · expires {new Date(data.paperwork.coi.policyExpiryDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</>
                    )}
                  </div>
                ) : (
                  <div className="space-y-2">
                    <label
                      htmlFor="portal-coi-file"
                      className={`block border-2 border-dashed rounded-xl p-4 text-center cursor-pointer ${
                        coiFile ? 'border-amber-300 bg-amber-50' : 'border-gray-200 hover:border-gray-300 bg-gray-50'
                      }`}
                    >
                      {coiFile ? (
                        <>
                          <div className="text-xl">📄</div>
                          <div className="text-xs font-semibold text-amber-700">{coiFile.name}</div>
                          <div className="text-[10px] text-gray-400 mt-0.5">{(coiFile.size / 1024).toFixed(0)} KB</div>
                        </>
                      ) : (
                        <>
                          <div className="text-xl">📤</div>
                          <div className="text-xs text-gray-500">Click to upload your COI</div>
                          <div className="text-[10px] text-gray-400 mt-0.5">PDF, PNG, or JPG · max 10 MB</div>
                        </>
                      )}
                      <input
                        id="portal-coi-file"
                        type="file"
                        accept=".pdf,.png,.jpg,.jpeg"
                        className="hidden"
                        onChange={(e) => setCoiFile(e.target.files?.[0] || null)}
                      />
                    </label>
                    {coiError && <div className="text-[11px] text-red-600">{coiError}</div>}
                    <button
                      onClick={uploadCoi}
                      disabled={!coiFile || coiUploading}
                      className="w-full py-2 bg-amber-600 hover:bg-amber-500 disabled:bg-gray-200 disabled:text-gray-400 text-white text-xs font-semibold rounded-xl"
                    >
                      {coiUploading ? 'Uploading & reviewing…' : 'Submit COI'}
                    </button>
                  </div>
                )}
              </PaperworkRow>
            </div>
          </div>

          {/* SirReel paperwork */}
          <div className="border-t border-gray-100 pt-5">
            <div className="text-[10px] uppercase tracking-widest text-gray-400 font-semibold mb-2">SirReel paperwork</div>
            <div className="space-y-3">
              <PaperworkRow
                label="Quote PDF"
                status={data.paperwork.quotePdfUrl ? 'Available' : 'Pending'}
                statusKind={data.paperwork.quotePdfUrl ? 'success' : 'pending'}
              >
                {data.paperwork.quotePdfUrl ? (
                  <a
                    href={data.paperwork.quotePdfUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs font-semibold text-amber-700 hover:text-amber-900"
                  >
                    Download quote PDF
                  </a>
                ) : (
                  <span className="text-xs text-gray-500">Your SirReel rep is finalizing the quote.</span>
                )}
              </PaperworkRow>
              <PaperworkRow label="Order PDF" status="Coming soon" statusKind="pending">
                <span className="text-xs text-gray-500">Available once your order is confirmed.</span>
              </PaperworkRow>
              {/* Phase 6 commit 2 — live invoices + portal card pay. The
                  panel hides itself when there are no invoices (renders
                  null), so the "Issued 24-48 hours" copy still applies
                  in that case via the surrounding context — keeping the
                  PaperworkRow as a fallback for the no-invoice state. */}
              <PaperworkRow label="Invoice" status="Issued" statusKind="success">
                <PortalPayPanel />
              </PaperworkRow>
            </div>
          </div>

          {/* Vehicle DOT paperwork — per CRH brief §7. Insurance card is NEVER */}
          {/* surfaced here; the data endpoint's select clause is the audit gate. */}
          {data.paperwork.vehicles.length > 0 && (
            <div className="border-t border-gray-100 pt-5">
              <div className="text-[10px] uppercase tracking-widest text-gray-400 font-semibold mb-2">
                Vehicle paperwork (for the cab)
              </div>
              <div className="space-y-3">
                {data.paperwork.vehicles.map((v) => (
                  <VehiclePaperworkRow key={v.assetId} vehicle={v} />
                ))}
              </div>
            </div>
          )}
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
                  badge="REP"
                  detail={data.agent.phone || undefined}
                />
                {data.leadership && (
                  <ContactRow
                    name={data.leadership.name}
                    email={data.leadership.email}
                    badge={data.leadership.displayTitle || ''}
                    detail={data.leadership.phone || undefined}
                  />
                )}
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

type PaperworkStatusKind = 'success' | 'pending' | 'warning' | 'failed';

function PaperworkRow({
  label,
  status,
  statusKind,
  children,
}: {
  label: string;
  status: string;
  statusKind: PaperworkStatusKind;
  children?: React.ReactNode;
}) {
  const pill: Record<PaperworkStatusKind, string> = {
    success: 'bg-emerald-100 text-emerald-700',
    pending: 'bg-gray-100 text-gray-600',
    warning: 'bg-amber-100 text-amber-700',
    failed: 'bg-red-100 text-red-700',
  };
  return (
    <div className="rounded-xl border border-gray-100 p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm font-semibold text-gray-900">{label}</div>
        <span className={`text-[10px] uppercase tracking-widest font-bold px-2 py-0.5 rounded ${pill[statusKind]}`}>
          {status}
        </span>
      </div>
      {children}
    </div>
  );
}

// Agreement status display is now centralized in
// src/lib/portal/agreementStatus.ts — both the portal row and the
// order detail page badge read the same mapping. The old inline
// helpers fell through to 'Sent' for PORTAL_GENERATED rows, which
// was the dark-on-dark bug equivalent for badge copy: prepared isn't
// delivered. The canonical mapping fixes it.
function agreementStatusLabel(a: PortalData['paperwork']['agreement']): string {
  return describeAgreementStatus((a?.status as AgreementStatus | undefined) ?? null).label;
}
function agreementStatusKind(a: PortalData['paperwork']['agreement']): PaperworkStatusKind {
  return describeAgreementStatus((a?.status as AgreementStatus | undefined) ?? null).kind;
}
function coiStatusLabel(c: PortalData['paperwork']['coi']): string {
  if (!c) return 'Pending';
  if (c.humanDecision === 'APPROVED') return 'Approved';
  if (c.humanDecision === 'REJECTED') return 'Rejected';
  if (c.coverageVerified) return 'Received';
  return 'Reviewing';
}
function coiStatusKind(c: PortalData['paperwork']['coi']): PaperworkStatusKind {
  if (!c) return 'pending';
  if (c.humanDecision === 'APPROVED' || c.coverageVerified) return 'success';
  if (c.humanDecision === 'REJECTED') return 'failed';
  return 'warning';
}

function VehiclePaperworkRow({ vehicle }: { vehicle: PortalData['paperwork']['vehicles'][number] }) {
  const regExpiry = vehicle.registrationExpiresAt ? new Date(vehicle.registrationExpiresAt) : null;
  const bitExpiry = vehicle.bitCertificateExpiresAt ? new Date(vehicle.bitCertificateExpiresAt) : null;
  const now = Date.now();
  const expiringSoon = (d: Date | null) => !!d && d.getTime() - now < 30 * 86_400_000 && d.getTime() > now;
  const expired = (d: Date | null) => !!d && d.getTime() <= now;
  return (
    <div className="rounded-xl border border-gray-100 p-3 space-y-2">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="text-sm font-semibold text-gray-900">{vehicle.title}</div>
        {vehicle.licensePlate && (
          <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-gray-100 text-gray-700">
            {vehicle.licensePlate}
          </span>
        )}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <DocLink
          label="Registration"
          url={vehicle.registrationUrl}
          expiry={regExpiry}
          expiringSoon={expiringSoon(regExpiry)}
          expired={expired(regExpiry)}
        />
        <DocLink
          label="BIT certificate"
          url={vehicle.bitCertificateUrl}
          expiry={bitExpiry}
          expiringSoon={expiringSoon(bitExpiry)}
          expired={expired(bitExpiry)}
        />
      </div>
    </div>
  );
}

function DocLink({
  label,
  url,
  expiry,
  expiringSoon,
  expired,
}: {
  label: string;
  url: string | null;
  expiry: Date | null;
  expiringSoon: boolean;
  expired: boolean;
}) {
  return (
    <div className="text-xs">
      <div className="text-gray-500 uppercase tracking-wider text-[10px] font-semibold">{label}</div>
      {url ? (
        <a href={url} target="_blank" rel="noreferrer" className="text-amber-700 hover:text-amber-900 font-semibold">
          Download
        </a>
      ) : (
        <span className="text-gray-400">Not yet on file</span>
      )}
      {expiry && (
        <div
          className={`text-[10px] mt-0.5 ${
            expired ? 'text-red-600 font-semibold' : expiringSoon ? 'text-amber-700 font-semibold' : 'text-gray-400'
          }`}
        >
          {expired ? 'Expired ' : 'Expires '}
          {expiry.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
        </div>
      )}
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
