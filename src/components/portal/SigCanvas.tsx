'use client'

/**
 * SigCanvas — touch + mouse signature pad with data-URL output.
 *
 * Extracted from the legacy paperwork portal at
 * src/app/portal/[token]/page.tsx (~line 59 + initCanvas). This
 * version owns its own ref + drawn state internally and exposes a
 * single `onChange(dataUrl | null)` callback so callers don't have
 * to wire up canvas refs + initCanvas effects separately.
 *
 * Used by:
 *   - Phase 6 commit 3 NACHA ACH authorization capture (Job Page
 *     portal pay panel).
 *   - Future: any portal surface that needs an inline signature.
 *
 * Legacy callers in /portal/[token]/page.tsx still use the inline
 * SigCanvas + initCanvas pattern there — not migrated to keep this
 * commit focused on the new Job-Page surface.
 */

import { useEffect, useRef, useState } from 'react'

export interface SigCanvasProps {
  /** Fired whenever the drawing changes — dataUrl on first/each stroke,
   *  null after `Clear`. Use this to gate submit on `drawn=true`. */
  onChange?: (dataUrl: string | null) => void
  /** Optional placeholder shown when the canvas is empty. */
  placeholder?: string
  /** Tailwind classes for the outer wrapper. */
  className?: string
}

export function SigCanvas({
  onChange,
  placeholder = 'Sign here',
  className = '',
}: SigCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [drawn, setDrawn] = useState(false)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.strokeStyle = '#111827'
    ctx.lineWidth = 2.5
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'

    let drawing = false
    let lx = 0
    let ly = 0
    const getPos = (e: MouseEvent | TouchEvent) => {
      const r = canvas.getBoundingClientRect()
      const sx = canvas.width / r.width
      const sy = canvas.height / r.height
      if ('touches' in e) {
        return {
          x: (e.touches[0].clientX - r.left) * sx,
          y: (e.touches[0].clientY - r.top) * sy,
        }
      }
      return { x: (e.clientX - r.left) * sx, y: (e.clientY - r.top) * sy }
    }
    const onDown = (e: MouseEvent | TouchEvent) => {
      e.preventDefault()
      drawing = true
      const p = getPos(e)
      lx = p.x
      ly = p.y
    }
    const onMove = (e: MouseEvent | TouchEvent) => {
      e.preventDefault()
      if (!drawing) return
      const p = getPos(e)
      ctx.beginPath()
      ctx.moveTo(lx, ly)
      ctx.lineTo(p.x, p.y)
      ctx.stroke()
      lx = p.x
      ly = p.y
      if (!drawn) {
        setDrawn(true)
        onChange?.(canvas.toDataURL('image/png'))
      } else {
        onChange?.(canvas.toDataURL('image/png'))
      }
    }
    const onUp = () => {
      drawing = false
    }
    canvas.addEventListener('mousedown', onDown)
    canvas.addEventListener('mousemove', onMove)
    canvas.addEventListener('mouseup', onUp)
    canvas.addEventListener('touchstart', onDown)
    canvas.addEventListener('touchmove', onMove)
    canvas.addEventListener('touchend', onUp)
    return () => {
      canvas.removeEventListener('mousedown', onDown)
      canvas.removeEventListener('mousemove', onMove)
      canvas.removeEventListener('mouseup', onUp)
      canvas.removeEventListener('touchstart', onDown)
      canvas.removeEventListener('touchmove', onMove)
      canvas.removeEventListener('touchend', onUp)
    }
    // We intentionally don't depend on drawn or onChange — listeners
    // are wired once per canvas mount and read the latest values via
    // closure capture through setDrawn.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const clear = () => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    setDrawn(false)
    onChange?.(null)
  }

  return (
    <div className={className}>
      <div
        className="border-2 border-dashed border-gray-300 rounded-xl overflow-hidden bg-white relative"
        style={{ touchAction: 'none' }}
      >
        <canvas
          ref={canvasRef}
          width={600}
          height={150}
          className="w-full block"
          style={{ cursor: 'crosshair' }}
        />
        {!drawn && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <span className="text-gray-400 text-sm">{placeholder}</span>
          </div>
        )}
      </div>
      <button
        type="button"
        onClick={clear}
        className="mt-1 text-[11px] text-blue-600 hover:underline"
      >
        Clear
      </button>
    </div>
  )
}
