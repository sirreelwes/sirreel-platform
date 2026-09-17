/**
 * Draw the date/time caption onto a COPY of a walk-around photo, for
 * saving (Hugo, 2026-09-17: "save a photo from HQ to do a damage
 * report" — a photo in a claim needs its time on it, the way DamageID
 * prints it). The stored original is never modified: this runs at
 * download and returns new bytes, so what the yard captured stays as
 * captured and the stamp is always re-drawn from the record's own time.
 *
 * Server-only. @napi-rs/canvas is loaded dynamically (it is a native
 * binary, externalized in next.config.js) and the font is the Liberation
 * Sans that pdfjs-dist already ships — a Vercel lambda has no system
 * fonts, and text drawn with no font is silently blank. Both are traced
 * into the photo route in next.config.js.
 *
 * Returns null on anything it cannot decode (HEIC is the usual one —
 * canvas reads JPEG/PNG/WebP) so the route can fall back to the raw
 * file with the same good filename rather than fail the download.
 */

import path from 'path'

export interface StampedPhoto {
  bytes: Buffer
  contentType: 'image/jpeg'
}

const FONT_FAMILY = 'SirReelStamp'
let fontReady: boolean | null = null

async function ensureFont(): Promise<boolean> {
  if (fontReady != null) return fontReady
  try {
    const { GlobalFonts } = await import('@napi-rs/canvas')
    const file = path.join(process.cwd(), 'node_modules', 'pdfjs-dist', 'standard_fonts', 'LiberationSans-Bold.ttf')
    fontReady = !!GlobalFonts.registerFromPath(file, FONT_FAMILY)
    if (!fontReady) console.error('[stampPhoto] font not registered:', file)
  } catch (err) {
    console.error('[stampPhoto] font load failed:', err instanceof Error ? err.message : err)
    fontReady = false
  }
  return fontReady
}

export async function stampPhoto(args: {
  bytes: Buffer
  contentType: string | null
  caption: string
}): Promise<StampedPhoto | null> {
  try {
    const [{ createCanvas, loadImage }, haveFont] = await Promise.all([import('@napi-rs/canvas'), ensureFont()])
    if (!haveFont) return null
    const img = await loadImage(args.bytes)
    const iw = img.width
    const ih = img.height
    if (!iw || !ih) return null

    // `loadImage` already turns the pixels the way the phone's EXIF
    // orientation tag says (verified on 0.1.100: an orientation-6 JPEG
    // decodes as portrait with the sensor's top edge on the right), so
    // the frame here is the picture as SEEN and the band goes along its
    // bottom. Do NOT apply the tag again — that flips a portrait shot
    // upside down and back to landscape, which is what the first cut
    // of this did.
    const w = iw
    const h = ih
    const canvas = createCanvas(w, h)
    const ctx = canvas.getContext('2d')
    ctx.drawImage(img, 0, 0, iw, ih)

    // Band height scales with the picture so a 4000px phone shot and a
    // 1200px one both read at the same size when printed.
    const fontPx = Math.max(18, Math.round(Math.min(w, h) * 0.028))
    const pad = Math.round(fontPx * 0.6)
    const band = fontPx + pad * 2
    ctx.fillStyle = 'rgba(0, 0, 0, 0.62)'
    ctx.fillRect(0, h - band, w, band)
    ctx.fillStyle = '#FFFFFF'
    ctx.font = `${fontPx}px "${FONT_FAMILY}"`
    ctx.textBaseline = 'middle'
    // Shrink rather than clip: the date is at the END of the caption and
    // is the part that must survive.
    let text = args.caption
    let size = fontPx
    while (ctx.measureText(text).width > w - pad * 2 && size > 10) {
      size -= 1
      ctx.font = `${size}px "${FONT_FAMILY}"`
    }
    if (ctx.measureText(text).width > w - pad * 2) {
      while (text.length > 8 && ctx.measureText(`…${text}`).width > w - pad * 2) text = text.slice(1)
      text = `…${text}`
    }
    ctx.fillText(text, pad, h - band / 2)

    const bytes = await canvas.encode('jpeg', 90)
    return { bytes: Buffer.from(bytes), contentType: 'image/jpeg' }
  } catch (err) {
    console.error('[stampPhoto] failed:', err instanceof Error ? err.message : err)
    return null
  }
}
