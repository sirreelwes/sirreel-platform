"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";

/**
 * Stage contract countersign page. Lives under the Job Page portal so the
 * existing JOB_SESSION_COOKIE provides auth — no separate magic link
 * needed (Producer is already authenticated to the portal to have reached
 * this URL).
 *
 * The form captures:
 *   - Typed signer name (required)
 *   - Title (optional, defaults to "Producer")
 *   - Email (optional, defaults to portal-session contact)
 *   - Acknowledgement checkbox text (required — recorded for the audit
 *     trail per E-SIGN Act §101(c))
 *
 * On submit, POSTs to /api/portal/[token]/stage-agreement/sign and routes
 * back to the Job Page on success. [token] in the path is vestigial here
 * — the API resolves the order via the cookie session.
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
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Pull the current contract data so we can show the pre-signed PDF
    // in an iframe for review before the client signs.
    fetch('/api/portal/job/data')
      .then((r) => r.json())
      .then((d) => {
        if (d?.paperwork?.stageContract?.documentToSignUrl) {
          setPdfUrl(d.paperwork.stageContract.documentToSignUrl);
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
    if (!signerName.trim() || !acknowledged) return;
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/portal/${slug}/stage-agreement/sign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        signerName: signerName.trim(),
        signerTitle: signerTitle.trim() || null,
        signerEmail: signerEmail.trim() || null,
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

  if (loading) return <div className="p-8 text-gray-500">Loading…</div>;
  if (error && !pdfUrl) return <div className="p-8 text-red-700 bg-red-50 max-w-2xl mx-auto mt-12 rounded-xl">{error}</div>;

  return (
    <div className="min-h-screen bg-gray-50">
      <main className="max-w-3xl mx-auto p-6 space-y-6">
        <div>
          <a href={`/portal/job/${slug}`} className="text-xs text-gray-500 hover:text-gray-900">← Back to Job Page</a>
          <h1 className="text-2xl font-semibold text-gray-900 mt-2">Sign your Stage Booking Agreement</h1>
          <p className="text-sm text-gray-600 mt-1">
            SirReel has already signed. Review the agreement below, then add your countersignature.
          </p>
        </div>

        {pdfUrl && (
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <iframe src={pdfUrl} className="w-full" style={{ height: 600 }} title="Stage contract PDF" />
          </div>
        )}

        <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-widest mb-1">Your Name</label>
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
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-widest mb-1">Title</label>
              <input
                type="text"
                value={signerTitle}
                onChange={(e) => setSignerTitle(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-widest mb-1">Email</label>
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

          {error && <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}

          <div className="flex items-center gap-3">
            <button
              onClick={submit}
              disabled={!signerName.trim() || !acknowledged || busy}
              className="px-5 py-2 bg-gray-900 hover:bg-gray-800 disabled:bg-gray-300 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-lg transition-colors"
            >
              {busy ? 'Signing…' : 'Sign Stage Contract'}
            </button>
            <a href={`/portal/job/${slug}`} className="text-sm text-gray-600 hover:text-gray-900">Cancel</a>
          </div>
        </div>
      </main>
    </div>
  );
}
