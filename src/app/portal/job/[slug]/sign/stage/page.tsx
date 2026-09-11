"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { JobPortalShell, JobPortalKicker, chromeFromPortalData, type JobPortalChromeData } from '@/components/portal/JobPortalChrome';
import { SignaturePad } from "@/components/portal/SignaturePad";

/**
 * Stage contract countersign page. Lives under the Job Page portal so the
 * existing JOB_SESSION_COOKIE provides auth — no separate magic link
 * needed (Producer is already authenticated to the portal to have reached
 * this URL).
 *
 * The form captures:
 *   - Drawn signature (required — SignaturePad, burned into the PDF)
 *   - Typed signer name (required)
 *   - Title (optional, defaults to "Producer")
 *   - Email (optional, defaults to portal-session contact)
 *   - Acknowledgement checkbox text (required — recorded for the audit
 *     trail per E-SIGN Act §101(c))
 *
 * On submit, POSTs to /api/portal/[token]/stage-agreement/sign and routes
 * back to the Job Page on success. [token] in the path is vestigial here
 * — the API resolves the order via the cookie session.
 *
 * REVIEW BEFORE SIGNING (Wes, 2026-08-25). The page put a signature pad
 * directly under a 600px PDF frame with nothing between them, so a stage
 * contract could be countersigned without the document ever being opened
 * — while the acknowledgement the client agrees to says "I have read".
 * The rental page had already been gated; this one had not.
 *
 * The contract is a PDF, so the rental page's scroll-position test does
 * not apply — we cannot see inside a PDF viewer. Same treatment its
 * counter-PDF branch uses instead: open it full-screen (the only way a
 * PDF is readable on a phone), then an explicit "I've read it" before the
 * form appears. The weakest honest claim, not a timer.
 */

const ACKNOWLEDGEMENT_TEXT =
  'I have read and agree to the Stage Booking Agreement above. By typing my name and clicking Sign, I am providing my electronic signature, which has the same legal effect as a handwritten signature under the U.S. ESIGN Act and California UETA.';

export default function StageContractSignPage() {
  const params = useParams();
  const router = useRouter();
  const slug = String(params?.slug || '');

  const [signerName, setSignerName] = useState('');
  const [signerTitle, setSignerTitle] = useState('Producer');
  const [signerEmail, setSignerEmail] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
  // PNG data URL from the pad. The API forwards it to the PDF renderer as
  // signatureImageDataUri; without it the contract falls back to drawing
  // the typed name in a font, which is what every executed copy did
  // before the pad existed.
  const [signature, setSignature] = useState<string | null>(null);
  const [chrome, setChrome] = useState<JobPortalChromeData | null>(null);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  // Has the client confirmed they read it? Never assumed — see the note above.
  const [reviewed, setReviewed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Pull the current contract data so we can show the pre-signed PDF
    // in an iframe for review before the client signs.
    fetch('/api/portal/job/data')
      .then((r) => r.json())
      .then((d) => {
        setChrome(chromeFromPortalData(d));
        if (d?.paperwork?.stageContract?.documentToSignUrl) {
          // documentToSignUrl is a PRIVATE blob (403s raw) — load it through
          // the job-session-gated proxy the same-origin iframe cookies into.
          setPdfUrl('/api/portal/job/agreement/pdf?type=STAGE_CONTRACT');
        } else {
          setError(d?.paperwork?.stageContract ? 'Stage contract PDF is missing.' : 'No stage contract has been generated for this order yet.');
        }
        if (d?.contact?.email && !signerEmail) {
          setSignerEmail(d.contact.email);
          const full = `${d.contact.firstName || ''} ${d.contact.lastName || ''}`.trim();
          if (full && !signerName) setSignerName(full);
        }
      })
      .catch(() => setError('Could not load contract'))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = async () => {
    if (!signerName.trim() || !acknowledged || !signature) return;
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/portal/${slug}/stage-agreement/sign`, {
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
    setBusy(false);
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      setError(d.error || `Sign failed (HTTP ${res.status})`);
      return;
    }
    router.push(`/portal/job/${slug}`);
  };

  if (loading) return <JobPortalShell chrome={chrome} width="narrow"><div className="text-sm text-zinc-500">Loading…</div></JobPortalShell>;
  if (error && !pdfUrl) return <JobPortalShell chrome={chrome} width="narrow"><div className="p-6 text-red-700 bg-red-50 rounded-xl">{error}</div></JobPortalShell>;

  return (
    <JobPortalShell chrome={chrome} width="narrow">
      <div>
        <JobPortalKicker className="mb-2">Stage booking agreement</JobPortalKicker>
        <h1 className="text-xl font-semibold text-zinc-900">Countersign your booking.</h1>
      </div>
        <div>
          <a href={`/portal/job/${slug}`} className="text-xs text-zinc-500 hover:text-zinc-900">← Back to Job Page</a>
          <p className="text-sm text-zinc-700 mt-3">
            SirReel has already signed. Review the agreement below, then add your countersignature.
          </p>
        </div>

        {pdfUrl && (
          <div className="bg-white rounded-xl border border-zinc-200 p-5 space-y-3">
            <div className="text-xs font-semibold text-zinc-500 uppercase tracking-widest">
              The agreement
            </div>
            <a
              href={pdfUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-block px-4 py-2.5 bg-zinc-900 hover:bg-zinc-800 text-white text-sm font-semibold rounded-lg"
            >
              Open the agreement →
            </a>
            {/* Wide screens can also read it in place; phones get the
                full-screen open above, which is the only way a PDF is
                actually readable there. */}
            <div className="hidden md:block rounded-lg border border-zinc-200 overflow-hidden">
              <iframe src={pdfUrl} className="w-full" style={{ height: 600 }} title="Stage contract PDF" />
            </div>
            {!reviewed && (
              <button
                onClick={() => setReviewed(true)}
                className="block w-full sm:w-auto px-4 py-2 border border-zinc-300 hover:bg-zinc-50 text-zinc-900 text-sm font-semibold rounded-lg"
              >
                I&rsquo;ve read the agreement — continue to sign
              </button>
            )}
          </div>
        )}

        {/* No signature pad under a document nobody has opened. */}
        {!reviewed && (
          <div className="bg-white rounded-xl border border-zinc-200 p-5 text-sm text-zinc-600">
            <span className="font-semibold text-zinc-900">Read the agreement to continue.</span>{' '}
            Open the agreement above, then confirm you have read it.
          </div>
        )}

        {reviewed && (
        <div className="bg-white rounded-xl border border-zinc-200 p-5 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-zinc-500 uppercase tracking-widest mb-1">Your Name</label>
            <input
              type="text"
              value={signerName}
              onChange={(e) => setSignerName(e.target.value)}
              placeholder="Type your full legal name"
              className="w-full px-3 py-2 border border-zinc-300 rounded-lg text-sm"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-zinc-500 uppercase tracking-widest mb-1">Title</label>
              <input
                type="text"
                value={signerTitle}
                onChange={(e) => setSignerTitle(e.target.value)}
                className="w-full px-3 py-2 border border-zinc-300 rounded-lg text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-zinc-500 uppercase tracking-widest mb-1">Email</label>
              <input
                type="email"
                value={signerEmail}
                onChange={(e) => setSignerEmail(e.target.value)}
                className="w-full px-3 py-2 border border-zinc-300 rounded-lg text-sm"
              />
            </div>
          </div>
          <SignaturePad onChange={setSignature} disabled={busy} />

          <label className="flex items-start gap-3 text-xs text-zinc-700">
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={(e) => setAcknowledged(e.target.checked)}
              className="mt-0.5"
            />
            <span>{ACKNOWLEDGEMENT_TEXT}</span>
          </label>

          {error && <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}

          <div className="flex items-center gap-3">
            <button
              onClick={submit}
              disabled={!signerName.trim() || !acknowledged || !signature || busy}
              className="px-5 py-2 bg-zinc-900 hover:bg-zinc-800 disabled:bg-zinc-300 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-lg transition-colors"
            >
              {busy ? 'Signing…' : 'Sign Stage Contract'}
            </button>
            <a href={`/portal/job/${slug}`} className="text-sm text-zinc-600 hover:text-zinc-900">Cancel</a>
          </div>
        </div>
        )}
    </JobPortalShell>
  );
}
