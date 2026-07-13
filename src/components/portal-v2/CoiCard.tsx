'use client'

import { useState } from 'react'
import { TSX } from '@/lib/brand/tsxTokens'
import { CardShell, DoneNote, LockedNote } from './CardShell'
import type { V2Paperwork } from './types'

/**
 * COI + Workers Comp card — wraps the existing upload/AI-review plumbing:
 *   POST /api/portal/[token]/coi-review  (AI review, sets coi_received on pass)
 *   POST /api/portal/[token]/coi         (stores the file)
 *   POST /api/portal/[token]/wc-review   (workers comp review)
 * Rehydrates prior review state from paperwork.coi_ai_review on load.
 */
export function CoiCard({
  token,
  paperwork,
  done,
  locked,
  open,
  onToggle,
  onComplete,
}: {
  token: string
  paperwork: V2Paperwork
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

  const wcSatisfied = !!(paperwork.wcReceived || coiReview?.workersComp?.pass || wcReview?.pass)
  const coiSatisfied = !!(paperwork.coiReceived || coiReview?.overallPass)

  const status = done
    ? 'done'
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
      icon="📄"
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
        <DoneNote title="Insurance Documents Approved" sub="COI and Workers Comp on file" />
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
                  {coiReview.overallPass ? '✓ Approved' : coiReview.requiresAdminApproval ? '⚠ Pending Review' : '✗ Issues'}
                </span>
              )}
            </div>
            <div className="bg-gray-50 rounded-xl p-3 mb-3 text-xs text-gray-600">
              <div className="font-semibold text-gray-700 mb-0.5">Certificate holder must read:</div>
              <div>SirReel Production Vehicles Inc. · 8500 Lankershim Blvd, Sun Valley, CA 91352</div>
            </div>
            {!coiReview ? (
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
                    <div className="text-sm font-semibold text-emerald-700">📄 {coiFile.name}</div>
                  ) : (
                    <div>
                      <div className="text-sm text-gray-600">📎 Drop COI here or tap to browse</div>
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
                        if (data.review.overallPass && (data.review.workersComp?.pass || wcReview?.pass || paperwork.wcReceived)) {
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
                  style={{ backgroundColor: TSX.ink }}
                >
                  {coiReviewing ? '🔍 Reviewing COI…' : 'Upload & Review →'}
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                {coiReview.overallPass ? (
                  <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 flex items-start gap-3">
                    <span className="text-xl">✅</span>
                    <div>
                      <div className="text-sm font-bold text-emerald-800">COI Approved</div>
                      <div className="text-xs text-emerald-600 mt-0.5">All requirements met. Your certificate is on file with SirReel.</div>
                    </div>
                  </div>
                ) : (
                  <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 flex items-start gap-3">
                    <span className="text-xl">🕐</span>
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
                  {wcReview.pass ? '✓ Approved' : '✗ Issues'}
                </span>
              )}
            </div>
            {wcSatisfied && !wcReview ? (
              <div className="flex items-center gap-2 p-3 bg-emerald-50 border border-emerald-200 rounded-xl">
                <span className="text-emerald-500">✓</span>
                <span className="text-sm text-emerald-700">Workers Comp on file — no separate upload needed.</span>
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
                    <div className="text-sm font-semibold text-blue-700">📄 {wcFile.name}</div>
                  ) : (
                    <div>
                      <div className="text-sm text-gray-600">🛡️ Drop WC certificate here or tap to browse</div>
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
                        if (data.review.pass && (coiReview?.overallPass || paperwork.coiReceived)) onComplete()
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
                  style={{ backgroundColor: TSX.ink }}
                >
                  {wcReviewing ? '🔍 Reviewing…' : 'Upload & Review →'}
                </button>
                <p className="text-center text-xs text-gray-400">Don&rsquo;t have it? Your SirReel rep can upload it if you send it to them directly.</p>
              </div>
            ) : (
              <div className="space-y-2">
                <div className={`rounded-xl p-3 flex items-center gap-3 ${wcReview.pass ? 'bg-emerald-50 border border-emerald-200' : 'bg-red-50 border border-red-200'}`}>
                  <span className="text-xl">{wcReview.pass ? '✅' : '❌'}</span>
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
