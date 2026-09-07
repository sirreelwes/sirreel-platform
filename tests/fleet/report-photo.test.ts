/**
 * Condition-report photo prep — do phone photos print upright?
 *
 *   npx tsx tests/fleet/report-photo.test.ts
 *   npm run test:report-photo
 *
 * Offline: no DB, no blob store. A phone stores the sensor's landscape
 * pixels plus an EXIF tag that says "rotate me"; PDFKit embeds the raw
 * pixels and ignores the tag, which is how the front and rear of Unit
 * 29 printed on their side on 2026-09-07. `preparePhotoForReport` has
 * to bake the rotation in, downscale, and shrug off bytes it cannot
 * decode — each of those is a case here.
 */

import sharp from 'sharp'
import { preparePhotoForReport, REPORT_PHOTO_MAX_EDGE } from '../../src/lib/fleet/reportPhoto'

const failures: string[] = []
const ok = (cond: boolean, why: string) => {
  if (cond) console.log(`  ok — ${why}`)
  else {
    console.log(`  FAIL — ${why}`)
    failures.push(why)
  }
}

/** Landscape pixels with a bright band along the TOP edge. */
async function sensorJpeg(w: number, h: number, orientation?: number): Promise<Buffer> {
  const px = Buffer.alloc(w * h * 3)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 3
      const bright = y < h * 0.2
      px[i] = bright ? 255 : 40
      px[i + 1] = bright ? 255 : 40
      px[i + 2] = bright ? 255 : 40
    }
  let img = sharp(px, { raw: { width: w, height: h, channels: 3 } }).jpeg()
  if (orientation) img = img.withMetadata({ orientation })
  return img.toBuffer()
}

/** Mean luminance of a 1-pixel-wide strip: which edge is the bright one? */
async function edgeBrightness(jpeg: Buffer): Promise<{ top: number; right: number; bottom: number; left: number }> {
  const { data, info } = await sharp(jpeg).raw().toBuffer({ resolveWithObject: true })
  const at = (x: number, y: number) => data[(y * info.width + x) * info.channels]
  const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length
  const xs = Array.from({ length: info.width }, (_, x) => x)
  const ys = Array.from({ length: info.height }, (_, y) => y)
  return {
    top: avg(xs.map((x) => at(x, 2))),
    bottom: avg(xs.map((x) => at(x, info.height - 3))),
    left: avg(ys.map((y) => at(2, y))),
    right: avg(ys.map((y) => at(info.width - 3, y))),
  }
}

async function main() {
  console.log('preparePhotoForReport')

  // 1. EXIF orientation 6 (the common "phone held upright" tag): the
  //    output must be PORTRAIT with the bright edge on the RIGHT, and
  //    carry no orientation tag for a downstream renderer to misread.
  {
    const out = await preparePhotoForReport(await sensorJpeg(1600, 1200, 6))
    ok(!!out, 'orientation-6 JPEG decodes')
    if (out) {
      ok(out.height > out.width, `orientation 6 comes out portrait (${out.width}×${out.height})`)
      const e = await edgeBrightness(out.data)
      ok(e.right > 200 && e.top < 100 && e.left < 100, 'orientation 6: the bright top edge now sits on the right')
      const meta = await sharp(out.data).metadata()
      ok(meta.orientation === undefined || meta.orientation === 1, 'orientation tag is baked in, not left for the PDF to ignore')
    }
  }

  // 2. Orientation 8 rotates the other way — bright edge on the LEFT.
  {
    const out = await preparePhotoForReport(await sensorJpeg(1600, 1200, 8))
    if (out) {
      const e = await edgeBrightness(out.data)
      ok(out.height > out.width && e.left > 200 && e.right < 100, 'orientation 8: bright edge on the left')
    } else failures.push('orientation-8 JPEG decodes')
  }

  // 3. An untagged landscape shot is left alone.
  {
    const out = await preparePhotoForReport(await sensorJpeg(1600, 1200))
    if (out) {
      const e = await edgeBrightness(out.data)
      ok(out.width > out.height && e.top > 200, 'untagged landscape stays landscape, top edge still on top')
    } else failures.push('untagged JPEG decodes')
  }

  // 4. A full-resolution phone photo is downscaled; a small one is not enlarged.
  {
    const big = await preparePhotoForReport(await sensorJpeg(4000, 3000))
    ok(!!big && big.width === REPORT_PHOTO_MAX_EDGE && big.height === 1050, `4000×3000 downscales to ${REPORT_PHOTO_MAX_EDGE} on the long edge`)
    const small = await preparePhotoForReport(await sensorJpeg(640, 480))
    ok(!!small && small.width === 640 && small.height === 480, 'a small photo is not enlarged')
  }

  // 5. Garbage in → null out, never a throw: one bad blob must not
  //    cost the whole report.
  {
    const out = await preparePhotoForReport(Buffer.from('not an image at all'))
    ok(out === null, 'undecodable bytes return null instead of throwing')
  }

  if (failures.length) {
    console.error(`\n${failures.length} failure(s):\n  ${failures.join('\n  ')}`)
    process.exit(1)
  }
  console.log('\nall good')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
