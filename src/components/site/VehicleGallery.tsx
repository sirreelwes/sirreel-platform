'use client'

import { useState } from 'react'

/**
 * Public vehicle detail gallery — primary hero + thumbnail strip, tap a
 * thumbnail to swap it into the hero. Falls back to a single hero image when
 * the vehicle only has its legacy single photo, and to the truck placeholder
 * when it has no image at all (kept for safety — visible vehicles are
 * guaranteed at least one image source by the publish gate).
 */

export interface GalleryPhoto {
  id: string
  src: string
}

function TruckPlaceholder() {
  return (
    <div className="w-full h-[280px] sm:h-[400px] bg-gradient-to-br from-[#1a1a1c] to-[#0c0c0d] flex items-center justify-center">
      <svg width={90} height={90} viewBox="0 0 24 24" fill="none" stroke="#c39a3f" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" className="opacity-70">
        <path d="M5 17h14M5 17a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h11l3 4h0a2 2 0 0 1 2 2v2a2 2 0 0 1-2 2M5 17a2 2 0 0 0 2 2h0a2 2 0 0 0 2-2m6 0a2 2 0 0 0 2 2h0a2 2 0 0 0 2-2" />
      </svg>
    </div>
  )
}

export default function VehicleGallery({
  photos,
  fallbackSrc,
  alt,
}: {
  /** Gallery photos, primary first. */
  photos: GalleryPhoto[]
  /** Legacy single-photo proxy path when there are no gallery rows. */
  fallbackSrc: string | null
  alt: string
}) {
  const [activeId, setActiveId] = useState<string | null>(photos[0]?.id ?? null)

  const active = photos.find((p) => p.id === activeId) ?? photos[0] ?? null
  const heroSrc = active?.src ?? fallbackSrc

  return (
    <div>
      <div className="rounded-[18px] overflow-hidden border border-[#e4dfd4] bg-white shadow-sm">
        {heroSrc ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={heroSrc}
            alt={alt}
            className="w-full h-[280px] sm:h-[400px] object-cover bg-[#f0eadb]"
          />
        ) : (
          <TruckPlaceholder />
        )}
      </div>

      {photos.length > 1 && (
        <div className="mt-3 flex gap-2.5 overflow-x-auto pb-1">
          {photos.map((p) => {
            const isActive = p.id === active?.id
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => setActiveId(p.id)}
                aria-label={`Show photo of ${alt}`}
                aria-pressed={isActive}
                className={`shrink-0 rounded-[10px] overflow-hidden border-2 transition-colors ${
                  isActive ? 'border-[#c39a3f]' : 'border-[#e4dfd4] hover:border-[#c9c2b4]'
                }`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.src} alt="" className="w-[88px] h-[64px] object-cover bg-[#f0eadb]" loading="lazy" />
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
