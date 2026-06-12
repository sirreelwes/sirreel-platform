'use client'

/**
 * /orders/[id]/thank-you — compose view for the post-job thank-you.
 *
 * Sales rep opens this from the dashboard widget. They:
 *   1. Optionally upload a candid (mobile camera capture or
 *      drag-drop on desktop), OR pick from already-uploaded JOB_PHOTOs
 *   2. Optionally add a personal-note line above the templated body
 *   3. Tap "Preview" → renders the email in a sandboxed iframe
 *   4. Tap "Send" → POSTs through the standard send gate
 *
 * From: notifications@sirreel.com, reply-to the agent on the order
 * (jose@/oliver@/etc.) so replies land in the watched-inbox pipeline
 * and the CRM capture / outreach loops already in place.
 *
 * The candid is referenced by hosted Blob URL (NOT base64) — Gmail
 * and several other clients block data: URIs.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'

interface OrderDocRow {
  id: string
  type: string
  title: string
  fileUrl: string
  createdAt: string
  uploadedBy: { id: string; name: string } | null
}

interface SuggestionResp {
  id: string
  status: 'SUGGESTED' | 'SENT' | 'DISMISSED'
  photoDocumentId: string | null
  personalNote: string | null
  sentAt: string | null
  sentToEmail: string | null
  orderId: string
  orderNumber: string
  wrapDate: string | null
  company: { name: string } | null
  agent: { id: string; name: string; email: string; displayTitle: string | null } | null
  jobContact: { firstName: string; lastName: string; email: string } | null
  job: { name: string } | null
  jobPhotos: { id: string; fileUrl: string }[]
}

interface PreviewResp {
  to: string | null
  from: string
  replyTo: string
  subject: string
  html: string
  text: string
  photoUrl: string | null
}

export default function ThankYouComposePage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const orderId = params.id

  const [item, setItem] = useState<SuggestionResp | null>(null)
  const [docs, setDocs] = useState<OrderDocRow[]>([])
  const [personalNote, setPersonalNote] = useState('')
  const [pickedPhotoId, setPickedPhotoId] = useState<string | null>(null)
  const [preview, setPreview] = useState<PreviewResp | null>(null)
  const [loadingPreview, setLoadingPreview] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [sending, setSending] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [dismissing, setDismissing] = useState(false)
  const [dismissReason, setDismissReason] = useState('')
  const [showDismiss, setShowDismiss] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const loadItem = useCallback(async () => {
    try {
      const res = await fetch(`/api/orders/thank-yous?status=ALL`)
      const data = await res.json()
      const hit = (data.items as SuggestionResp[]).find((i) => i.orderId === orderId)
      if (!hit) {
        setErr('No thank-you suggestion for this order')
        return
      }
      setItem(hit)
      setPersonalNote(hit.personalNote ?? '')
      setPickedPhotoId(hit.photoDocumentId)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'load failed')
    }
  }, [orderId])

  const loadDocs = useCallback(async () => {
    try {
      const res = await fetch(`/api/orders/${orderId}/documents`)
      const data = await res.json()
      setDocs((data.rows ?? []) as OrderDocRow[])
    } catch {
      /* swallow */
    }
  }, [orderId])

  useEffect(() => { loadItem(); loadDocs() }, [loadItem, loadDocs])

  const runPreview = useCallback(async () => {
    setLoadingPreview(true)
    setErr(null)
    try {
      const res = await fetch(`/api/orders/${orderId}/thank-you/preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          personalNote: personalNote.trim() || null,
          photoDocumentId: pickedPhotoId,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setErr(data?.error || `HTTP ${res.status}`)
        return
      }
      setPreview(data as PreviewResp)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'preview failed')
    } finally {
      setLoadingPreview(false)
    }
  }, [orderId, personalNote, pickedPhotoId])

  const uploadPhoto = async (file: File) => {
    setUploading(true)
    setErr(null)
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('type', 'JOB_PHOTO')
      fd.append('title', file.name)
      const res = await fetch(`/api/orders/${orderId}/documents`, { method: 'POST', body: fd })
      const data = await res.json()
      if (!res.ok) {
        setErr(data?.error || `upload HTTP ${res.status}`)
        return
      }
      // Pick the freshly-uploaded photo and refresh the doc list.
      setPickedPhotoId((data as OrderDocRow).id)
      await loadDocs()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'upload failed')
    } finally {
      setUploading(false)
    }
  }

  const onFile = (f: File | null) => {
    if (!f) return
    uploadPhoto(f)
  }

  const send = async () => {
    if (!preview) {
      // Force a preview pass before send so the rep can't fire blind.
      await runPreview()
      return
    }
    setSending(true)
    setErr(null)
    try {
      const res = await fetch(`/api/orders/${orderId}/thank-you/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          personalNote: personalNote.trim() || null,
          photoDocumentId: pickedPhotoId,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setErr(data?.error || `HTTP ${res.status}`)
        return
      }
      router.push('/dashboard')
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'send failed')
    } finally {
      setSending(false)
    }
  }

  const dismiss = async () => {
    setDismissing(true)
    setErr(null)
    try {
      const res = await fetch(`/api/orders/${orderId}/thank-you/dismiss`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: dismissReason.trim() || null }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        setErr(d?.error || `HTTP ${res.status}`)
        return
      }
      router.push('/dashboard')
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'dismiss failed')
    } finally {
      setDismissing(false)
    }
  }

  return (
    <div className="max-w-5xl mx-auto p-4 md:p-6">
      <Link href="/dashboard" className="text-sm text-gray-500 hover:text-gray-700 inline-block mb-4">
        ← Back to dashboard
      </Link>

      <div className="bg-amber-50 border border-amber-200 rounded p-3 text-xs text-amber-900 mb-4">
        ⚠ PLACEHOLDER COPY — needs Wes review before first real send. Template structural shell is final; subject line and body prose are starter drafts. Search for <code>[[PLACEHOLDER]]</code> in <code>src/lib/email/templates/thankYouTemplate.ts</code>.
      </div>

      {item && (
        <div className="mb-4">
          <h1 className="text-2xl font-semibold text-gray-900">
            Thank you to {item.company?.name || '(no client)'}
          </h1>
          <p className="text-sm text-gray-600 mt-1">
            {item.job?.name || item.orderNumber}
            {item.wrapDate && ' · wrapped ' + new Date(item.wrapDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
            {item.agent && ' · from ' + item.agent.name}
          </p>
          {item.status === 'SENT' && (
            <div className="mt-2 text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-3 py-2">
              Already sent {item.sentAt && '· ' + new Date(item.sentAt).toLocaleString()} to {item.sentToEmail}
            </div>
          )}
        </div>
      )}

      {err && (
        <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2 mb-4">
          {err}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Compose */}
        <div className="space-y-4">
          {/* Photo */}
          <section className="bg-white border border-gray-200 rounded-xl p-4">
            <h2 className="text-sm font-semibold text-gray-900 mb-2">Photo</h2>
            <p className="text-xs text-gray-500 mb-3">Strongly encouraged. Warehouse team can shoot on phones; clients love the candid.</p>
            {docs.filter((d) => d.type === 'JOB_PHOTO').length > 0 && (
              <div className="grid grid-cols-3 gap-2 mb-3">
                {docs.filter((d) => d.type === 'JOB_PHOTO').map((d) => (
                  <button
                    key={d.id}
                    type="button"
                    onClick={() => setPickedPhotoId(d.id === pickedPhotoId ? null : d.id)}
                    className={`relative aspect-square overflow-hidden rounded border-2 ${
                      pickedPhotoId === d.id ? 'border-amber-500' : 'border-transparent hover:border-gray-300'
                    }`}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={d.fileUrl} alt={d.title} className="w-full h-full object-cover" />
                    {pickedPhotoId === d.id && (
                      <span className="absolute top-1 right-1 bg-amber-500 text-white text-[10px] px-1.5 py-0.5 rounded">PICKED</span>
                    )}
                  </button>
                ))}
              </div>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              onChange={(e) => onFile(e.target.files?.[0] ?? null)}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="w-full min-h-[3rem] bg-gray-100 hover:bg-gray-200 border border-gray-300 border-dashed rounded text-sm text-gray-700 disabled:opacity-50"
            >
              {uploading ? 'Uploading…' : (docs.length > 0 ? '+ Upload another photo' : '+ Take or upload a photo')}
            </button>
            {pickedPhotoId === null && (
              <p className="text-xs text-gray-500 mt-2">
                Sending without a photo — clients still get a warm thank-you, but a candid lands much better.
              </p>
            )}
          </section>

          {/* Personal note */}
          <section className="bg-white border border-gray-200 rounded-xl p-4">
            <h2 className="text-sm font-semibold text-gray-900 mb-2">Personal note (optional)</h2>
            <p className="text-xs text-gray-500 mb-2">One line above the templated body. Keep it specific to this job.</p>
            <textarea
              value={personalNote}
              onChange={(e) => setPersonalNote(e.target.value)}
              rows={3}
              placeholder="e.g. Bryce — Jose said the cube was a perfect fit; have a great rest of your shoot."
              className="w-full px-3 py-2 border border-gray-300 rounded text-sm text-gray-900 resize-none"
            />
          </section>

          {/* Actions */}
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={runPreview}
              disabled={loadingPreview}
              className="px-4 py-2 bg-gray-900 hover:bg-black text-white text-sm font-medium rounded disabled:opacity-50"
            >
              {loadingPreview ? 'Rendering…' : 'Preview'}
            </button>
            <button
              type="button"
              onClick={send}
              disabled={sending || !preview || item?.status === 'SENT'}
              className="px-4 py-2 bg-amber-600 hover:bg-amber-500 text-white text-sm font-medium rounded disabled:opacity-50"
            >
              {sending ? 'Sending…' : 'Review & send'}
            </button>
            <button
              type="button"
              onClick={() => setShowDismiss((v) => !v)}
              disabled={item?.status === 'SENT'}
              className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900"
            >
              Dismiss
            </button>
          </div>

          {showDismiss && (
            <div className="bg-white border border-gray-200 rounded-xl p-4">
              <h3 className="text-sm font-semibold text-gray-900 mb-2">Dismiss this suggestion</h3>
              <p className="text-xs text-gray-500 mb-2">Optional: why? (Saved on the audit log.)</p>
              <input
                value={dismissReason}
                onChange={(e) => setDismissReason(e.target.value)}
                placeholder="e.g. open incident, sending follow-up instead"
                className="w-full px-3 py-2 border border-gray-300 rounded text-sm mb-3"
              />
              <button
                type="button"
                onClick={dismiss}
                disabled={dismissing}
                className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white text-sm rounded disabled:opacity-50"
              >
                {dismissing ? 'Dismissing…' : 'Confirm dismiss'}
              </button>
            </div>
          )}
        </div>

        {/* Preview */}
        <div>
          <section className="bg-white border border-gray-200 rounded-xl overflow-hidden h-fit sticky top-4">
            <div className="px-4 py-3 border-b border-gray-200 text-xs text-gray-500">
              {preview ? (
                <>
                  To <span className="text-gray-900">{preview.to ?? '(no recipient)'}</span> · From <span className="text-gray-900">{preview.from}</span> · Reply-To <span className="text-gray-900">{preview.replyTo}</span>
                </>
              ) : (
                <>Click <strong>Preview</strong> to render the email.</>
              )}
            </div>
            {preview && (
              <div className="text-xs text-gray-700 px-4 py-2 border-b border-gray-200">
                <strong>Subject:</strong> {preview.subject}
              </div>
            )}
            <iframe
              title="Thank-you preview"
              srcDoc={preview?.html ?? '<div style="padding:24px;color:#888;font-family:sans-serif;">No preview yet.</div>'}
              sandbox=""
              className="w-full h-[600px] bg-white"
            />
          </section>
        </div>
      </div>
    </div>
  )
}
