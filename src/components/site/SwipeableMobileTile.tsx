'use client'

import { useRef, useState } from 'react'
import Link from 'next/link'

/**
 * Mobile-only swipe-to-reveal wrapper for a single home service band.
 *
 * A left-swipe slides the tile aside to reveal a DATA-DRIVEN action button
 * whose label + destination come from the tile's `swipe` config
 * (homeTiles.ts) — "Add Items" → order form, "View Vehicles" → /vehicles,
 * "Check Availability" / "Request a Quote" → the /contact intake with a
 * prefilled subject. Swipe is an ADDITIONAL express path: the normal
 * full-tile tap (`href`) is untouched, and coming-soon tiles keep their
 * non-navigating tap while still exposing the swipe action.
 *
 * Gesture is hand-rolled on touch events (no gesture library). `touch-
 * action: pan-y` lets the browser keep vertical scrolling while we own
 * horizontal drags. A drag past a small threshold suppresses the click so
 * a swipe never accidentally navigates the tile.
 *
 * Desktop is unaffected — this component is only mounted inside the
 * `md:hidden` mobile stack.
 */

const REVEAL = 150 // px the tile slides to expose the action button
const H_THRESHOLD = 6 // px before a move counts as a horizontal drag

export function SwipeableMobileTile({
  href,
  label,
  comingSoon,
  swipe,
  rowStyle,
  accent,
  children,
}: {
  href?: string
  label: string
  comingSoon: boolean
  swipe?: { label: string; href: string }
  rowStyle: React.CSSProperties
  accent: React.ReactNode
  children: React.ReactNode
}) {
  // Hooks run unconditionally (before any early return).
  const [tx, setTx] = useState(0) // current translateX (0…-REVEAL)
  const [dragActive, setDragActive] = useState(false)
  const startX = useRef(0)
  const startY = useRef(0)
  const dragging = useRef(false)
  const horizontal = useRef(false)
  const moved = useRef(false)
  const open = useRef(false)

  // No swipe action configured → plain tap target (Link or coming-soon div).
  if (!swipe) {
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

  // Foreground touch/transform props — spread onto a Link (tappable tile)
  // or a div (coming-soon tile: swipeable but no tap navigation).
  const fgProps = {
    className: 'absolute inset-0 block overflow-hidden',
    style: {
      transform: `translateX(${tx}px)`,
      transition: dragActive ? 'none' : 'transform 220ms ease',
      touchAction: 'pan-y' as const,
    },
    onTouchStart,
    onTouchMove,
    onTouchEnd,
    onTouchCancel: onTouchEnd,
    onClickCapture,
  }

  return (
    <div className="relative block w-full overflow-hidden" style={rowStyle}>
      {/* Revealed express action, pinned behind the tile's right edge. */}
      <Link
        href={swipe.href}
        aria-label={`${label} — ${swipe.label}`}
        className="absolute inset-y-0 right-0 flex items-center justify-center text-center bg-[#c39a3f] text-[#0c0c0d] font-black uppercase tracking-[0.05em] text-[12.5px] leading-tight px-3"
        style={{ width: REVEAL, fontFamily: 'Archivo, sans-serif' }}
      >
        {swipe.label}
      </Link>

      {/* Foreground tile — slides left to expose the action. A tappable
          tile keeps its normal navigation; a coming-soon tile is a plain
          div (swipe-only). touch-action pan-y preserves vertical scroll. */}
      {href ? (
        <Link href={href} aria-label={label} {...fgProps}>
          {children}
          {accent}
        </Link>
      ) : (
        <div aria-label={`${label} — coming soon`} {...fgProps}>
          {children}
          {accent}
        </div>
      )}
    </div>
  )
}
