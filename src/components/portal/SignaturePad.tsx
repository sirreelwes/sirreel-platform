'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Draw-to-sign pad for the portal countersign pages.
 *
 * Emits a PNG data URL through `onChange` (null when empty), which the
 * sign routes pass to the PDF renderer as `signatureImageDataUri`. The
 * contract document draws it as an <Image> and falls back to the typed
 * name only when no image is present — so before this existed, every
 * executed contract fell back, and the "signature" was a rendered font.
 *
 * Pointer Events cover mouse, trackpad, touch and stylus in one path;
 * `touch-action: none` on the canvas stops the browser from panning the
 * page instead of drawing, which is what breaks naive pads on phones.
 *
 * The canvas is sized to its own CSS box times devicePixelRatio so the
 * stroke isn't a blurry upscale on retina screens, and the backing store
 * is re-created on resize.
 */
export function SignaturePad({
  onChange,
  disabled = false,
  height = 160,
  label = 'Draw your signature',
}: {
  onChange: (dataUrl: string | null) => void
  disabled?: boolean
  height?: number
  label?: string
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const drawingRef = useRef(false)
  const dirtyRef = useRef(false)
  const [hasInk, setHasInk] = useState(false)

  // Re-create the backing store at device resolution. Any existing stroke
  // is lost on resize, which is why the pad is cleared alongside it.
  const sizeCanvas = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const dpr = window.devicePixelRatio || 1
    canvas.width = Math.max(1, Math.floor(rect.width * dpr))
    canvas.height = Math.max(1, Math.floor(rect.height * dpr))
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.scale(dpr, dpr)
    ctx.lineWidth = 2
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.strokeStyle = '#111111'
  }, [])

  useEffect(() => {
    sizeCanvas()
    const onResize = () => {
      sizeCanvas()
      dirtyRef.current = false
      setHasInk(false)
      onChange(null)
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [sizeCanvas, onChange])

  const pointFrom = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  const start = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (disabled) return
    const ctx = canvasRef.current?.getContext('2d')
    if (!ctx) return
    // Capture so a stroke that leaves the canvas still ends cleanly.
    e.currentTarget.setPointerCapture(e.pointerId)
    drawingRef.current = true
    const { x, y } = pointFrom(e)
    ctx.beginPath()
    ctx.moveTo(x, y)
    // A tap with no drag should still leave a mark.
    ctx.lineTo(x + 0.01, y)
    ctx.stroke()
    dirtyRef.current = true
  }

  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current || disabled) return
    const ctx = canvasRef.current?.getContext('2d')
    if (!ctx) return
    const { x, y } = pointFrom(e)
    ctx.lineTo(x, y)
    ctx.stroke()
  }

  const end = () => {
    if (!drawingRef.current) return
    drawingRef.current = false
    if (!dirtyRef.current) return
    setHasInk(true)
    onChange(canvasRef.current?.toDataURL('image/png') ?? null)
  }

  const clear = () => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    dirtyRef.current = false
    setHasInk(false)
    onChange(null)
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[13px] font-medium text-gray-700">{label}</span>
        <button
          type="button"
          onClick={clear}
          disabled={disabled || !hasInk}
          className="text-[12px] font-semibold text-gray-500 hover:text-gray-800 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Clear
        </button>
      </div>
      <div className="relative rounded-lg border border-gray-300 bg-white overflow-hidden">
        <canvas
          ref={canvasRef}
          onPointerDown={start}
          onPointerMove={move}
          onPointerUp={end}
          onPointerLeave={end}
          onPointerCancel={end}
          style={{ width: '100%', height, touchAction: 'none', cursor: disabled ? 'not-allowed' : 'crosshair' }}
        />
        {!hasInk && (
          <div className="pointer-events-none absolute inset-0 flex items-end justify-center pb-4">
            <div className="w-3/4 border-b border-gray-300 text-center">
              <span className="text-[12px] text-gray-400 relative top-2 bg-white px-2">
                Sign above
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
