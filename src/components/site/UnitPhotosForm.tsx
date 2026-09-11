'use client'
/**
 * The partner adds photos to their own unit.
 *
 * Wes 2026-09-10: Evan should be able to put his own pictures on his units
 * rather than email them to us and wait for someone to upload them.
 *
 * Thumbnails come through the account-token proxy, never the blob URL — the
 * bytes live in the private store and the token is the credential (same rule
 * as every other partner-facing image).
 *
 * The count is the honest part of the copy: a unit with no photos is why it
 * is not on sirreel.com yet, so the empty state says that rather than sitting
 * there as a silent empty strip.
 */
import { useCallback, useEffect, useRef, useState } from 'react'

interface Photo { id: string; caption: string | null; isPrimary: boolean }

export function UnitPhotosForm({ token, unitId, unitName, preview, noun }: {
  token: string
  unitId: string
  unitName: string
  preview: boolean
  /** "unit" / "vehicle" — from partnerVocab. */
  noun: string
}) {
  const [photos, setPhotos] = useState<Photo[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const base = `/api/public/vendor-account/${token}/units/${unitId}/photos`

  const load = useCallback(async () => {
    if (preview) { setPhotos([]); return }
    try {
      const r = await fetch(base, { cache: 'no-store' })
      const j = await r.json().catch(() => ({}))
      setPhotos(r.ok ? (j.photos ?? []) : [])
    } catch { setPhotos([]) }
  }, [base, preview])

  useEffect(() => { load() }, [load])

  async function upload(files: FileList | null) {
    if (!files?.length) return
    setBusy(true); setErr(null)
    try {
      // One at a time on purpose: the route caps the total, and a serial loop
      // means the fifth photo failing does not lose the four that worked.
      for (const file of Array.from(files)) {
        const fd = new FormData()
        fd.append('file', file)
        const r = await fetch(base, { method: 'POST', body: fd })
        if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.error || `${file.name} did not upload`)
      }
      await load()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not upload')
      await load()
    } finally {
      setBusy(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  async function remove(id: string) {
    if (!window.confirm('Remove this photo?')) return
    setBusy(true); setErr(null)
    try {
      const r = await fetch(`${base}?photoId=${id}`, { method: 'DELETE' })
      if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.error || 'Could not remove it')
      await load()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not remove it')
    } finally { setBusy(false) }
  }

  const count = photos?.length ?? 0

  return (
    <div style={{ marginTop: 8 }}>
      {count > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 6 }}>
          {photos!.map((p) => (
            <div key={p.id} style={{ position: 'relative', width: 72, height: 54, borderRadius: 6, overflow: 'hidden', border: '1px solid #e2ddd0', background: '#f6f4ef' }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`/api/public/vendor-account/${token}/photo/${p.id}`}
                alt={p.caption || `${unitName} photo`}
                style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
              />
              {!preview && (
                <button
                  type="button"
                  onClick={() => remove(p.id)}
                  aria-label={`Remove photo of ${unitName}`}
                  style={{ position: 'absolute', top: 2, right: 2, width: 18, height: 18, lineHeight: '16px', textAlign: 'center', fontSize: 12, fontWeight: 700, color: '#fff', background: 'rgba(0,0,0,0.55)', border: 0, borderRadius: 9, cursor: 'pointer', padding: 0 }}
                >
                  ×
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
        multiple
        hidden
        onChange={(e) => upload(e.target.files)}
      />
      <button
        type="button"
        disabled={preview || busy}
        onClick={() => fileRef.current?.click()}
        style={{ fontSize: 12, fontWeight: 600, color: '#111', background: 'none', border: '1px solid #d6d1c4', borderRadius: 6, padding: '4px 10px', cursor: preview || busy ? 'default' : 'pointer', opacity: preview || busy ? 0.5 : 1 }}
      >
        {busy ? 'Uploading…' : count > 0 ? 'Add more photos' : 'Add photos'}
      </button>

      {count === 0 && photos !== null && (
        <span style={{ fontSize: 11, color: '#8a8272', marginLeft: 8 }}>
          No photos yet — productions see this {noun} without one until you add some.
        </span>
      )}
      {count > 0 && (
        <span style={{ fontSize: 11, color: '#8a8272', marginLeft: 8 }}>
          Your photos go live as soon as this {noun} is offered and the agreement is signed; SirReel is told each time you add some.
        </span>
      )}
      {err && <div style={{ fontSize: 12, color: '#a33a2e', marginTop: 4 }}>{err}</div>}
    </div>
  )
}
