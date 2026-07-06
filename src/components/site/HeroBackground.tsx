'use client'

import { useEffect, useState } from 'react'

/**
 * Home hero background media layer (client — needs matchMedia for the
 * mobile source switch). Rendered behind the hero content, with a ~50%
 * dark scrim ALWAYS on top for headline legibility.
 *
 *   - video set → muted autoplay loop playsInline, object-cover, full
 *     height, no controls; poster shows before/if autoplay is blocked.
 *     Under ~768px the mobile source is used when provided, else the
 *     desktop source.
 *   - no video, poster set → poster as a static cover background.
 *   - neither → this component isn't rendered (parent shows dark band).
 *
 * All srcs are public proxy paths (/api/public/site-media/*), never raw
 * private blob URLs.
 */
export function HeroBackground({
  poster,
  video,
  videoMobile,
}: {
  poster: string | null
  video: string | null
  videoMobile: string | null
}) {
  // Default to the desktop source so SSR and first client render match
  // (matchMedia is client-only); correct to mobile after mount.
  const [effectiveVideo, setEffectiveVideo] = useState<string | null>(video)

  useEffect(() => {
    if (!video) {
      setEffectiveVideo(null)
      return
    }
    const mql = window.matchMedia('(max-width: 767px)')
    const pick = () => setEffectiveVideo(mql.matches ? videoMobile ?? video : video)
    pick()
    mql.addEventListener('change', pick)
    return () => mql.removeEventListener('change', pick)
  }, [video, videoMobile])

  return (
    <div aria-hidden className="absolute inset-0 z-0">
      {effectiveVideo ? (
        <video
          // Remount on source swap so the browser reloads + re-autoplays.
          key={effectiveVideo}
          className="absolute inset-0 w-full h-full object-cover"
          autoPlay
          muted
          loop
          playsInline
          preload="metadata"
          poster={poster ?? undefined}
        >
          <source src={effectiveVideo} type="video/mp4" />
        </video>
      ) : poster ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={poster} alt="" className="absolute inset-0 w-full h-full object-cover" />
      ) : null}
      {/* Dark scrim — always, for headline legibility over bright footage. */}
      <div className="absolute inset-0 bg-[#0c0c0d]/50" />
    </div>
  )
}
