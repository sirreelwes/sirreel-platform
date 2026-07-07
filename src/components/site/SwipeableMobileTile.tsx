'use client'

import { useRef, useState } from 'react'
import Link from 'next/link'

/**
 * Mobile-only swipe-to-add wrapper for a single home service band.
 *
 * SELF-SERVE tiles (Pro Supplies, Radios & WiFi) gain a left-swipe
 * gesture that slides the tile aside to reveal an "Add Items" button; it
 * navigates to the SAME deep-link the tile already points at (the Build 1
 * `?category=` order-form URL). The normal full-tile tap is untouched —
 * swipe is an ADDITIONAL express path, not a replacement.
 *
 * Non-self-serve tiles (coming-soon / quote-only) render as the plain
 * tap target with no swipe affordance.
 *
 * Gesture is hand-rolled on touch events (no gesture library). `touch-
 * action: pan-y` lets the browser keep vertical scrolling while we own
 * horizontal drags. A drag past a small threshold suppresses the click so
 * a swipe never accidentally navigates the tile.
 *
 * Desktop is unaffected — this component is only mounted inside the
 * `md:hidden` mobile stack.
 */

const REVEAL = 132 // px the tile slides to expose the Add Items button
const H_THRESHOLD = 6 // px before a move counts as a horizontal drag

export function SwipeableMobileTile({
  href,
  label,
  comingSoon,
  selfServe,
  addHref,
  rowStyle,
  accent,
  children,
}: {
  href?: string
  label: string
  comingSoon: boolean
  selfServe: boolean
  addHref?: string
  rowStyle: React.CSSProperties
  accent: React.ReactNode
  children: React.ReactNode
}) {
  // ── Non-self-serve: exact plain markup, no swipe ────────────────
  if (!selfServe || !href || !addHref) {
    return comingSoon || !href ? (
      <div className="relative block w-full overflow-hidden" style={rowStyle} aria-label={`${label} — coming soon`}>
        {children}
        {accent}
      </div>
    ) : (
      <Link href={href} className="relative block w-full overflow-hidden" style={rowStyle} aria-label={label}>
        {children}
        {accent}
      </Link>
    )
  }

  // ── Self-serve: swipeable express path ──────────────────────────
  const [tx, setTx] = useState(0) // current translateX (0…-REVEAL)
  const [dragActive, setDragActive] = useState(false)
  const startX = useRef(0)
  const startY = useRef(0)
  const dragging = useRef(false)
  const horizontal = useRef(false)
  const moved = useRef(false)
  const open = useRef(false)

  const onTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0]
    startX.current = t.clientX
    startY.current = t.clientY
    dragging.current = true
    horizontal.current = false
    moved.current = false
  }

  const onTouchMove = (e: React.TouchEvent) => {
    if (!dragging.current) return
    const t = e.touches[0]
    const dX = t.clientX - startX.current
    const dY = t.clientY - startY.current
    if (!horizontal.current) {
      if (Math.abs(dX) < H_THRESHOLD) return
      // Vertical intent → let the page scroll, abandon this gesture.
      if (Math.abs(dY) > Math.abs(dX)) {
        dragging.current = false
        return
      }
      horizontal.current = true
      moved.current = true
      setDragActive(true)
    }
    const base = open.current ? -REVEAL : 0
    const next = Math.max(-REVEAL, Math.min(0, base + dX))
    setTx(next)
  }

  const onTouchEnd = () => {
    if (!dragging.current && !horizontal.current) return
    dragging.current = false
    setDragActive(false)
    if (horizontal.current) {
      const shouldOpen = tx <= -REVEAL / 2
      open.current = shouldOpen
      setTx(shouldOpen ? -REVEAL : 0)
    }
  }

  // A drag that moved horizontally must not also fire the tile's tap.
  const onClickCapture = (e: React.MouseEvent) => {
    if (moved.current) {
      e.preventDefault()
      e.stopPropagation()
      moved.current = false
    }
  }

  return (
    <div className="relative block w-full overflow-hidden" style={rowStyle}>
      {/* Revealed express action, pinned behind the tile's right edge. */}
      <Link
        href={addHref}
        aria-label={`${label} — add items`}
        className="absolute inset-y-0 right-0 flex flex-col items-center justify-center gap-1 bg-[#c39a3f] text-[#0c0c0d] font-black uppercase tracking-[0.06em] text-[13px]"
        style={{ width: REVEAL, fontFamily: 'Archivo, sans-serif' }}
      >
        <span aria-hidden className="text-[18px] leading-none">+</span>
        Add Items
      </Link>

      {/* Foreground tile — slides left to expose the action. Normal tap
          still navigates to `href`; touch-action pan-y keeps scrolling. */}
      <Link
        href={href}
        aria-label={label}
        className="absolute inset-0 block overflow-hidden"
        style={{
          transform: `translateX(${tx}px)`,
          transition: dragActive ? 'none' : 'transform 220ms ease',
          touchAction: 'pan-y',
        }}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchEnd}
        onClickCapture={onClickCapture}
      >
        {children}
        {accent}
      </Link>
    </div>
  )
}
