'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import type { AgreementStatus } from '@prisma/client';
import { describeAgreementStatus } from '@/lib/portal/agreementStatus';
import { PortalPayPanel } from '@/components/portal/PortalPayPanel';
import { PortalBankDetails } from '@/components/portal/PortalBankDetails';
import { PortalDriversSection } from '@/components/portal/PortalDriversSection';
import { PortalDeliveriesSection } from '@/components/portal/PortalDeliveriesSection';
import { CoiRequirementsBlock } from '@/components/portal/CoiRequirementsBlock';
import { PORTAL, PORTAL_SERIF } from '@/lib/brand/portalTokens';
import { FileText, Lock, Send } from 'lucide-react';

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
  /** Standing-agreement banner context. Renders when the order's
   *  rental agreement was auto-applied from the Company's negotiated
   *  PDF (Path A from the contract-review work). */
  standingAgreement: {
    companyName: string;
    approvedAt: string;
    summary: string | null;
  } | null;
  /** Set when the company is on an ANNUAL agreement flagged to auto-cover
   *  its jobs. The client signs nothing for this job — the only ask left is
   *  the damage-waiver election below. */
  annualAgreement: {
    title: string;
    companyName: string | null;
    effectiveDate: string | null;
    expiryDate: string | null;
    sentence: string;
    pdfUrl: string;
    /** Master + this job's addendum as ONE PDF, once it has been cut. */
    jobCopyUrl: string | null;
  } | null;
  /** Damage-waiver election for the JOB. `available` is false when nothing
   *  booked can carry the waiver — the row then explains rather than offers. */
  lcdw: {
    available: boolean;
    hasVehicles: boolean;
    allExcluded: boolean;
    ratePerDay: number;
    covered: string[];
    excluded: { description: string; reason: string }[];
    election: { decision: 'ACCEPTED' | 'DECLINED'; decidedAt: string; signerName: string | null } | null;
    /** The governing answer — the per-job election, else the standing one
     *  signed on the annual agreement. Null = genuinely unanswered. */
    effective: { decision: 'ACCEPTED' | 'DECLINED'; source: 'JOB' | 'ANNUAL' } | null;
    /** The client still has to affirm, for this job, that the master is on
     *  file and what their waiver status is. */
    acknowledgementRequired: boolean;
    acknowledgedAt: string | null;
  } | null;
  order: {
    id: string;
    orderNumber: string;
    startDate: string | null;
    endDate: string | null;
    status: string;
    cadenceState: string;
    total: string;
    // Blind handoff — server only emits the instructions when the
    // matching toggle is true (defense-in-depth in the API). Page
    // renders the sections conditionally on both the toggle AND the
    // text being non-empty.
    blindPickup: boolean;
    blindReturn: boolean;
    blindPickupInstructions: string | null;
    blindReturnInstructions: string | null;
  };
  job: { id: string; name: string; jobCode: string; productionType: string; status?: string } | null;
  /** Null unless a rep has actually been established for this order — an
   *  automatic assignment is not a relationship. See the data route. */
  agent: { id: string; name: string; email: string; phone: string | null; avatarUrl: string | null; displayTitle: string | null } | null;
  afterHoursLine: string;
  /** Booking details — built server-side by buildBookingTerms from this
   *  order's own vehicle lines, so the block here and the one on the quote
   *  PDF are the same sentences. Empty on an order with no line items. */
  bookingTerms: { key: string; title: string; body: string; note?: string }[];
  /** A rep has released this job's after-hours instructions. Gates the
   *  card that links to /after-hours; the codes live only on that page. */
  afterHoursReleased: boolean;
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
    notes: string | null;
    usageEstimated: boolean;
    isSubItem: boolean;
    /** Included accessory — rides along free with the line above it. */
    isIncluded?: boolean;
  }[];
  agreement: {
    status: string;
    documentType: string;
    signedAt: string | null;
    signerName: string | null;
    documentToSignUrl?: string | null;
    signedDocumentUrl?: string | null;
  } | null;
  /** Set when a SIBLING order on this job is already signed — this order
   *  asks for nothing. Never set when the order has its own signature. */
  agreementCoverage: {
    orderNumber: string;
    jobCode: string | null;
    signedAt: string | null;
    signerName: string | null;
    sentence: string;
  } | null;
  team: { id: string; firstName: string; lastName: string; email: string; lastAccessedAt: string | null }[];
  activity: { at: string; kind: string; label: string }[];
  paperwork: {
    quotePdfUrl: string | null;
    quotePdfGeneratedAt: string | null;
    dotSheetUrl: string | null;
    dotSheetGeneratedAt: string | null;
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
      /** Client-safe sentence when the certificate's named insured doesn't
       *  match the production company on this job. Null when it matches or
       *  when there is nothing to compare. */
      insuredNotice: string | null;
      /** 'JOB' — sent for this job. 'COMPANY' — the account's certificate on
       *  file, carried forward until it expires. */
      source: 'JOB' | 'COMPANY';
      sourceSentence: string;
      /** Set when a carried policy lapses BEFORE this rental ends. */
      expiresDuringRental: string | null;
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

// The tracker used to read ONLY Order.cadenceState — the CRH email-nudge
// state machine, advanced by the cadence cron. Staff moves that the client
// can plainly see (a job flipped to ACTIVE, an order actually booked) never
// reached it: Jose set SR-JOB-0205 ACTIVE and the client portal still said
// "Quote", because cadenceState sat at QUOTE_DRAFT while Order.status was
// already QUOTE_SENT and Job.status ACTIVE — three fields, three answers
// (Wes, 2026-08-25).
//
// So the stage is now the FURTHEST-ALONG of the three. Understating a
// client's progress is the bad direction: it reads as "you people haven't
// done anything". Whichever field staff actually touch, the bar moves, and
// it can never move backwards.
const ORDER_STATUS_STAGE: Record<string, number> = {
  DRAFT: 0, QUOTE_SENT: 0,
  APPROVED: 1, BOOKED: 1,
  LOADED_READY: 2, ON_JOB: 2,
  RETURNED: 3, LD_CHECK: 3,
  INVOICED: 4, CLOSED: 4,
};
// Job.status is coarse — a FLOOR, never a ceiling. ACTIVE means the
// production is running, so the client is at least past "Quote".
const JOB_STATUS_FLOOR: Record<string, number> = {
  ACTIVE: 1,
  WRAPPED: 4,
};

/**
 * Format a DATE-ONLY value (Order.startDate / endDate are @db.Date).
 *
 * Those serialize as midnight UTC — "2026-08-09T00:00:00.000Z" — so
 * formatting them in the viewer's local zone renders the PREVIOUS day
 * anywhere west of UTC. A client in Los Angeles was being shown a pickup
 * of Sat Aug 8 for an order that starts Sun Aug 9. Pin to UTC to read
 * back the calendar date that was actually stored.
 */
function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
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
  if (days >= 2) return `${days} days to Job`;
  const hours = Math.floor(ms / 3_600_000);
  return hours > 0 ? `${hours}h to Job` : 'Starting soon';
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
  // Reported by PortalPayPanel so the paperwork row can name what is
  // actually there — "Invoice · Issued" beside a pre-invoice awaiting
  // the client's approval is a lie the client would act on.
  const [invoiceRowState, setInvoiceRowState] = useState<{
    hasPreInvoice: boolean
    awaitingReview: boolean
  }>({ hasPreInvoice: false, awaitingReview: false });
  const [coiFile, setCoiFile] = useState<File | null>(null);
  const [coiUploading, setCoiUploading] = useState(false);
  const [coiError, setCoiError] = useState<string>('');
  // Quote approval. Two-step on purpose — approving is a commitment that
  // releases the rental agreement, so it should not be a single stray tap.
  const [approveConfirming, setApproveConfirming] = useState(false);
  const [approving, setApproving] = useState(false);
  const [approveError, setApproveError] = useState<string>('');
  const [justApproved, setJustApproved] = useState(false);
  // Whether the approve call actually released the agreement. The route
  // treats release as best-effort, so "approved" and "ready to sign" are
  // two different facts — never promise the second on the first.
  const [agreementReady, setAgreementReady] = useState(false);

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
        const res = await fetch(`/api/portal/job/data?slug=${encodeURIComponent(slug)}`);
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
      const res = await fetch(`/api/portal/job/data?slug=${encodeURIComponent(slug)}`);
      if (res.ok) setData(await res.json());
    } catch {
      setCoiError('Upload failed');
    } finally {
      setCoiUploading(false);
    }
  };

  const approveQuote = async () => {
    setApproving(true);
    setApproveError('');
    try {
      const r = await fetch('/api/portal/job/approve-quote', { method: 'POST' });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) {
        setApproveError(body.error || 'Could not approve the quote. Please try again.');
        return;
      }
      setApproveConfirming(false);
      setJustApproved(true);
      setAgreementReady(!body.agreementError);
      // Refetch so the Rental Agreement row picks up its released state and
      // the header stage advances — the whole point of approving here.
      const res = await fetch(`/api/portal/job/data?slug=${encodeURIComponent(slug)}`);
      if (res.ok) setData(await res.json());
    } catch {
      setApproveError('Could not approve the quote. Please try again.');
    } finally {
      setApproving(false);
    }
  };

  const currentStage = useMemo(() => {
    if (!data) return 0;
    const fromCadence = STATUS_STAGE.findIndex((s) => s.matches.includes(data.order.cadenceState));
    const fromStatus = ORDER_STATUS_STAGE[data.order.status] ?? -1;
    const fromJob = JOB_STATUS_FLOOR[data.job?.status ?? ''] ?? -1;
    // CANCELLED/LOST deliberately have no stage in any map — they fall
    // through to 0 and the banner elsewhere carries that news.
    return Math.max(0, fromCadence, fromStatus, fromJob);
  }, [data]);

  // Approvability keys off Order.status (the full lifecycle field), not
  // cadenceState — APPROVED is the status the approve route writes, and it
  // is what gates booking. Mirrors APPROVABLE_FROM in the route so the
  // button never offers something the server will refuse.
  const quoteIsApprovable = !!(
    data &&
    data.paperwork.quotePdfUrl &&
    (data.order.status === 'DRAFT' || data.order.status === 'QUOTE_SENT')
  );
  const quoteIsApproved = !!(
    data &&
    data.order.status !== 'DRAFT' &&
    data.order.status !== 'QUOTE_SENT' &&
    data.order.status !== 'CANCELLED'
  );

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
          <div className="text-5xl"><Lock size={44} aria-hidden /></div>
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
  const initials = (data.agent?.name ?? '')
    .split(' ')
    .map((s) => s[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <div className="min-h-screen bg-[#F8F7F4]">
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700&display=swap" rel="stylesheet" />

      {/* Dark hero — same touchpoint family as the welcome email,
          /portal/[token], /portal/account, and the sign pages.
          Compact band: wordmark + gold rule + greeting. The richer
          status panel (countdown + STATUS_STAGE progress + rep contact)
          lives in the white card below — that's the page's working
          surface, the hero is the brand anchor.

          "Presents / TSX" removed 2026-08-29 (Wes): the portal reads as
          SirReel to the client, not a sub-brand. */}
      <header className="w-full" style={{ backgroundColor: PORTAL.dark }}>
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-7 text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/sirreel-logo-white.png"
            alt="SirReel Studio Services"
            width={170}
            style={{ display: 'inline-block', maxWidth: 170, height: 'auto' }}
          />
          <div className="mx-auto mt-3" style={{ width: 48, height: 2, backgroundColor: PORTAL.gold }} />
          <h1
            className="mt-5 text-white text-[22px] sm:text-[24px] font-light italic leading-tight"
            style={{ fontFamily: PORTAL_SERIF }}
          >
            {data.company.name}
          </h1>
          <p className="mt-2 text-white/60 text-[13px]">{jobTitle}</p>
        </div>
      </header>

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

          {/* Contact. A NAMED rep only when one has actually been established
              for this order (Order.repVisibleToClient) — otherwise the house
              contact. Every order has an agent assigned, but an automatic
              assignment is not a relationship, and showing one put the wrong
              person's name, phone and email in front of clients. */}
          <div className="border-t border-gray-100 pt-4 flex items-center gap-3">
            <div className="w-12 h-12 rounded-full bg-amber-100 flex items-center justify-center text-amber-700 font-bold text-sm flex-shrink-0">
              {data.agent?.avatarUrl ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img src={data.agent.avatarUrl} alt={data.agent.name} className="w-12 h-12 rounded-full object-cover" />
              ) : data.agent ? (
                initials
              ) : (
                'SR'
              )}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-xs uppercase tracking-widest text-gray-400 font-semibold">
                {data.agent ? 'Your SirReel rep' : 'Questions?'}
              </div>
              <div className="text-sm font-semibold text-gray-900">
                {data.agent ? data.agent.name : 'SirReel Studio Services'}
              </div>
              <div className="text-xs text-gray-500 mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5">
                {data.agent ? (
                  <>
                    {data.agent.phone && <a href={`tel:${data.agent.phone}`} className="hover:text-gray-900">{data.agent.phone}</a>}
                    <a href={`mailto:${data.agent.email}`} className="hover:text-gray-900">{data.agent.email}</a>
                  </>
                ) : (
                  <>
                    <a href="tel:8884777335" className="hover:text-gray-900">(888) 477-7335</a>
                    <a href="mailto:info@sirreel.com" className="hover:text-gray-900">info@sirreel.com</a>
                  </>
                )}
              </div>
            </div>
          </div>
          <div className="text-[11px] text-gray-400 -mt-2">
            After-hours line: <a href={`tel:${data.afterHoursLine}`} className="text-gray-600 hover:text-gray-900">{data.afterHoursLine}</a>
          </div>

          {/* After-hours access, once a rep has released it for this job.
              Sits with the contact block rather than with paperwork: it is
              not a document to action, it is how you get in at 5am. The
              codes are NOT here — this is a link to the page that holds
              them, so a screenshot of the portal isn't a copy of the gate
              code. Absent entirely until released, because a row reading
              "not available" would have a client calling to ask why. */}
          {data.afterHoursReleased && (
            <a
              href={`/portal/job/${slug}/after-hours`}
              className="block rounded-xl border p-4 hover:border-gray-400 transition-colors"
              style={{ borderColor: '#E8D7A8', backgroundColor: '#FDF8EC' }}
            >
              <div className="text-[10px] uppercase tracking-widest font-semibold" style={{ color: '#8a6a1f' }}>
                After-hours pickup &amp; drop-off
              </div>
              <div className="text-sm font-semibold text-gray-900 mt-1">
                Gate code, container code and directions →
              </div>
              <div className="text-xs text-gray-600 mt-0.5">
                Send this link to whoever is making the run.
              </div>
            </a>
          )}
        </section>

        {/* ── Schedule ────────────────────────────────────────────────────── */}
        <section className="bg-white rounded-2xl border border-gray-200 p-6 space-y-4 shadow-sm">
          <h2 className="text-base font-bold text-gray-900">Schedule</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <div className="text-[10px] uppercase tracking-widest text-gray-400 font-semibold">Pickup</div>
              <div className="text-sm font-semibold text-gray-900 mt-1">{fmtDate(data.order.startDate)}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-widest text-gray-400 font-semibold">Return</div>
              <div className="text-sm font-semibold text-gray-900 mt-1">{fmtDate(data.order.endDate)}</div>
            </div>
          </div>
          <div className="border-t border-gray-100 pt-3 text-[11px] text-gray-500">
            SirReel Studio Rentals · 8500 Lankershim Blvd, Sun Valley, CA 91352
          </div>
        </section>

        {/* ── Self-checkout instructions ──────────────────────────────────────
            Read-only client-facing surface for blind handoffs. Only renders
            when the matching toggle was set on the Order AND there's actual
            text to show. Server already nulls the text when the toggle is
            off, but the page guards on both for belt-and-suspenders. */}
        {((data.order.blindPickup && data.order.blindPickupInstructions) ||
          (data.order.blindReturn && data.order.blindReturnInstructions)) && (
          <section className="bg-white rounded-2xl border border-gray-200 p-6 space-y-4 shadow-sm">
            <h2 className="text-base font-bold text-gray-900">Self-checkout instructions</h2>
            <p className="text-xs text-gray-500">
              You'll handle this part of the handoff on your own. Here's everything you need.
            </p>
            {data.order.blindPickup && data.order.blindPickupInstructions && (
              <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
                <div className="text-[10px] uppercase tracking-widest text-gray-500 font-semibold mb-2">
                  Picking up
                </div>
                <div className="text-sm text-gray-900 whitespace-pre-wrap leading-relaxed">
                  {data.order.blindPickupInstructions}
                </div>
              </div>
            )}
            {data.order.blindReturn && data.order.blindReturnInstructions && (
              <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
                <div className="text-[10px] uppercase tracking-widest text-gray-500 font-semibold mb-2">
                  Returning
                </div>
                <div className="text-sm text-gray-900 whitespace-pre-wrap leading-relaxed">
                  {data.order.blindReturnInstructions}
                </div>
              </div>
            )}
          </section>
        )}

        {/* ── Paperwork ───────────────────────────────────────────────────── */}
        <section className="bg-white rounded-2xl border border-gray-200 p-6 space-y-5 shadow-sm">
          <h2 className="text-base font-bold text-gray-900">Paperwork</h2>

          {/* Your paperwork */}
          <div>
            <div className="text-[10px] uppercase tracking-widest text-gray-400 font-semibold mb-2">Your paperwork</div>

            {/* Standing-agreement banner — renders when the order's
                rental agreement was auto-applied from the company's
                negotiated PDF. Tells the client up front so they
                aren't surprised to see different terms than the
                public template. */}
            {/* Annual-agreement banner. An account on an annual master signs
                nothing per job, so the portal has to say so up front — a
                client who expects a signing step and finds none will assume
                the page is broken and email their rep about it. */}
            {data.annualAgreement && (
              <div className="mb-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-[12px] leading-relaxed text-emerald-900">
                <div className="font-bold uppercase tracking-wider text-[10px] text-emerald-700 mb-1">
                  Annual agreement on file
                </div>
                <p>
                  {data.annualAgreement.companyName
                    ? `${data.annualAgreement.companyName}'s `
                    : 'Your '}
                  {data.annualAgreement.title} covers this job
                  {data.annualAgreement.expiryDate
                    ? `, in effect through ${new Date(data.annualAgreement.expiryDate).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' })}`
                    : ''}
                  . There is nothing to sign — we only need your damage-waiver
                  election below.
                </p>
                <a
                  href={data.annualAgreement.pdfUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-1.5 inline-block text-[11px] font-semibold text-emerald-800 underline hover:text-emerald-900"
                >
                  Read the agreement
                </a>
              </div>
            )}

            {data.standingAgreement && (
              <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-[12px] leading-relaxed text-amber-900">
                <div className="font-bold uppercase tracking-wider text-[10px] text-amber-700 mb-1">
                  Negotiated terms in use
                </div>
                <p>
                  Using {data.standingAgreement.companyName}&apos;s negotiated terms (established{' '}
                  {new Date(data.standingAgreement.approvedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}).
                </p>
                {data.standingAgreement.summary && (
                  <p className="mt-1 text-amber-800 whitespace-pre-wrap">{data.standingAgreement.summary}</p>
                )}
              </div>
            )}

            <div className="space-y-3">
              {/* Rental Agreement */}
              <PaperworkRow
                label="Rental Agreement"
                status={
                  data.annualAgreement
                    ? 'On file'
                    : data.agreementCoverage
                      ? 'Covered'
                      : agreementStatusLabel(data.paperwork.agreement)
                }
                statusKind={
                  data.annualAgreement || data.agreementCoverage
                    ? 'success'
                    : agreementStatusKind(data.paperwork.agreement)
                }
              >
                {data.annualAgreement ? (
                  /* Annual account. Checked BEFORE sibling coverage because
                     it holds from the moment the order exists — and before
                     the signing affordances below, so a released-but-unsigned
                     row can never show a signature pad to a client who has
                     already signed for the year. */
                  <div className="space-y-1.5">
                    <div className="text-xs text-gray-600 leading-relaxed">
                      {data.annualAgreement.sentence}
                    </div>
                    <div className="flex items-center gap-3 flex-wrap">
                      {/* Prefer the stapled copy: "the agreement for this job"
                          is one document, and it is the one a client's
                          accounting department is actually asking for. The
                          master alone stays available underneath it. */}
                      <a
                        href={data.annualAgreement.jobCopyUrl || data.annualAgreement.pdfUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs font-semibold text-amber-700 hover:text-amber-900"
                      >
                        {data.annualAgreement.jobCopyUrl
                          ? 'View agreement for this job'
                          : 'View agreement'}
                      </a>
                      <a
                        href={`${data.annualAgreement.jobCopyUrl || data.annualAgreement.pdfUrl}?download=1`}
                        download
                        className="text-xs font-semibold text-gray-600 hover:text-gray-900 underline"
                      >
                        Download PDF
                      </a>
                    </div>
                  </div>
                ) : data.agreementCoverage ? (
                  /* Papered by another order on the same job. Say WHICH
                     signature and when — a bare "Covered" reads like a
                     glitch to someone who knows they never signed for this
                     order, and Ana needs to be able to trace it too. */
                  <div className="text-xs text-gray-600 leading-relaxed">
                    {data.agreementCoverage.sentence}
                  </div>
                ) : data.paperwork.agreement?.signedAt ? (
                  data.paperwork.agreement.signedDocumentUrl ? (
                    // Two affordances, because the client wants both: read
                    // it now, and keep a copy for their production files.
                    // The single "Download signed copy" link did neither
                    // cleanly — it opened a viewer tab under a label that
                    // promised a file.
                    <div className="flex items-center gap-3 flex-wrap">
                      <a
                        href="/api/portal/job/agreement/pdf?type=RENTAL_AGREEMENT&doc=signed"
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs font-semibold text-amber-700 hover:text-amber-900"
                      >
                        View signed copy
                      </a>
                      <a
                        href="/api/portal/job/agreement/pdf?type=RENTAL_AGREEMENT&doc=signed&download=1"
                        download
                        className="text-xs font-semibold text-gray-600 hover:text-gray-900 underline"
                      >
                        Download PDF
                      </a>
                    </div>
                  ) : null
                ) : agreementIsReleased(data.paperwork.agreement) &&
                  data.paperwork.agreement?.documentToSignUrl ? (
                  // The native in-portal signing flow. This page has had a
                  // /sign/rental route since the stage flow shipped, but
                  // nothing ever linked to it — a released agreement with a
                  // rendered PDF still sent the client out to the Cognito
                  // form, or (with no legacy portal row) dead-ended on "your
                  // rep will send the agreement shortly" while the badge said
                  // Ready to sign. Same shape as the Stage Contract row below.
                  <div className="flex items-center gap-2 flex-wrap">
                    <a
                      href="/api/portal/job/agreement/pdf?type=RENTAL_AGREEMENT"
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs font-semibold text-gray-700 hover:text-gray-900 underline"
                    >
                      Read the agreement
                    </a>
                    <a
                      href={`/portal/job/${slug}/sign/rental`}
                      className="inline-block px-3 py-1.5 bg-gray-900 hover:bg-gray-800 text-white text-xs font-semibold rounded-lg"
                    >
                      Sign agreement →
                    </a>
                  </div>
                ) : data.paperwork.legacyPaperworkPortalUrl ? (
                  <a
                    href={data.paperwork.legacyPaperworkPortalUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-block px-3 py-1.5 bg-gray-900 hover:bg-gray-800 text-white text-xs font-semibold rounded-lg"
                  >
                    Sign agreement →
                  </a>
                ) : agreementIsReleased(data.paperwork.agreement) ? (
                  // Released, but this portal has no in-portal signing URL for
                  // it. Send them to the Cognito form rather than leaving the
                  // "Ready to sign" badge pointing at nothing. Links our own
                  // path so go-live is one line in legacyRedirects.
                  <div className="space-y-1.5">
                    <a
                      href="/rentalagreement"
                      target="_blank"
                      rel="noreferrer"
                      className="inline-block px-3 py-1.5 bg-gray-900 hover:bg-gray-800 text-white text-xs font-semibold rounded-lg"
                    >
                      Sign agreement →
                    </a>
                    <p className="text-[11px] text-gray-400">
                      Opens our secure signing form. Your rep is copied when it&rsquo;s submitted.
                    </p>
                  </div>
                ) : quoteIsApproved ? (
                  <span className="text-xs text-gray-500">
                    Your SirReel rep is preparing your agreement — it will appear here to sign.
                  </span>
                ) : (
                  // Says what actually unblocks it. The old copy — "your rep
                  // will send the agreement shortly" — described a step
                  // nobody was waiting on: approving the quote above is what
                  // releases the agreement to this row.
                  <span className="text-xs text-gray-500">
                    Approve your quote above and the rental agreement appears here to sign.
                  </span>
                )}
              </PaperworkRow>

              {/* Damage waiver — the ONE thing an annual account is asked
                  for, and a real per-job decision for everyone else. Renders
                  only when the job actually has vehicles: a stage-only or
                  gear-only job has nothing to waive and an offer there is
                  noise the client has to work out how to dismiss. */}
              {data.lcdw && data.lcdw.hasVehicles && (
                <PaperworkRow
                  label="Damage Waiver (LCDW)"
                  status={
                    data.lcdw.acknowledgementRequired
                      ? 'Needs your confirmation'
                      : data.lcdw.effective
                        ? data.lcdw.effective.decision === 'ACCEPTED'
                          ? 'Accepted'
                          : 'Declined'
                        : data.lcdw.available
                          ? 'Needs your answer'
                          : 'Not available'
                  }
                  statusKind={
                    data.lcdw.acknowledgementRequired
                      ? 'warning'
                      : data.lcdw.effective
                        ? 'success'
                        : data.lcdw.available
                          ? 'warning'
                          : 'pending'
                  }
                >
                  {data.lcdw.acknowledgementRequired ? (
                    /* Wes, 2026-09-02: the client must acknowledge the annual
                       agreement is on file AND their waiver status. Coverage
                       is already real — this is the affirmation, per job, in
                       their own name. It outranks the "already answered"
                       branch below precisely because being covered is not the
                       same as having said you know you are. */
                    <div className="space-y-1.5">
                      <p className="text-xs text-gray-600 leading-relaxed">
                        {data.lcdw.effective
                          ? `Your annual agreement covers this job and ${data.lcdw.effective.decision === 'ACCEPTED' ? 'accepts' : 'declines'} the damage waiver. Please confirm both for this job — it takes a moment, and you can change the waiver here if you want a different answer this time.`
                          : `Your annual agreement covers this job. Please confirm it, and accept or decline the damage waiver — $${data.lcdw.ratePerDay}/day per eligible vehicle.`}
                      </p>
                      <a
                        href={`/portal/job/${slug}/lcdw`}
                        className="inline-block px-3 py-1.5 bg-gray-900 hover:bg-gray-800 text-white text-xs font-semibold rounded-lg"
                      >
                        Confirm →
                      </a>
                    </div>
                  ) : data.lcdw.effective && !data.lcdw.election ? (
                    /* Answered on the annual agreement, not for this job.
                       Wes, 2026-09-02: an annual client's job should "only
                       require job name and dates, along with LCDW election to
                       update" — so this is a settled answer they can change,
                       not an outstanding question they already answered when
                       they signed for the year. */
                    <div className="space-y-1.5">
                      <div className="text-xs text-gray-600 leading-relaxed">
                        {data.lcdw.effective.decision === 'ACCEPTED'
                          ? `Your annual agreement accepts the waiver for all fleet vehicle rentals — $${data.lcdw.ratePerDay}/day per eligible vehicle applies to this job.`
                          : 'Your annual agreement declines the waiver for all fleet vehicle rentals, so it does not apply to this job.'}
                      </div>
                      <a
                        href={`/portal/job/${slug}/lcdw`}
                        className="text-xs font-semibold text-gray-600 hover:text-gray-900 underline"
                      >
                        Change it for this job
                      </a>
                    </div>
                  ) : data.lcdw.election ? (
                    <div className="space-y-1.5">
                      <div className="text-xs text-gray-600 leading-relaxed">
                        {data.lcdw.election.decision === 'ACCEPTED'
                          ? `Accepted at $${data.lcdw.ratePerDay}/day per eligible vehicle`
                          : 'Declined'}
                        {data.lcdw.election.signerName ? ` by ${data.lcdw.election.signerName}` : ''} on{' '}
                        {new Date(data.lcdw.election.decidedAt).toLocaleDateString('en-US', {
                          month: 'long',
                          day: 'numeric',
                          year: 'numeric',
                        })}
                        .
                      </div>
                      {/* Changeable until pickup. The election drives a charge
                          and a liability position — a client who picked the
                          wrong one should not have to email to fix it. */}
                      <a
                        href={`/portal/job/${slug}/lcdw`}
                        className="text-xs font-semibold text-gray-600 hover:text-gray-900 underline"
                      >
                        Change my answer
                      </a>
                    </div>
                  ) : data.lcdw.available ? (
                    <div className="space-y-1.5">
                      <p className="text-xs text-gray-600 leading-relaxed">
                        Accept or decline the Limited Collision Damage Waiver — $
                        {data.lcdw.ratePerDay}/day per eligible vehicle. We need your
                        answer either way before pickup.
                      </p>
                      <a
                        href={`/portal/job/${slug}/lcdw`}
                        className="inline-block px-3 py-1.5 bg-gray-900 hover:bg-gray-800 text-white text-xs font-semibold rounded-lg"
                      >
                        Choose →
                      </a>
                    </div>
                  ) : (
                    /* Vehicles on the job, none of them eligible. Say so
                       plainly rather than offering a waiver that would cover
                       nothing — see lcdwEligibility.ts. */
                    <p className="text-xs text-gray-500 leading-relaxed">
                      The damage waiver isn&rsquo;t available on the vehicles booked for
                      this job
                      {data.lcdw.excluded.length > 0
                        ? ` (${data.lcdw.excluded.map((e) => e.description).join(', ')})`
                        : ''}
                      . Nothing for you to do here.
                    </p>
                  )}
                </PaperworkRow>
              )}

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
                      // Two affordances, because the client wants both: read
                      // it now, and keep a copy for their production files.
                      // The single "Download signed copy" link did neither
                      // cleanly — it opened a viewer tab under a label that
                      // promised a file.
                      <div className="flex items-center gap-3 flex-wrap">
                        <a
                          href="/api/portal/job/agreement/pdf?type=STAGE_CONTRACT&doc=signed"
                          target="_blank"
                          rel="noreferrer"
                          className="text-xs font-semibold text-amber-700 hover:text-amber-900"
                        >
                          View signed copy
                        </a>
                        <a
                          href="/api/portal/job/agreement/pdf?type=STAGE_CONTRACT&doc=signed&download=1"
                          download
                          className="text-xs font-semibold text-gray-600 hover:text-gray-900 underline"
                        >
                          Download PDF
                        </a>
                      </div>
                    ) : null
                  ) : data.paperwork.stageContract.documentToSignUrl ? (
                    <div className="flex items-center gap-2 flex-wrap">
                      <a
                        href="/api/portal/job/agreement/pdf?type=STAGE_CONTRACT"
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
                  ) : describeAgreementStatus(
                      (data.paperwork.stageContract.status as AgreementStatus | undefined) ?? null,
                    ).isReleased ? (
                    // Released with no document to sign — same contradiction the
                    // rental agreement row had. Send them somewhere they can
                    // actually sign instead of stranding the badge.
                    <div className="space-y-1.5">
                      <a
                        href="/studiocontract"
                        target="_blank"
                        rel="noreferrer"
                        className="inline-block px-3 py-1.5 bg-gray-900 hover:bg-gray-800 text-white text-xs font-semibold rounded-lg"
                      >
                        Sign stage contract →
                      </a>
                      <p className="text-[11px] text-gray-400">
                        Opens our secure signing form. Your rep is copied when it&rsquo;s submitted.
                      </p>
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
                  <div className="space-y-1.5">
    <div className="text-xs text-gray-500">
                      {data.paperwork.coi.source === 'COMPANY' ? 'On file since ' : 'Received '}
                      {new Date(data.paperwork.coi.uploadedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                      {data.paperwork.coi.policyExpiryDate && (
                        <> · expires {new Date(data.paperwork.coi.policyExpiryDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</>
                      )}
                    </div>
                    {/* Carried from the account's certificate rather than sent
                        for this job. Said plainly: a client who knows they
                        never sent one for this job should understand why we
                        are not asking, and be able to correct us if their
                        policy has since changed. */}
                    {data.paperwork.coi.source === 'COMPANY' && (
                      <div
                        className={`rounded-lg border px-3 py-2 text-[11px] leading-relaxed ${
                          data.paperwork.coi.expiresDuringRental
                            ? 'border-amber-200 bg-amber-50 text-amber-900'
                            : 'border-emerald-200 bg-emerald-50 text-emerald-900'
                        }`}
                      >
                        {data.paperwork.coi.sourceSentence}
                      </div>
                    )}
                    {/* The certificate is on file but insures a different
                        entity than the one this job is booked under. Said
                        here, plainly, because the client is the only one who
                        can tell us which company is actually renting — and
                        finding out at pickup is too late. */}
                    {data.paperwork.coi.insuredNotice && (
                      <>
                        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-900 leading-relaxed">
                          {data.paperwork.coi.insuredNotice}
                        </div>
                        {/* Flagged certificate — they have to go back to the
                            broker, so give them the same tools as someone
                            who hasn't uploaded yet. */}
                        <CoiRequirementsBlock />
                      </>
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
                          <div className="text-xl"><FileText size={20} aria-hidden /></div>
                          <div className="text-xs font-semibold text-amber-700">{coiFile.name}</div>
                          <div className="text-[10px] text-gray-400 mt-0.5">{(coiFile.size / 1024).toFixed(0)} KB</div>
                        </>
                      ) : (
                        <>
                          <div className="text-xl"><Send size={20} aria-hidden /></div>
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

                    {/* Don't have one yet? This is the block that gets the
                        right certificate issued the first time — the
                        requirements, the sample, and a direct line to the
                        broker who writes it. */}
                    <CoiRequirementsBlock />
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
                status={
                  quoteIsApproved ? 'Approved' : data.paperwork.quotePdfUrl ? 'Available' : 'Pending'
                }
                statusKind={data.paperwork.quotePdfUrl ? 'success' : 'pending'}
              >
                {data.paperwork.quotePdfUrl ? (
                  <div className="space-y-2.5">
                    <a
                      href={data.paperwork.quotePdfUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-block text-xs font-semibold text-amber-700 hover:text-amber-900"
                    >
                      Download quote PDF
                    </a>

                    {/* Approve — the client's yes. Releases the rental
                        agreement into this same portal, so the row below
                        turns signable without a rep in the loop. Hidden
                        once the order is past the quote stage. */}
                    {quoteIsApprovable && !approveConfirming && (
                      <div>
                        <button
                          onClick={() => {
                            setApproveError('');
                            setApproveConfirming(true);
                          }}
                          className="px-3 py-1.5 bg-gray-900 hover:bg-gray-800 text-white text-xs font-semibold rounded-lg"
                        >
                          Approve quote →
                        </button>
                        <p className="text-[11px] text-gray-400 mt-1">
                          Approving sends you the rental agreement to sign.
                        </p>
                      </div>
                    )}

                    {quoteIsApprovable && approveConfirming && (
                      <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 space-y-2">
                        <p className="text-[12px] text-gray-700 leading-relaxed">
                          Approve <strong>{data.order.orderNumber}</strong> for{' '}
                          <strong>${Number(data.order.total || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>?
                          We&rsquo;ll send the rental agreement straight to this page for you to sign.
                        </p>
                        {approveError && (
                          <p className="text-[11px] text-red-600">{approveError}</p>
                        )}
                        <div className="flex items-center gap-2">
                          <button
                            onClick={approveQuote}
                            disabled={approving}
                            className="px-3 py-1.5 bg-amber-600 hover:bg-amber-500 disabled:bg-gray-200 disabled:text-gray-400 text-white text-xs font-semibold rounded-lg"
                          >
                            {approving ? 'Approving…' : 'Yes, approve'}
                          </button>
                          <button
                            onClick={() => {
                              setApproveConfirming(false);
                              setApproveError('');
                            }}
                            disabled={approving}
                            className="px-3 py-1.5 text-xs font-semibold text-gray-500 hover:text-gray-800"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}

                    {justApproved && (
                      <p className="text-[11px] text-emerald-700 font-semibold">
                        {agreementReady
                          ? 'Approved — your rental agreement is ready to sign below.'
                          : 'Approved — your rep is preparing your rental agreement.'}
                      </p>
                    )}
                    {!justApproved && quoteIsApproved && (
                      <p className="text-[11px] text-gray-400">
                        You approved this quote. Your rep has been notified.
                      </p>
                    )}
                    {approveError && !approveConfirming && (
                      <p className="text-[11px] text-red-600">{approveError}</p>
                    )}
                  </div>
                ) : (
                  <span className="text-xs text-gray-500">Your SirReel rep is finalizing the quote.</span>
                )}
              </PaperworkRow>
              <PaperworkRow
                label="DOT information"
                status={data.paperwork.dotSheetUrl ? 'Available' : 'Pending'}
                statusKind={data.paperwork.dotSheetUrl ? 'success' : 'pending'}
              >
                {data.paperwork.dotSheetUrl ? (
                  <a
                    href={data.paperwork.dotSheetUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs font-semibold text-amber-700 hover:text-amber-900"
                  >
                    Download DOT info sheet (PDF)
                  </a>
                ) : (
                  <span className="text-xs text-gray-500">Year, make, VIN, plate &amp; latest BIT for your vehicles — your rep will send this.</span>
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
              <PaperworkRow
                label={invoiceRowState.hasPreInvoice ? 'Pre-invoice' : 'Invoice'}
                status={
                  invoiceRowState.awaitingReview
                    ? 'Needs your review'
                    : invoiceRowState.hasPreInvoice
                      ? 'Approved'
                      : 'Issued'
                }
                statusKind={invoiceRowState.awaitingReview ? 'pending' : 'success'}
              >
                <PortalPayPanel onStatus={setInvoiceRowState} />
              </PaperworkRow>
              {/* Bank details live HERE, not in an email. See
                  api/portal/job/payment-details for why that ruling changed. */}
              <PaperworkRow label="Pay by bank transfer" status="No fee" statusKind="success">
                <PortalBankDetails />
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
                <div key={li.id} className={`py-2 flex items-start justify-between gap-3${li.isSubItem ? ' pl-5' : ''}`}>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm text-gray-900 truncate">{li.description}</div>
                    <div className="text-[11px] text-gray-500 mt-0.5">
                      {li.categoryName && <span>{li.categoryName} · </span>}
                      Qty {li.quantity}
                      {/* FLAT lines (partner ancillaries, one-off charges) bill
                          one period, not one day — printing "1 day" beside a
                          mileage charge reads as a daily rate. */}
                      {li.days != null && li.rateType !== 'FLAT' && <> · {li.days} {li.days === 1 ? 'day' : 'days'}</>}
                    </div>
                    {/* Client-facing small print. On a partner ancillary this
                        is the estimate wording — the client has to see it
                        here, not only on the quote PDF. */}
                    {li.notes && (
                      <div className={`text-[11px] mt-1 italic ${li.usageEstimated ? 'text-amber-700' : 'text-gray-500'}`}>
                        {li.notes}
                      </div>
                    )}
                  </div>
                  <div className="text-[11px] text-gray-500 text-right flex-shrink-0">
                    {li.isIncluded && Number(li.rate) === 0 ? (
                      <span className="text-[10px] font-semibold uppercase tracking-wide text-emerald-700">
                        Included
                      </span>
                    ) : (
                      <>
                        {fmtCurrency(li.rate)}
                        <div className="text-[10px] text-gray-400">{li.rateType.toLowerCase()}</div>
                      </>
                    )}
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

        {/* ── Booking details ─────────────────────────────────────────────── */}
        {/* Directly under Equipment: the client has just read WHAT they are
            renting, and this is HOW it works. Same builder as the quote PDF,
            so the page and the attachment cannot drift.

            Guarded on length — `bookingTerms` is [] for an order with no
            lines, and an empty "Booking details" heading is worse than none. */}
        {data.bookingTerms.length > 0 && (
          <section className="bg-white rounded-2xl border border-gray-200 p-6 space-y-4 shadow-sm">
            <h2 className="text-base font-bold text-gray-900">Booking details</h2>
            <dl className="grid gap-4 sm:grid-cols-2">
              {data.bookingTerms.map((t) => (
                <div key={t.key}>
                  <dt className="text-[11px] uppercase tracking-widest text-gray-400 font-semibold">
                    {t.title}
                  </dt>
                  <dd className="text-[13px] text-gray-700 mt-1 leading-relaxed">{t.body}</dd>
                  {/* Amber, matching the estimate wording above: a term's note
                      is the qualification that must not be skimmed — above all
                      the LCDW exclusions. */}
                  {t.note && (
                    <dd className="text-[11px] text-amber-700 mt-1 italic leading-relaxed">{t.note}</dd>
                  )}
                </div>
              ))}
            </dl>
          </section>
        )}

        {/* ── Deliveries ──────────────────────────────────────────────────── */}
        {/* What's coming TO them, above "Your drivers" (what they collect FROM
            us). Renders nothing when the job has no deliveries, so a
            collect-it-yourself job is unchanged. */}
        <PortalDeliveriesSection />

        {/* ── Your drivers ─────────────────────────────────────────────────── */}
        <PortalDriversSection />

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
                {/* Same rule as the contact card above — a named REP only
                    when one has actually been established for this order. */}
                {data.agent && (
                  <ContactRow
                    name={data.agent.name}
                    email={data.agent.email}
                    badge="REP"
                    detail={data.agent.phone || undefined}
                  />
                )}
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

      </main>

      {/* Footer — same band the welcome email + /portal/[token] use */}
      <footer className="mt-4 border-t border-gray-200" style={{ backgroundColor: '#fafaf8' }}>
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 text-center">
          {/* S mark in place of the "SirReel" wordmark (Wes 2026-08-29).
              Black variant — the footer band is #fafaf8. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/s-logo-black.png"
            alt="SirReel"
            width={30}
            style={{ display: 'inline-block', width: 30, height: 'auto', opacity: 0.55 }}
          />
          <p className="mt-2 text-[10px] tracking-wide leading-relaxed" style={{ color: '#888' }}>
            SirReel Studio Services<br />
            8500 Lankershim Blvd, Sun Valley, CA 91352
          </p>
          <p className="mt-2 text-[11px]" style={{ color: PORTAL.gold }}>
            After-hours: <a href="tel:+18884777335" style={{ color: PORTAL.gold }}>(888) 477-7335</a>
          </p>
        </div>
      </footer>
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
/**
 * Has the agreement been released to the client for signature?
 *
 * The badge and the body of this row were computed independently, so a
 * released agreement with no in-portal signing URL rendered "Ready to sign"
 * directly above "Your SirReel rep will send the agreement shortly" — the
 * client was told simultaneously that it was their turn and that it wasn't.
 */
function agreementIsReleased(a: PortalData['paperwork']['agreement']): boolean {
  return describeAgreementStatus((a?.status as AgreementStatus | undefined) ?? null).isReleased;
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
