'use client'

/**
 * Drag-and-drop document upload for the claim detail page. Renders
 * above the existing Documents section.
 *
 * Drop OR click-to-browse uploads multipart to POST /api/claims/[id]/
 * documents. The server classifies each file (Sonnet) and returns
 * AI-suggested docTypes. After upload, the panel shows the freshly-
 * created rows as editable chips so the rep can confirm/override the
 * AI suggestion in one keystroke. Confirming PATCHes the row and
 * flips typeSource to USER.
 *
 * Files that fail upload surface inline rather than failing the
 * whole batch. The parent receives onDocumentsChanged() so it can
 * re-fetch the claim and refresh the main document list (STEP 4
 * filters/grouping).
 */

import { useCallback, useRef, useState } from 'react'
import type { ClaimDocType } from '@prisma/client'

const CLASSIFIER_TYPES: ClaimDocType[] = [
  'PHOTO',
  'DAMAGE_INVOICE',
  'REPAIR_ESTIMATE',
  'COI',
  'RENTAL_AGREEMENT',
  'POLICE_REPORT',
  'CORRESPONDENCE',
  'OTHER',
]

const TYPE_LABEL: Partial<Record<ClaimDocType, string>> = {
  PHOTO: 'Photo',
  DAMAGE_INVOICE: 'Damage Invoice',
  REPAIR_ESTIMATE: 'Repair Estimate',
  COI: 'COI',
  RENTAL_AGREEMENT: 'Rental Agreement',
  POLICE_REPORT: 'Police Report',
  CORRESPONDENCE: 'Correspondence',
  SETTLEMENT: 'Settlement',
  DEMAND_LETTER: 'Demand Letter',
  COUNTER_LETTER: 'Counter Letter',
  CHECKOUT_PHOTO: 'Checkout Photo',
  RETURN_PHOTO: 'Return Photo',
  REPAIR_INVOICE: 'Repair Invoice',
  OTHER: 'Other',
}

const ACCEPT = '.pdf,.png,.jpg,.jpeg,.heic,.heif,.eml,application/pdf,image/png,image/jpeg,image/heic,image/heif,message/rfc822'

interface UploadedDoc {
  id: string
  type: ClaimDocType
  typeSource: string | null
  typeConfidence: number | null
  title: string
  fileUrl: string
  notes: string | null
  classificationReasoning?: string | null
}

export function DocumentDropZone({
  claimId,
  onDocumentsChanged,
}: {
  claimId: string
  onDocumentsChanged: () => void
}) {
  const [isDragging, setIsDragging] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [recentDocs, setRecentDocs] = useState<UploadedDoc[]>([])
  const [errors, setErrors] = useState<{ filename: string; error: string }[]>([])
  const inputRef = useRef<HTMLInputElement | null>(null)

  const upload = useCallback(async (files: FileList | File[]) => {
    if (!files || (files as FileList).length === 0) return
    setUploading(true)
    setErrors([])
    try {
      const form = new FormData()
      const arr = Array.from(files as Iterable<File>)
      arr.forEach((f) => form.append('files', f))
      const res = await fetch(`/api/claims/${claimId}/documents`, {
        method: 'POST',
        body: form,
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok && !data?.documents) {
        setErrors([{ filename: '(batch)', error: data?.error || `HTTP ${res.status}` }])
        return
      }
      setRecentDocs((prev) => [...(data.documents ?? []), ...prev])
      if (Array.isArray(data.errors) && data.errors.length > 0) {
        setErrors(data.errors)
      }
      onDocumentsChanged()
    } catch (err) {
      setErrors([{ filename: '(network)', error: err instanceof Error ? err.message : 'failed' }])
    } finally {
      setUploading(false)
    }
  }, [claimId, onDocumentsChanged])

  const onDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setIsDragging(false)
    if (e.dataTransfer?.files) void upload(e.dataTransfer.files)
  }

  const confirmType = async (docId: string, type: ClaimDocType) => {
    try {
      const res = await fetch(`/api/claims/${claimId}/documents/${docId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type }),
      })
      if (!res.ok) return
      const data = await res.json()
      setRecentDocs((prev) =>
        prev.map((d) => (d.id === docId ? { ...d, ...data.document } : d)),
      )
      onDocumentsChanged()
    } catch {
      /* no-op — leave the chip in its prior state */
    }
  }

  return (
    <div className="space-y-3">
      <div
        onDragEnter={(e) => { e.preventDefault(); setIsDragging(true) }}
        onDragOver={(e) => { e.preventDefault(); setIsDragging(true) }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        className={`border-2 border-dashed rounded-lg px-4 py-6 text-center cursor-pointer transition-colors ${
          isDragging
            ? 'border-lt-fg bg-lt-inner'
            : 'border-lt-hairline hover:border-lt-fg2 bg-lt-card hover:bg-lt-inner/40'
        }`}
      >
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ACCEPT}
          className="hidden"
          onChange={(e) => { if (e.target.files) void upload(e.target.files); e.target.value = '' }}
        />
        <div className="text-sm text-lt-fg2">
          {uploading ? (
            <span>Uploading + classifying…</span>
          ) : (
            <>
              <span className="font-medium text-lt-fg">Drop files here</span>{' '}
              <span className="text-lt-fg3">or click to browse</span>
              <div className="text-xs text-lt-fg3 mt-1">PDF · PNG · JPG · HEIC · EML — multiple OK</div>
            </>
          )}
        </div>
      </div>

      {errors.length > 0 && (
        <div className="text-xs space-y-1">
          {errors.map((e, i) => (
            <div key={i} className="text-chip-bad-fg bg-chip-bad-bg px-2 py-1 rounded">
              {e.filename}: {e.error}
            </div>
          ))}
        </div>
      )}

      {recentDocs.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-xs font-semibold uppercase tracking-wider text-lt-fg3">Just uploaded — confirm type</div>
          {recentDocs.map((doc) => {
            const isAiSuggestion = doc.typeSource === 'AI_SUGGESTED'
            return (
              <div key={doc.id} className="flex items-center justify-between gap-2 px-2 py-1.5 bg-lt-inner/40 rounded text-xs">
                <a href={doc.fileUrl} target="_blank" rel="noreferrer" className="text-lt-fg hover:text-black hover:underline truncate flex-1 min-w-0">
                  {doc.title}
                </a>
                <div className="flex items-center gap-2 shrink-0">
                  {isAiSuggestion && (
                    <span className="text-[10px] text-chip-warn-fg bg-chip-warn-bg px-1.5 py-0.5 rounded">
                      AI · {doc.typeConfidence != null ? `${Math.round(doc.typeConfidence * 100)}%` : '—'}
                    </span>
                  )}
                  <select
                    value={doc.type}
                    onChange={(e) => void confirmType(doc.id, e.target.value as ClaimDocType)}
                    className={`text-xs px-2 py-0.5 border rounded ${isAiSuggestion ? 'border-chip-warn-fg/40' : 'border-lt-hairline'}`}
                  >
                    {CLASSIFIER_TYPES.map((t) => (
                      <option key={t} value={t}>{TYPE_LABEL[t] ?? t}</option>
                    ))}
                  </select>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
