/**
 * Client-side image downscale for inventory photos. Shared by the
 * single-item detail modal and the bulk values+photos wizard so both
 * upload the same resized JPEGs (≤1600px long edge, quality 0.85).
 *
 * BROWSER-ONLY — uses Image / canvas / URL.createObjectURL. Import
 * only from client components ('use client'). HEIC/HEIF can't be
 * decoded by canvas in Chrome/Firefox, so callers should pass those
 * through raw (see RESIZEABLE_MIME).
 */

export const RESIZEABLE_MIME = new Set(['image/jpeg', 'image/png', 'image/webp'])
export const ACCEPT_IMAGE = 'image/jpeg,image/png,image/webp,image/heic,image/heif'
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024 // 10 MB — mirrors the upload route cap
export const MAX_LONG_EDGE = 1600

// Every async step below is bounded by a timeout. `Image` decode and
// especially `canvas.toBlob` can — on large/odd source images, under
// memory pressure, or in some HEIC-as-jpeg cases — leave their callback
// permanently un-fired. With no reject path that left the wrapping promise
// pending forever, so `uploadInventoryItemImage` never resolved, the
// caller's `finally` never ran, and the upload spinner hung indefinitely
// with no error. These caps guarantee the promise always settles.
const DECODE_TIMEOUT_MS = 20_000
const ENCODE_TIMEOUT_MS = 20_000
const UPLOAD_TIMEOUT_MS = 60_000

export async function resizeImage(file: File): Promise<Blob> {
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image()
      const timer = setTimeout(
        () => reject(new Error('Image is taking too long to open — try a different photo.')),
        DECODE_TIMEOUT_MS,
      )
      el.onload = () => { clearTimeout(timer); resolve(el) }
      el.onerror = () => { clearTimeout(timer); reject(new Error('Could not read that image file.')) }
      el.src = url
    })
    const { width, height } = img
    if (!width || !height) throw new Error('That image appears to be empty or corrupt.')
    const longEdge = Math.max(width, height)
    const scale = longEdge > MAX_LONG_EDGE ? MAX_LONG_EDGE / longEdge : 1
    const w = Math.round(width * scale)
    const h = Math.round(height * scale)
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('canvas not available')
    ctx.drawImage(img, 0, 0, w, h)
    const blob = await new Promise<Blob>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('Image is taking too long to process — try a smaller photo.')),
        ENCODE_TIMEOUT_MS,
      )
      canvas.toBlob(
        (b) => {
          clearTimeout(timer)
          if (b) resolve(b)
          else reject(new Error('Could not process that image.'))
        },
        'image/jpeg',
        0.85,
      )
    })
    return blob
  } finally {
    URL.revokeObjectURL(url)
  }
}

/**
 * Upload one image File to an inventory item, resizing eligible types
 * client-side first. Returns the new imageUrl. Throws on failure with
 * a human-readable message. Shared upload path for modal + wizard.
 */
export async function uploadInventoryItemImage(itemId: string, file: File): Promise<string> {
  if (file.size > MAX_IMAGE_BYTES) {
    throw new Error(`Image is ${(file.size / 1024 / 1024).toFixed(1)} MB; cap is ${MAX_IMAGE_BYTES / 1024 / 1024} MB.`)
  }
  const uploadable: Blob = RESIZEABLE_MIME.has(file.type) ? await resizeImage(file) : file
  const filename = RESIZEABLE_MIME.has(file.type) ? 'resized.jpg' : file.name
  const type = RESIZEABLE_MIME.has(file.type) ? 'image/jpeg' : file.type
  const form = new FormData()
  form.append('file', new File([uploadable], filename, { type }))

  // Bound the POST too — a stalled upload would otherwise leave the
  // caller's spinner spinning forever just like an un-fired toBlob.
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), UPLOAD_TIMEOUT_MS)
  let res: Response
  try {
    res = await fetch(`/api/inventory/items/${itemId}/image`, {
      method: 'POST',
      body: form,
      signal: controller.signal,
    })
  } catch (err) {
    if (controller.signal.aborted) {
      throw new Error('Upload timed out — check your connection and try again.')
    }
    throw err instanceof Error ? err : new Error('Upload failed.')
  } finally {
    clearTimeout(timer)
  }
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `Upload failed (HTTP ${res.status}).`)
  return data.item.imageUrl as string
}
