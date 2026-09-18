'use client'

import { useState } from 'react'
import { PORTAL } from '@/lib/brand/portalTokens'
import { CardShell, DoneNote, LockedNote } from './CardShell'
import type { V2Insurance, V2Paperwork } from './types'
import { Check, CheckCircle2, Clock, FileText, XCircle } from 'lucide-react'

/**
 * COI + Workers Comp card — wraps the existing upload/AI-review plumbing:
 *   POST /api/portal/[token]/coi-review  (AI review, sets coi_received on pass)
 *   POST /api/portal/[token]/coi         (stores the file)
 *   POST /api/portal/[token]/wc-review   (workers comp review)
 * Rehydrates prior review state from paperwork.coi_ai_review on load.
 *
 * `insurance` is the server's answer to "does this client still owe us
 * anything" over EVERY certificate on the job and the account — the job
 * portal's upload included. Without it this card knew only about documents
 * that came through its own two routes, which is how a client who had
 * already sent his certificate was asked for it a second time on the way to
 * the card form (2026-09-18).
 */
export function CoiCard({
  token,
  paperwork,
  insurance,
  done,
  locked,
  open,
  onToggle,
  onComplete,
}: {
  token: string
  paperwork: V2Paperwork
  insurance: V2Insurance
  done: boolean
  locked: boolean
  open: boolean
  onToggle: () => void
  onComplete: () => void
}) {
  const [coiFile, setCoiFile] = useState<File | null>(null)
  const [coiReview, setCoiReview] = useState<any>(paperwork.coi_ai_review || null)
  const [coiReviewing, setCoiReviewing] = useState(false)
  const [wcFile, setWcFile] = useState<File | null>(null)
  const [wcReview, setWcReview] = useState<any>(null)
  const [wcReviewing, setWcReviewing] = useState(false)
  // A client whose certificate is already on file can still send a newer one
  // — a renewal, or the corrected copy their broker just issued. The drop
  // zone is one tap away rather than the first thing they see.
  const [replacing, setReplacing] = useState(false)

  const wcSatisfied = !!(
    insurance?.wc.satisfied ||
    paperwork.wcReceived ||
    coiReview?.workersComp?.pass ||
    wcReview?.pass
  )
  const coiSatisfied = !!(insurance?.coi.satisfied || paperwork.coiReceived || coiReview?.overallPass)
  // Nothing was uploaded through THIS portal, and nothing needs to be.
  const coiOnFileElsewhere = !coiReview && coiSatisfied

  const status = done
    ? // An unreviewed certificate on file is 'pending', not 'done' — the
      // client has nothing to do, and we have not finished.
      insurance && !insurance.coi.verified
      ? 'pending'
      : 'done'
    : locked
      ? 'locked'
      : coiReview?.requiresAdminApproval
        ? 'pending'
        : coiReview && !coiReview.overallPass && !coiReview.requiresAdminApproval
          ? 'attention'
          : coiSatisfied && !wcSatisfied
            ? 'pending'
            : 'todo'

  return (
    <CardShell
      icon={<FileText size={16} aria-hidden />}
      title="Insurance (COI)"
      subtitle="Certificate of insurance + workers comp"
      status={status}
      statusLabel={done ? 'On file' : coiReview?.requiresAdminApproval ? 'Pending review' : undefined}
      open={open}
      onToggle={onToggle}
      actionLabel="Upload"
    >
      {locked && !done ? (
        <LockedNote title="Insurance Documents" />
      ) : done ? (
        // "Approved" only when it IS approved. The step now closes on what is
        // on file — which includes a certificate still in our review queue —
        // and telling a client their insurance was approved when a reviewer
        // has not looked is the one thing worse than asking them twice.
        insurance && !insurance.coi.verified ? (
          <DoneNote
            title="Insurance documents received"
            sub="With SirReel for review — we’ll be in touch if anything is missing."
          />
        ) : (
          <DoneNote title="Insurance Documents Approved" sub="COI and Workers Comp on file" />
        )
      ) : (
        <div className="space-y-4">
          <div>
            <div className="flex items-center gap-2 mb-1.5">
              <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Certificate of Insurance</div>
              {coiReview && (
                <span
                  className={`text-[10px] font-bold px-2 py-0.5 rounded-lg ${
                    coiReview.overallPass
                      ? 'bg-emerald-100 text-emerald-700'
                      : coiReview.requiresAdminApproval
                        ? 'bg-amber-100 text-amber-700'
                        : 'bg-red-100 text-red-600'
                  }`}
                >
                  {coiReview.overallPass ? 'Approved' : coiReview.requiresAdminApproval ? 'Pending Review' : 'Issues'}
                </span>
              )}
            </div>
            <div className="bg-gray-50 rounded-xl p-3 mb-3 text-xs text-gray-600">
              <div className="font-semibold text-gray-700 mb-0.5">Certificate holder must read:</div>
              <div>SirReel Production Vehicles Inc. · 8500 Lankershim Blvd, Sun Valley, CA 91352</div>
            </div>
            {coiOnFileElsewhere && !replacing ? (
              // The certificate arrived somewhere else — the job page, the
              // drop link, or the account — and this card used to have no way
              // of knowing that, so it printed an empty drop zone at a client
              // who had already sent it.
              <div className="space-y-2">
                <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 flex items-start gap-3">
                  <span className="text-emerald-500 mt-0.5"><CheckCircle2 size={20} aria-hidden /></span>
                  <div>
                    <div className="text-sm font-bold text-emerald-800">Certificate on file</div>
                    <div className="text-xs text-emerald-700 mt-0.5">
                      {insurance?.coi.note ||
                        'Your certificate of insurance is on file with SirReel — there is nothing to upload here.'}
                    </div>
                  </div>
                </div>
                <button
                  onClick={() => setReplacing(true)}
                  className="w-full py-2.5 border border-gray-200 rounded-xl text-sm font-semibold text-gray-600 hover:bg-gray-50"
                >
                  Upload a newer certificate
                </button>
              </div>
            ) : !coiReview ? (
              <div className="space-y-2">
                <div
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault()
                    const f = e.dataTransfer.files[0]
                    if (f) setCoiFile(f)
                  }}
                  onClick={() => document.getElementById('v2-coi-file')?.click()}
                  className={`border-2 border-dashed rounded-xl p-5 text-center cursor-pointer ${
                    coiFile ? 'border-emerald-300 bg-emerald-50' : 'border-gray-300 hover:border-gray-400 bg-gray-50'
                  }`}
                >
                  {coiFile ? (
                    <div className="text-sm font-semibold text-emerald-700">{coiFile.name}</div>
                  ) : (
                    <div>
                      <div className="text-sm text-gray-600">Drop COI here or tap to browse</div>
                      <div className="text-xs text-gray-400 mt-0.5">PDF, JPG, or PNG</div>
                    </div>
                  )}
                  <input
                    id="v2-coi-file"
                    type="file"
                    accept=".pdf,.jpg,.jpeg,.png"
                    className="hidden"
                    onChange={(e) => setCoiFile(e.target.files?.[0] || null)}
                  />
                </div>
                <button
                  onClick={async () => {
                    if (!coiFile) return
                    setCoiReviewing(true)
                    try {
                      const fd = new FormData()
                      fd.append('file', coiFile)
                      const res = await fetch(`/api/portal/${token}/coi-review`, { method: 'POST', body: fd })
                      const data = await res.json()
                      if (data.review) {
                        setCoiReview(data.review)
                        if (data.review.overallPass && (data.review.workersComp?.pass || wcSatisfied)) {
                          onComplete()
                        }
                      } else {
                        alert('Review error: ' + (data.error || 'Unknown'))
                      }
                      const fd2 = new FormData()
                      fd2.append('file', coiFile)
                      await fetch(`/api/portal/${token}/coi`, { method: 'POST', body: fd2 })
                    } catch (err: any) {
                      alert('Upload failed: ' + err.message)
                    } finally {
                      setCoiReviewing(false)
                    }
                  }}
                  disabled={!coiFile || coiReviewing}
                  className="w-full py-3 rounded-xl text-sm font-semibold text-white disabled:opacity-40"
                  style={{ backgroundColor: PORTAL.ink }}
                >
                  {coiReviewing ? 'Reviewing COI…' : 'Upload & Review →'}
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                {coiReview.overallPass ? (
                  <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 flex items-start gap-3">
                    <span className="text-xl"><CheckCircle2 size={20} aria-hidden /></span>
                    <div>
                      <div className="text-sm font-bold text-emerald-800">COI Approved</div>
                      <div className="text-xs text-emerald-600 mt-0.5">All requirements met. Your certificate is on file with SirReel.</div>
                    </div>
                  </div>
                ) : (
                  <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 flex items-start gap-3">
                    <span className="text-xl"><Clock size={20} aria-hidden /></span>
                    <div>
                      <div className="text-sm font-bold text-amber-800">COI Under Review</div>
                      <div className="text-xs text-amber-700 mt-0.5">
                        Thanks for uploading. Our team will review it against SirReel&rsquo;s requirements and follow up shortly.
                      </div>
                    </div>
                  </div>
                )}
                {!coiReview.overallPass && (
                  <button
                    onClick={() => {
                      setCoiReview(null)
                      setCoiFile(null)
                    }}
                    className="w-full py-2.5 border border-gray-200 rounded-xl text-sm font-semibold text-gray-600 hover:bg-gray-50"
                  >
                    Upload a Different COI
                  </button>
                )}
              </div>
            )}
          </div>

          <div className="border-t border-gray-100 pt-3">
            <div className="flex items-center gap-2 mb-1.5">
              <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Workers Compensation</div>
              {wcReview && (
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-lg ${wcReview.pass ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600'}`}>
                  {wcReview.pass ? 'Approved' : 'Issues'}
                </span>
              )}
            </div>
            {wcSatisfied && !wcReview ? (
              // Says WHICH of the two it is. Before today "no separate upload
              // needed" could not be reached by the ordinary client at all:
              // wc_received was written by the separate-upload route alone, so
              // workers' comp carried on their own COI still read as
              // outstanding and the step never closed.
              <div className="flex items-start gap-2 p-3 bg-emerald-50 border border-emerald-200 rounded-xl">
                <span className="text-emerald-500 mt-0.5"><Check size={16} aria-hidden /></span>
                <span className="text-sm text-emerald-700">
                  {insurance?.wc.note || 'Workers Comp on file — no separate upload needed.'}
                </span>
              </div>
            ) : !wcReview ? (
              <div className="space-y-2">
                <p className="text-xs text-gray-500">
                  If Workers Comp is on your main COI it&rsquo;s reviewed automatically. If provided separately by your payroll company (ADP,
                  Entertainment Partners, Cast &amp; Crew, etc.), upload it here.
                </p>
                <div
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault()
                    const f = e.dataTransfer.files[0]
                    if (f) setWcFile(f)
                  }}
                  onClick={() => document.getElementById('v2-wc-file')?.click()}
                  className={`border-2 border-dashed rounded-xl p-4 text-center cursor-pointer ${
                    wcFile ? 'border-blue-300 bg-blue-50' : 'border-gray-300 hover:border-gray-400 bg-gray-50'
                  }`}
                >
                  {wcFile ? (
                    <div className="text-sm font-semibold text-blue-700">{wcFile.name}</div>
                  ) : (
                    <div>
                      <div className="text-sm text-gray-600">Drop WC certificate here or tap to browse</div>
                      <div className="text-xs text-gray-400 mt-0.5">PDF, JPG, or PNG</div>
                    </div>
                  )}
                  <input
                    id="v2-wc-file"
                    type="file"
                    accept=".pdf,.jpg,.jpeg,.png"
                    className="hidden"
                    onChange={(e) => setWcFile(e.target.files?.[0] || null)}
                  />
                </div>
                <button
                  onClick={async () => {
                    if (!wcFile) return
                    setWcReviewing(true)
                    try {
                      const fd = new FormData()
                      fd.append('file', wcFile)
                      const res = await fetch(`/api/portal/${token}/wc-review`, { method: 'POST', body: fd })
                      const data = await res.json()
                      if (data.review) {
                        setWcReview(data.review)
                        if (data.review.pass && coiSatisfied) onComplete()
                      } else {
                        alert('Error: ' + (data.error || 'Unknown'))
                      }
                    } catch (err: any) {
                      alert('Upload failed: ' + err.message)
                    } finally {
                      setWcReviewing(false)
                    }
                  }}
                  disabled={!wcFile || wcReviewing}
                  className="w-full py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-40"
                  style={{ backgroundColor: PORTAL.ink }}
                >
                  {wcReviewing ? 'Reviewing…' : 'Upload & Review →'}
                </button>
                <p className="text-center text-xs text-gray-400">Don&rsquo;t have it? Your SirReel rep can upload it if you send it to them directly.</p>
              </div>
            ) : (
              <div className="space-y-2">
                <div className={`rounded-xl p-3 flex items-center gap-3 ${wcReview.pass ? 'bg-emerald-50 border border-emerald-200' : 'bg-red-50 border border-red-200'}`}>
                  <span className="text-xl">{wcReview.pass ? <CheckCircle2 size={14} aria-hidden /> : <XCircle size={14} aria-hidden />}</span>
                  <div>
                    <div className={`text-sm font-bold ${wcReview.pass ? 'text-emerald-800' : 'text-red-700'}`}>
                      {wcReview.pass ? 'Workers Comp Approved' : 'Needs Correction'}
                    </div>
                    <div className="text-xs text-gray-500">
                      {wcReview.provider && `Provider: ${wcReview.provider}`}
                      {wcReview.expiryDate && ` · Expires ${wcReview.expiryDate}`}
                    </div>
                  </div>
                </div>
                {!wcReview.pass && (
                  <button
                    onClick={() => {
                      setWcReview(null)
                      setWcFile(null)
                    }}
                    className="w-full py-2.5 border border-gray-200 rounded-xl text-sm font-semibold text-gray-600 hover:bg-gray-50"
                  >
                    Upload New Document
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </CardShell>
  )
}
