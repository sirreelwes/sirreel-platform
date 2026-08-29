'use client';

/**
 * Rental agreement sign page — native, in-portal session.
 *
 * Mirrors /portal/job/[slug]/sign/stage in structure but adds the
 * download + upload-redline affordances that the rental flow needs
 * for client legal review. Everything runs under the existing
 * JOB_SESSION_COOKIE — no separate token / no redirect out.
 *
 * Sections:
 *   - The agreement itself, as flowing text (see below)
 *   - Download .docx for redline → /api/portal/job/agreement/download
 *   - Upload redline → /api/portal/job/agreement/upload-redline
 *   - Typed-name + acknowledgement sign form → /api/portal/job/agreement/sign
 *
 * On any state-changing action that flips the agreement status, the
 * page refreshes its data and re-renders accordingly. Routing back to
 * the portal home happens automatically on successful sign.
 *
 * REVIEW BEFORE SIGNING (Wes, 2026-08-25). Two problems, one fix:
 *
 * 1. The agreement was an embedded PDF. On a phone that renders a single
 *    clipped page with no scroll — Wes sent a screenshot of the signature
 *    pad sitting under an agreement the client could not read. A BASELINE
 *    agreement is now rendered as flowing text from contractClauses.ts via
 *    the shared RentalAgreementBody, the same component the public
 *    /rental-agreement page uses, so it reflows on any screen and cannot
 *    drift from the document that gets signed.
 *
 * 2. Nothing required the client to look at it. The sign form now stays
 *    closed until they have actually reached the end of the agreement — a
 *    sentinel after the last clause, tested by position (on scroll, and on a
 *    short poll that survives scrolls which fire no event).
 *    Deliberately NOT a timer and NOT a checkbox alone: reaching the end is
 *    the weakest claim we can make honestly, and an acknowledgement typed
 *    over an unread document is worth less in a dispute than one typed over
 *    a read one.
 *
 * A NEGOTIATED agreement is the client's own counter-PDF — there is no
 * clause source to reflow, so it keeps the PDF, opens it full-screen on
 * mobile rather than in a cramped frame, and gates signing on an explicit
 * "I have opened and read it" instead of a scroll position we cannot see
 * inside a PDF viewer.
 */

import { SignaturePad } from "@/components/portal/SignaturePad";
import { RentalAgreementBody } from '@/components/contracts/RentalAgreementBody';
import { useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { PORTAL, PORTAL_SERIF } from '@/lib/brand/portalTokens';

const ACKNOWLEDGEMENT_TEXT =
  'I have read and agree to the Rental Agreement above. By typing my name and clicking Sign, I am providing my electronic signature, which has the same legal effect as a handwritten signature under the U.S. ESIGN Act and California UETA.';

interface AgreementShape {
  status: string;
  documentType: string;
  signedAt: string | null;
  signerName: string | null;
  documentToSignUrl?: string | null;
  signedDocumentUrl?: string | null;
}

export default function RentalAgreementSignPage() {
  const params = useParams();
  const router = useRouter();
  const slug = String(params?.slug || '');

  const [agreement, setAgreement] = useState<AgreementShape | null>(null);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [signerName, setSignerName] = useState('');
  const [signerTitle, setSignerTitle] = useState('Producer');
  const [signerEmail, setSignerEmail] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
  // See the stage page: the route already forwards this to the PDF as
  // signatureImageDataUri; the page simply never sent one.
  const [signature, setSignature] = useState<string | null>(null);

  const [redlineFile, setRedlineFile] = useState<File | null>(null);
  const [redlineUploading, setRedlineUploading] = useState(false);

  const [downloading, setDownloading] = useState(false);
  const [signing, setSigning] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFlash, setStatusFlash] = useState<string | null>(null);

  // Has the client actually reached the end of the agreement? Set by the
  // scroll-position test on the sentinel below the last clause (reflowed
  // text), or by the explicit confirm button (counter-PDF, where we cannot
  // see inside the viewer). Never assumed.
  const [reviewed, setReviewed] = useState(false);
  const endOfAgreementRef = useRef<HTMLDivElement | null>(null);

  const loadData = async () => {
    try {
      const r = await fetch('/api/portal/job/data');
      const d = await r.json();
      const a = d?.paperwork?.agreement as AgreementShape | null;
      if (!a) {
        setError('No rental agreement has been generated for this order yet.');
        return;
      }
      setAgreement(a);
      // documentToSignUrl is a PRIVATE blob (403s raw) — load it through the
      // job-session-gated proxy, which the same-origin iframe cookies into.
      if (a.documentToSignUrl) setPdfUrl('/api/portal/job/agreement/pdf?type=RENTAL_AGREEMENT');
      if (d?.contact?.email && !signerEmail) {
        setSignerEmail(d.contact.email);
        const full = `${d.contact.firstName || ''} ${d.contact.lastName || ''}`.trim();
        if (full && !signerName) setSignerName(full);
      }
    } catch {
      setError('Could not load agreement');
    }
  };

  useEffect(() => {
    setLoading(true);
    loadData().finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // "They should review BEFORE they sign" (Wes). The sentinel sits after the
  // last clause; reaching its position is what opens the sign form. Latching:
  // once reached, scrolling back up to re-read a clause does not close it.
  //
  // Two deliberate choices, both learned by watching this fail on a 375px
  // viewport before it shipped:
  //
  //   1. A POSITION test (has the sentinel come level with the bottom of the
  //      viewport?), not an IntersectionObserver. IO fires on intersection
  //      CHANGES, and a fast flick on a phone — or any programmatic jump —
  //      can carry a zero-height sentinel from below the fold to above it
  //      inside one frame, so IO never reports it intersecting and the form
  //      never opens. A rect comparison cannot be skipped that way.
  //
  //   2. A poll alongside the scroll listener, not the listener alone. The
  //      scroll position can change with NO scroll event: anchor jumps,
  //      scroll restoration on back-navigation, scrollIntoView. Observed
  //      here — scrollY went to the bottom of the page and zero scroll
  //      events fired. The listener is the fast path; the poll is what
  //      guarantees a client who HAS read the agreement can always sign.
  //      Both stop the moment the gate opens.
  useEffect(() => {
    if (reviewed || loading) return;
    let frame = 0;
    const check = () => {
      frame = 0;
      const el = endOfAgreementRef.current;
      if (!el) return;
      if (el.getBoundingClientRect().top <= window.innerHeight) setReviewed(true);
    };
    const onScroll = () => {
      if (!frame) frame = window.requestAnimationFrame(check);
    };
    // Immediate check covers a short agreement, or a tall desktop window where
    // the end is already on screen — nobody should have to scroll a page that
    // has no scroll.
    check();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    const poll = window.setInterval(check, 250);
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      window.clearInterval(poll);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, [reviewed, loading]);

  const submitSign = async () => {
    if (!signerName.trim() || !acknowledged || !signature) return;
    setSigning(true);
    setError(null);
    try {
      const res = await fetch('/api/portal/job/agreement/sign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          signerName: signerName.trim(),
          signerTitle: signerTitle.trim() || null,
          signerEmail: signerEmail.trim() || null,
          signatureImageData: signature,
          acknowledgmentText: ACKNOWLEDGEMENT_TEXT,
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error || `Sign failed (HTTP ${res.status})`);
        return;
      }
      router.push(`/portal/job/${slug}`);
    } finally {
      setSigning(false);
    }
  };

  const downloadDocx = () => {
    // Stream the .docx directly — server returns it with attachment
    // disposition so the browser triggers a save dialog without
    // navigating away.
    setDownloading(true);
    setError(null);
    setStatusFlash(null);
    // Force a fresh fetch by appending a timestamp; the route does
    // its own no-store cache header but this belt-and-suspenders
    // avoids any service-worker / proxy caching.
    window.location.assign(`/api/portal/job/agreement/download?t=${Date.now()}`);
    // Re-enable the button after a beat — the browser handles the
    // download out-of-band so we don't get a fetch promise to await.
    window.setTimeout(() => setDownloading(false), 2000);
  };

  const uploadRedline = async () => {
    if (!redlineFile) return;
    setRedlineUploading(true);
    setError(null);
    setStatusFlash(null);
    try {
      const fd = new FormData();
      fd.append('file', redlineFile);
      const r = await fetch('/api/portal/job/agreement/upload-redline', { method: 'POST', body: fd });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) {
        setError(body.error || `Upload failed (HTTP ${r.status})`);
        return;
      }
      setRedlineFile(null);
      setStatusFlash('Redline received. Our team will review and respond.');
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setRedlineUploading(false);
    }
  };

  const isBaseline = agreement?.documentType !== 'NEGOTIATED';

  if (loading) return <div className="p-8 text-gray-500">Loading…</div>;
  if (error && !pdfUrl) {
    return (
      <div className="p-8 text-red-700 bg-red-50 max-w-2xl mx-auto mt-12 rounded-xl">
        {error}
      </div>
    );
  }

  const isSigned = agreement?.status === 'SIGNED_BASELINE' || agreement?.status === 'SIGNED_NEGOTIATED';
  const isRedlinePending = agreement?.status === 'REDLINE_UPLOADED' || agreement?.status === 'UNDER_REVIEW';
  // The sign form opens only on released-and-not-yet-signed states.
  // Mid-review states show a status message instead.
  const canSign =
    agreement?.status === 'PORTAL_RELEASED' ||
    agreement?.status === 'DOWNLOAD_SENT' ||
    agreement?.status === 'NEGOTIATED_READY';

  return (
    <div className="min-h-screen bg-[#F8F7F4]">
      {/* Archivo joins DM Sans here because RentalAgreementBody sets its
          headings in it — the public /rental-agreement page gets it from the
          (public) layout, which the portal does not share. */}
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700&family=Archivo:wght@400;700;900&display=swap" rel="stylesheet" />

      {/* Dark hero — same shell as /portal/[token] + /portal/account */}
      <header className="w-full" style={{ backgroundColor: PORTAL.dark }}>
        <div className="max-w-3xl mx-auto px-6 py-7 text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/sirreel-logo-white.png"
            alt="SirReel Studio Services"
            width={160}
            style={{ display: 'inline-block', maxWidth: 160, height: 'auto' }}
          />
          <div className="mx-auto mt-3" style={{ width: 48, height: 2, backgroundColor: PORTAL.gold }} />
          <div
            className="mt-3 text-[10px] uppercase font-semibold"
            style={{ color: PORTAL.gold, letterSpacing: '2.5px' }}
          >
            Rental Agreement
          </div>
          <h1
            className="mt-1 text-white text-[24px] font-light italic leading-tight"
            style={{ fontFamily: PORTAL_SERIF }}
          >
            {isSigned ? 'Signed.' : isRedlinePending ? 'Under review.' : 'Review and sign.'}
          </h1>
        </div>
      </header>

      <main className="max-w-3xl mx-auto p-6 space-y-6">
        <div>
          <a href={`/portal/job/${slug}`} className="text-xs text-gray-500 hover:text-gray-900">
            ← Back to Job Page
          </a>
          <p className="text-sm text-gray-700 mt-3">
            {isSigned
              ? 'This agreement has been signed.'
              : isRedlinePending
                ? 'We have your redline. Our team is reviewing it.'
                : 'Review the agreement below. You can sign it as-is, or download a .docx and upload a redlined version for our team to review.'}
          </p>
        </div>

        {/* THE AGREEMENT.
            Baseline: flowing text, reflows to any screen, same source as the
            signed copy. Counter-PDF: the client's own negotiated document,
            which only exists as a PDF — offered as a real full-screen open
            rather than a frame that clips it on a phone. */}
        {isBaseline ? (
          <div className="bg-[#f6f4ef] rounded-xl border border-[#e2ddd0] p-4 sm:p-6">
            <div className="flex flex-wrap items-center justify-between gap-3 pb-4 mb-4 border-b border-[#e2ddd0]">
              <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#8a8272]" style={{ fontFamily: 'Archivo, sans-serif' }}>
                The agreement
              </div>
              {pdfUrl && (
                <a
                  href={pdfUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[12px] font-semibold text-gray-600 hover:text-gray-900 underline underline-offset-2"
                >
                  Open as PDF
                </a>
              )}
            </div>
            <RentalAgreementBody />
            {/* Reaching this element is what opens the sign form. */}
            <div ref={endOfAgreementRef} aria-hidden className="h-px" />
            <p className="mt-8 text-[12px] text-[#6d6759] italic">End of agreement.</p>
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
            <div className="text-xs font-semibold text-gray-500 uppercase tracking-widest">
              The agreement
            </div>
            <p className="text-sm text-gray-700">
              This is the negotiated version of the agreement for your production. Open it, read it
              in full, then come back to sign.
            </p>
            {pdfUrl && (
              <>
                <a
                  href={pdfUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-block px-4 py-2.5 bg-gray-900 hover:bg-gray-800 text-white text-sm font-semibold rounded-lg"
                >
                  Open the agreement →
                </a>
                {/* Wide screens can also read it in place; phones get the
                    full-screen open above, which is the only way a PDF is
                    actually readable there. */}
                <div className="hidden md:block rounded-lg border border-gray-200 overflow-hidden">
                  <iframe src={pdfUrl} className="w-full" style={{ height: 600 }} title="Rental agreement PDF" />
                </div>
              </>
            )}
            {canSign && !reviewed && (
              <button
                onClick={() => setReviewed(true)}
                className="block w-full sm:w-auto px-4 py-2 border border-gray-300 hover:bg-gray-50 text-gray-900 text-sm font-semibold rounded-lg"
              >
                I&rsquo;ve read the agreement — continue to sign
              </button>
            )}
          </div>
        )}

        {statusFlash && (
          <div className="text-sm text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
            {statusFlash}
          </div>
        )}

        {/* Redline path — download + upload */}
        {canSign && (
          <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
            <div className="text-xs font-semibold text-gray-500 uppercase tracking-widest">
              Want your team to review?
            </div>
            <p className="text-sm text-gray-600">
              Download a Word version, redline it in track changes, and upload it back. We&rsquo;ll
              review and respond.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <button
                onClick={downloadDocx}
                disabled={downloading}
                className="px-4 py-2 bg-white hover:bg-gray-50 disabled:opacity-50 border border-gray-300 text-gray-900 text-sm font-semibold rounded-lg"
              >
                {downloading ? 'Preparing…' : 'Download .docx for redline'}
              </button>
              <label className="text-sm text-gray-700 cursor-pointer">
                <input
                  type="file"
                  accept=".pdf,.docx"
                  onChange={(e) => setRedlineFile(e.target.files?.[0] || null)}
                  className="hidden"
                  disabled={redlineUploading}
                />
                <span className="px-3 py-2 bg-white hover:bg-gray-50 border border-gray-300 rounded-lg font-semibold inline-block">
                  {redlineFile ? `Selected: ${redlineFile.name}` : 'Choose redline file…'}
                </span>
              </label>
              <button
                onClick={uploadRedline}
                disabled={!redlineFile || redlineUploading}
                className="px-4 py-2 bg-gray-900 hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-lg"
              >
                {redlineUploading ? 'Uploading…' : 'Upload redline'}
              </button>
            </div>
          </div>
        )}

        {/* Mid-review banner */}
        {isRedlinePending && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-5 text-sm text-amber-900">
            <div className="font-semibold mb-1">Redline under review</div>
            <p>
              We received your redlined agreement and our team is reviewing it. We&rsquo;ll be
              in touch with a counter or to confirm acceptance. The sign form will reopen
              once we&rsquo;ve responded.
            </p>
          </div>
        )}

        {/* Not read yet — say what opens the form, and don't render a
            signature pad under a document nobody has looked at. */}
        {canSign && !reviewed && (
          <div className="bg-white rounded-xl border border-gray-200 p-5 text-sm text-gray-600">
            <span className="font-semibold text-gray-900">Read the agreement to continue.</span>{' '}
            {isBaseline
              ? 'Scroll to the end of the agreement above and the signature form opens here.'
              : 'Open the agreement above, then confirm you have read it.'}
          </div>
        )}

        {/* Sign form */}
        {canSign && reviewed && (
          <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
            <div className="text-xs font-semibold text-gray-500 uppercase tracking-widest">
              Sign as-is
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-widest mb-1">
                Your Name
              </label>
              <input
                type="text"
                value={signerName}
                onChange={(e) => setSignerName(e.target.value)}
                placeholder="Type your full legal name"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
              />
            </div>
            {/* One column on a phone: two 3-char-wide inputs side by side is
                how "japrod23@gmail.c" happens. */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-widest mb-1">
                  Title
                </label>
                <input
                  type="text"
                  value={signerTitle}
                  onChange={(e) => setSignerTitle(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-widest mb-1">
                  Email
                </label>
                <input
                  type="email"
                  value={signerEmail}
                  onChange={(e) => setSignerEmail(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                />
              </div>
            </div>

            <SignaturePad onChange={setSignature} disabled={signing} />

            <label className="flex items-start gap-3 text-xs text-gray-700">
              <input
                type="checkbox"
                checked={acknowledged}
                onChange={(e) => setAcknowledged(e.target.checked)}
                className="mt-0.5"
              />
              <span>{ACKNOWLEDGEMENT_TEXT}</span>
            </label>

            {error && (
              <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                {error}
              </div>
            )}

            <div className="flex items-center gap-3">
              <button
                onClick={submitSign}
                disabled={!signerName.trim() || !acknowledged || !signature || signing}
                className="px-5 py-2 bg-gray-900 hover:bg-gray-800 disabled:bg-gray-300 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-lg"
              >
                {signing ? 'Signing…' : 'Sign Rental Agreement'}
              </button>
              <a
                href={`/portal/job/${slug}`}
                className="text-sm text-gray-600 hover:text-gray-900"
              >
                Cancel
              </a>
            </div>
          </div>
        )}
      </main>

      <footer className="mt-10 border-t border-gray-200" style={{ backgroundColor: '#fafaf8' }}>
        <div className="max-w-3xl mx-auto px-6 py-6 text-center">
          {/* S mark in place of the "SirReel" wordmark (Wes 2026-08-29) —
              same treatment as /portal/job/[slug]. Black variant; every
              portal footer band is light. */}
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
