'use client';

import { useState } from 'react';

/**
 * The SirReel S on its white tile — the one brand lockup the staff shell
 * uses, in the desktop sidebar, the phone's top bar and the nav drawer.
 * It was the same four lines copy-pasted in all three places.
 *
 * TWO things it fixes, both from Wes on 2026-09-17: "the S logo in the top
 * left is a corrupted file apparently."
 *
 * 1. **THE FILE IS NOT CORRUPT.** `sirreel-s-icon-black.png` is a valid PNG
 *    — every chunk CRC checks out, the IDAT inflates, and it decodes to the
 *    mark exactly as drawn. What it IS, is the 1746x1246 original: 39KB of
 *    2.2 megapixels to paint a tile 28 CSS pixels wide. What Wes saw was
 *    iOS's missing-image placeholder after that request failed on LTE (it
 *    had rendered fine on wifi all week). So the shell now loads a 168x120
 *    copy — ~3KB, still 6x the pixels the biggest of the three tiles can
 *    show, resampled from the original with alpha-weighted area averaging.
 *    The full-resolution file stays in public/ as the artwork of record;
 *    nothing in the app reads it any more.
 *
 * 2. **A FAILED LOAD NO LONGER LOOKS BROKEN.** Any image can fail — a
 *    dropped request, Low Data Mode, a content blocker — and a bare <img>
 *    answers that with the browser's broken-image icon, in the top-left
 *    corner of every page in HQ. On error this falls back to an S set in
 *    the shell's own type: wrong in the details, right at 28 pixels, and
 *    never a broken glyph. The SVG carries a viewBox rather than a font
 *    size, so the one fallback fits all three tiles.
 */

/** The shell's copy. Not the 1746x1246 original — see above. */
export const BRAND_MARK_SRC = '/sirreel-s-icon-black-168.png';

export function BrandMark({ className = 'w-9 h-9 rounded-lg p-1' }: { className?: string }) {
  const [failed, setFailed] = useState(false);

  return (
    <span className={`flex-shrink-0 bg-white flex items-center justify-center ${className}`}>
      {failed ? (
        <svg viewBox="0 0 100 100" className="w-full h-full" aria-hidden="true" focusable="false">
          <text
            x="50"
            y="52"
            textAnchor="middle"
            dominantBaseline="central"
            fontSize="96"
            fontWeight="700"
            fill="#000000"
            fontFamily="Helvetica Neue, Arial Black, sans-serif"
          >
            S
          </text>
        </svg>
      ) : (
        <img
          src={BRAND_MARK_SRC}
          alt=""
          aria-hidden="true"
          width={168}
          height={120}
          className="w-full h-full object-contain"
          onError={() => setFailed(true)}
        />
      )}
    </span>
  );
}
