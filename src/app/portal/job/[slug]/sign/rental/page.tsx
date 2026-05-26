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
 *   - PDF iframe of the unsigned agreement (paperwork.agreement.documentToSignUrl)
 *   - Download .docx for redline → /api/portal/job/agreement/download
 *   - Upload redline → /api/portal/job/agreement/upload-redline
 *   - Typed-name + acknowledgement sign form → /api/portal/job/agreement/sign
 *
 * On any state-changing action that flips the agreement status, the
 * page refreshes its data and re-renders accordingly. Routing back to
 * the portal home happens automatically on successful sign.
 */

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';

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

  const [redlineFile, setRedlineFile] = useState<File | null>(null);
  const [redlineUploading, setRedlineUploading] = useState(false);

  const [downloading, setDownloading] = useState(false);
  const [signing, setSigning] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFlash, setStatusFlash] = useState<string | null>(null);

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
      if (a.documentToSignUrl) setPdfUrl(a.documentToSignUrl);
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

  const submitSign = async () => {
    if (!signerName.trim() || !acknowledged) return;
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
    <div className="min-h-screen bg-gray-50">
      <main className="max-w-3xl mx-auto p-6 space-y-6">
        <div>
          <a href={`/portal/job/${slug}`} className="text-xs text-gray-500 hover:text-gray-900">
            ← Back to Job Page
          </a>
          <h1 className="text-2xl font-semibold text-gray-900 mt-2">Rental Agreement</h1>
          <p className="text-sm text-gray-600 mt-1">
            {isSigned
              ? 'This agreement has been signed.'
              : isRedlinePending
                ? 'We have your redline. Our team is reviewing it.'
                : 'Review the agreement below. You can sign it as-is, or download a .docx and upload a redlined version for our team to review.'}
          </p>
        </div>

        {pdfUrl && (
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <iframe src={pdfUrl} className="w-full" style={{ height: 600 }} title="Rental agreement PDF" />
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

        {/* Sign form */}
        {canSign && (
          <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
            <div className="text-xs font-semibold text-gray-500 uppercase tracking-widest">
              Or sign as-is
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
            <div className="grid grid-cols-2 gap-4">
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
                disabled={!signerName.trim() || !acknowledged || signing}
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
    </div>
  );
}
