import Link from 'next/link'
import type { HomeTile } from '@/lib/site/homeTiles'
import { SwipeableMobileTile } from '@/components/site/SwipeableMobileTile'

/**
 * Home diagonal service-nav — 5 tessellating bands.
 *
 * GEOMETRY (zero-gap tessellation at any width): every band is a
 * parallelogram clip-path with a CONSTANT horizontal slant `--s` (px),
 * so the edge angle (~15°) is identical on every band and stays constant
 * as a band flex-grows on hover. `--s = height · tan(15°)`, derived from
 * the section height, so the angle is exactly 15° regardless of viewport.
 * Bands' bottom edges tile the container width exactly (flex sums to
 * 100%); each parallelogram's top is shifted +s uniformly. The first
 * band is flush-left, the last flush-right; every interior diagonal of
 * band N is shared exactly by band N+1 → no gaps, no double-paint.
 *
 * CRITICAL — the image is NEVER skewed. The clip-path is a diagonal
 * WINDOW on the band container only; the <img> inside is an upright
 * rectangle (object-fit: cover, no transform) sized 100%+s wide so it
 * fills the parallelogram's bounding box. You see a straight photo
 * through a diagonal opening; hovering reveals more of the same
 * undistorted rectangle.
 *
 * DUOTONE — collapsed shows the solid tile color. On hover the photo
 * fades in as a grayscale image under a color `multiply` overlay, so it
 * reads black-and-[color] (shadows stay black, highlights take the
 * color). No-image tiles deepen the solid color on hover instead.
 *
 * Interaction is pure CSS (:hover flex-grow + group-hover fades) — no
 * client JS. Mobile (<md) renders the same services as a vertical stack
 * of tap-through bands (no hover step).
 */

// ~15° slant: tan(15°) ≈ 0.2679.
const SLANT = 'calc((100dvh - var(--pubhdr)) * 0.2679)'
const SECTION_H = 'calc(100dvh - var(--pubhdr))'

// ── Mood knobs — brighten / warm the tiles here ───────────────────
// One place to dial the resting vibe. Higher = darker/moodier, lower =
// brighter/cheerier. Hover always lifts the scrim to HOVER_SCRIM_OPACITY.
//
// Resting black scrim opacity over each tile. LOWER = brighter, more
// vivid photos at rest (label legibility leans on the text-shadow +
// bottom gradient below, so don't drop this to ~0).
const REST_SCRIM_OPACITY = 0.42 // was 0.62 — too dark/noir
// Hover scrim — near-zero so the photo reads at full brightness. Unchanged.
const HOVER_SCRIM_OPACITY = 0.1
// Base grayscale-photo filter, applied BEFORE the colour multiply. A
// higher brightness lifts the whole tile and also intensifies the tint
// (white · colour = colour under multiply), so brighter reads as more
// vivid, not washed out.
const IMG_FILTER = 'grayscale(1) contrast(1.05) brightness(1.26)' // was brightness(1.12)
// Saturation boost on the COMPOSITED duotone (grayscale photo + colour
// multiply). >1 makes the tints energetic rather than muted. 1 = as-is.
const DUOTONE_SATURATE = 1.28
const DUOTONE_FILTER = `saturate(${DUOTONE_SATURATE})`
// Mobile resting overlay — left→right, darkest under the left-aligned
// label. Lighten in step with the desktop scrim.
const MOBILE_SCRIM = 'bg-gradient-to-r from-black/42 to-black/5' // was from-black/55 to-black/10

// Localized legibility halo behind tile TITLES only — a tight dark edge +
// soft glow so titles stay crisp over any busy duotone photo, without
// darkening the whole tile. Applied to every title, mobile + desktop.
const TITLE_SHADOW =
  '[text-shadow:0_1px_2px_rgba(0,0,0,0.95),0_0_4px_rgba(0,0,0,0.8),0_2px_16px_rgba(0,0,0,0.6)]'

function clipFor(i: number, last: number): string {
  if (i === 0) return `polygon(0 0, calc(100% + var(--s)) 0, 100% 100%, 0 100%)` // flush left
  if (i === last) return `polygon(var(--s) 0, 100% 0, 100% 100%, 0 100%)` // flush right
  return `polygon(var(--s) 0, calc(100% + var(--s)) 0, 100% 100%, 0 100%)`
}

export function ServiceTiles({ tiles }: { tiles: (HomeTile & { image: string | null })[] }) {
  const last = tiles.length - 1
  return (
    <div
      // --pubhdr: measured public-header height (utility row + divider +
      // nav row). Responsive because the wordmark grows lg+. --s derives
      // the constant slant px from the section height.
      className="[--pubhdr:133px] lg:[--pubhdr:141px]"
      // --hovergrow keeps the hovered band at ~50% for ANY tile count:
      // with N bands, grow=N-1 gives (N-1)/((N-1)+(N-1)·1) = 1/2 while
      // the other N-1 bands share the remaining half. Adding tiles just
      // narrows the resting slivers; the open size stays constant.
      style={{
        ['--s' as string]: SLANT,
        ['--hovergrow' as string]: String(Math.max(tiles.length - 1, 1)),
        ['--tile-rest-scrim' as string]: String(REST_SCRIM_OPACITY),
        ['--tile-hover-scrim' as string]: String(HOVER_SCRIM_OPACITY),
      }}
    >
      {/* ── Desktop: diagonal bands ─────────────────────────────── */}
      <div
        className="hidden md:flex w-full overflow-hidden bg-[#0c0c0d]"
        style={{ height: SECTION_H }}
      >
        {tiles.map((t, i) => {
          // Every full-cover layer spans the parallelogram's BOUNDING BOX
          // (box width + the slant overhang), left-anchored, so the
          // clip-path has content to reveal all the way to the leaning
          // top edge. Without the +--s width, the overhang would show the
          // container background (gaps between bands).
          const coverStyle: React.CSSProperties = { top: 0, bottom: 0, left: 0, width: 'calc(100% + var(--s))' }
          // Horizontal shift to seat the tilted label on the band's
          // diagonal AXIS: a middle parallelogram's mid-height centre is
          // s/2 right of the box centre; the flush-LEFT first band leans
          // one side only (s/4). The flush-RIGHT last band has a VERTICAL
          // right edge the tilted label would poke past — since the label
          // is now un-clipped (clip lives on the media layer only, below),
          // seat it centred in the band box (0) so it stays inside the
          // viewport at any width instead of overflowing off-screen.
          // Last (flush-right) tile: seat the label between its box centre
          // and its stripe centroid (s/6). Box-centre alone read too far
          // left (empty stripe to its right); the full centroid sits right
          // against the page edge. s/6 centres it in the visible magenta
          // while keeping a safe page-edge margin at every width.
          const axisShift = i === last ? 'calc(var(--s) / 6)' : i === 0 ? 'calc(var(--s) / 4)' : 'calc(var(--s) / 2)'

          // The diagonal WINDOW — clips the media/scrims only, NOT the
          // labels. Clipping the whole band cut long labels (e.g. the
          // flush-right "Wardrobe & Makeup") off at the band edge; keeping
          // the label outside the clip lets it read in full.
          const mediaLayers = (
            <div className="absolute inset-0" style={{ clipPath: clipFor(i, last) }}>
              {/* Always-visible media — the duotone photo, or a solid
                  colour fallback until a photo is uploaded. */}
              {t.image ? (
                <div className="absolute" style={{ ...coverStyle, filter: DUOTONE_FILTER }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={t.image}
                    alt=""
                    className="absolute inset-0 w-full h-full object-cover"
                    style={{ filter: IMG_FILTER }}
                  />
                  {/* colour multiply → black-and-[colour] duotone */}
                  <div className="absolute inset-0" style={{ backgroundColor: t.color, mixBlendMode: 'multiply' }} />
                </div>
              ) : (
                <div className="absolute" style={{ ...coverStyle, backgroundColor: t.color }} />
              )}

              {/* Dim scrim — heavy at rest, lifts on hover. */}
              <div
                className="absolute bg-black opacity-[var(--tile-rest-scrim)] group-hover:opacity-[var(--tile-hover-scrim)] transition-opacity duration-[350ms] ease-out pointer-events-none"
                style={coverStyle}
              />
              {/* Bottom darken keeps the expanded label legible. */}
              <div
                className="absolute bg-gradient-to-t from-black/55 via-transparent to-transparent pointer-events-none"
                style={coverStyle}
              />
            </div>
          )

          const inner = (
            <>
              {mediaLayers}

              {/* tilted label — un-clipped so it reads in full. Runs
                  PARALLEL to the diagonal edge (15° off vertical, clean
                  rotate). Visible collapsed; fades out on hover. */}
              <div className="absolute inset-0 flex items-center justify-center opacity-100 group-hover:opacity-0 transition-opacity duration-300 pointer-events-none">
                <span
                  className={`text-white font-black uppercase tracking-[0.1em] text-[26px] xl:text-[30px] whitespace-nowrap ${TITLE_SHADOW}`}
                  style={{ fontFamily: 'Archivo, sans-serif', transform: `translateX(${axisShift}) rotate(-75deg)` }}
                >
                  {t.label}
                </span>
              </div>

              {/* horizontal label + tagline — fades in on hover */}
              <div className="absolute left-0 right-0 bottom-0 p-7 opacity-0 group-hover:opacity-100 transition-opacity duration-300 delay-75 pointer-events-none"
                style={{ paddingLeft: `calc(1.75rem + var(--s))` }}>
                <div className={`text-white font-black uppercase tracking-[0.08em] text-[26px] leading-none ${TITLE_SHADOW}`} style={{ fontFamily: 'Archivo, sans-serif' }}>
                  {t.label}
                </div>
                <div className="text-white/85 text-[13px] mt-2 max-w-[26ch] [text-shadow:0_1px_8px_rgba(0,0,0,0.6)]">
                  {t.tagline}
                </div>
                {t.mode === 'coming-soon' ? (
                  <div className="mt-3 inline-block text-[10px] font-bold uppercase tracking-[0.14em] text-white/70 border border-white/40 rounded-full px-2.5 py-1">
                    Coming soon
                  </div>
                ) : (
                  <div className="mt-3 inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-[0.12em] text-white">
                    Enter <span aria-hidden>→</span>
                  </div>
                )}
              </div>
            </>
          )

          // Per-tile REST width. The flush-LEFT first tile's label leans
          // INTO the tile (away from its vertical edge), so it needs less
          // room; the flush-RIGHT last tile's label leans toward its
          // vertical edge and needs more. So narrow the first, widen the
          // last, interiors equal. Set as a CSS var the band's grow class
          // reads — a plain custom property (not inline flex-grow), so the
          // hover class still wins on :hover. Clip-path lives on the inner
          // media layer, so nothing else needs inline style here.
          const restGrow = i === 0 ? 0.7 : i === last ? 1.5 : 1
          const bandStyle = { ['--restgrow' as string]: String(restGrow) } as React.CSSProperties
          // Rest: grow = --restgrow, basis-0 → widths follow the weights.
          // Hover: grow = --hovergrow (=N-1) → hovered band stays ~50%
          // while the others share the rest as narrow slivers. ~350ms ease.
          const bandClass =
            'group relative h-full min-w-0 grow-[var(--restgrow)] basis-0 transition-[flex-grow] duration-[350ms] ease-out hover:grow-[var(--hovergrow)] focus-visible:grow-[var(--hovergrow)] outline-none'

          // coming-soon → non-navigating div; link/order → Link.
          return t.mode === 'coming-soon' || !t.href ? (
            <div key={t.slot} className={`${bandClass} cursor-default`} style={bandStyle} aria-label={`${t.label} — coming soon`}>
              {inner}
            </div>
          ) : (
            <Link key={t.slot} href={t.href} className={bandClass} style={bandStyle} aria-label={t.label}>
              {inner}
            </Link>
          )
        })}
      </div>

      {/* ── Mobile: vertical tap stack ──────────────────────────── */}
      <div className="md:hidden bg-[#0c0c0d]">
        {/* Branded band — mobile home landing only. Order form lives on the
            separate /order/supplies route, so this can't leak into focus mode.
            Kept compact so the tiles stay near the top of the fold. */}
        <div className="flex flex-col items-center justify-center gap-1 py-3.5 px-6 border-b border-white/10">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/sirreel-logo-white.png"
            alt="SirReel Studio Services"
            className="w-auto"
            style={{ maxWidth: 178, height: 'auto' }}
          />
          <div
            className="text-[#c39a3f] text-[11px] tracking-[0.2em] uppercase"
            style={{ fontFamily: 'Archivo, sans-serif' }}
          >
            Always on the job.
          </div>
        </div>
        {tiles.map((t, i) => {
          const inner = (
            <>
              <div className="absolute inset-0" style={{ backgroundColor: t.color }} />
              {t.image && (
                <div className="absolute inset-0" style={{ filter: DUOTONE_FILTER }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={t.image}
                    alt=""
                    className="absolute inset-0 w-full h-full object-cover"
                    style={{ filter: IMG_FILTER }}
                  />
                  <div className="absolute inset-0" style={{ backgroundColor: t.color, mixBlendMode: 'multiply' }} />
                  <div className={`absolute inset-0 ${MOBILE_SCRIM}`} />
                </div>
              )}
              <div className="absolute inset-0 flex flex-col justify-center px-6">
                <div className={`text-white font-black uppercase tracking-[0.08em] text-[26px] leading-none ${TITLE_SHADOW}`} style={{ fontFamily: 'Archivo, sans-serif' }}>
                  {t.label}
                </div>
                <div className="text-white/85 text-[12.5px] mt-1.5 [text-shadow:0_1px_8px_rgba(0,0,0,0.6)]">{t.tagline}</div>
                {t.mode === 'coming-soon' ? (
                  <div className="mt-2.5 inline-block self-start text-[10px] font-bold uppercase tracking-[0.14em] text-white/70 border border-white/40 rounded-full px-2.5 py-1">
                    Coming soon
                  </div>
                ) : (
                  <div className="mt-2.5 inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-[0.12em] text-white">
                    Enter <span aria-hidden>→</span>
                  </div>
                )}
              </div>
            </>
          )
          // Each tile is a FULL-RECTANGLE tap target — no clip-path on the
          // interactive element (that would shrink the hit-area so taps in
          // the cut corner fell through). Tiles butt together flush; a thin
          // skewed accent line (pointer-events-none, clipped by overflow)
          // keeps a hint of the diagonal language without eating taps.
          const isLast = i === last
          const rowStyle = { height: '20vh', minHeight: 132 } as React.CSSProperties
          const accent = !isLast && (
            <div
              className="absolute inset-x-0 -bottom-px h-[3px] bg-[#c39a3f]/45 pointer-events-none"
              style={{ transform: 'skewY(-1.2deg)' }}
            />
          )
          return (
            <SwipeableMobileTile
              key={t.slot}
              href={t.href}
              label={t.label}
              comingSoon={t.mode === 'coming-soon'}
              swipe={t.swipe}
              color={t.color}
              image={t.image}
              rowStyle={rowStyle}
              accent={accent}
            >
              {inner}
            </SwipeableMobileTile>
          )
        })}
      </div>
    </div>
  )
}
