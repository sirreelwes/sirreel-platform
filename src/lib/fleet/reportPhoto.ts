/**
 * Photo preparation for the condition report PDF.
 *
 * Two things were wrong with embedding the phone's original bytes:
 *
 * 1. Orientation. A phone stores the sensor's pixels and an EXIF tag
 *    saying "display this rotated". Browsers honour the tag; PDFKit does
 *    not — it embeds the raw JPEG — and @react-pdf only swaps the
 *    width/height it lays out with. So every portrait shot printed on
 *    its side (2026-09-07: the front and rear of Unit 29). `rotate()`
 *    with no argument bakes the EXIF orientation into the pixels and
 *    drops the tag, so what the PDF gets is what the tech saw.
 *
 * 2. Weight. A walk-around is 14 shots at 3–5 MB each, and the report
 *    inlined every byte of every one: a 50 MB PDF that a phone on the
 *    yard's Wi-Fi took a minute to open. The document prints each
 *    photo at roughly 225 pt wide, so 1400 px on the long edge is still
 *    3x that at print resolution — and the page comes down to a few MB.
 *
 * Anything sharp cannot decode (HEIC on the prebuilt libvips, a
 * truncated upload) returns null and prints as unavailable rather than
 * failing the whole document. The web viewer serves the original; this
 * derivative exists only for the PDF and is never stored.
 */

import sharp from 'sharp'

/** Long edge, in pixels, after downscaling. */
export const REPORT_PHOTO_MAX_EDGE = 1400

export interface PreparedPhoto {
  /** JPEG bytes, upright, downscaled. */
  data: Buffer
  width: number
  height: number
}

export async function preparePhotoForReport(bytes: Buffer): Promise<PreparedPhoto | null> {
  try {
    const { data, info } = await sharp(bytes, { failOn: 'none' })
      .rotate()
      .resize({
        width: REPORT_PHOTO_MAX_EDGE,
        height: REPORT_PHOTO_MAX_EDGE,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .jpeg({ quality: 82, mozjpeg: true })
      .toBuffer({ resolveWithObject: true })
    return { data, width: info.width, height: info.height }
  } catch (err) {
    console.warn('[reportPhoto] could not prepare photo for the PDF:', err instanceof Error ? err.message : err)
    return null
  }
}

/**
 * Run `fn` over `items` at most `limit` at a time. Decoding a 12 MP
 * JPEG costs ~50 MB of working memory; fourteen of them at once is how
 * a 1 GB function dies with nothing in the log.
 */
export async function mapWithLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  const worker = async () => {
    for (;;) {
      const i = next++
      if (i >= items.length) return
      out[i] = await fn(items[i])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return out
}
