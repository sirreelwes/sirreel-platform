'use client'

/**
 * Whole-number input for fields that cannot be null — quantity, counts.
 *
 * The integer sibling of CurrencyInput, and it exists for the same reason:
 * a plain `value={n} onChange={n => set(Number(e.target.value) || 1)}` cannot
 * be cleared. Backspacing the last digit yields "", `Number("")` is 0, the
 * `|| 1` floor turns that into 1, and the field instantly repaints as "1" with
 * the caret behind it. The only way to change the number was to type in front
 * of the 1 and then delete it — which is exactly what reps were doing.
 *
 * So the draft is held as a STRING while focused and only committed on blur.
 * Empty commits back to `min` (or the previous value), so the field is
 * clearable while typing but can never persist a blank into a non-null column.
 *
 * Select-all on focus matches CurrencyInput: one keystroke replaces the value,
 * which is the common case on a quantity field.
 */

import { forwardRef, useState, type KeyboardEvent } from 'react'

export interface IntegerInputProps {
  value: number
  onChange: (next: number) => void
  /** Lower clamp applied on blur. Also what an empty field commits to. */
  min?: number
  max?: number
  placeholder?: string
  disabled?: boolean
  className?: string
  ariaLabel?: string
  /** Blur (and therefore commit) on Enter. Default true. */
  blurOnEnter?: boolean
}

export function parseInteger(s: string): number | null {
  const cleaned = s.replace(/[,\s]/g, '')
  if (cleaned === '') return null
  const n = parseInt(cleaned, 10)
  return Number.isFinite(n) ? n : null
}

export const IntegerInput = forwardRef<HTMLInputElement, IntegerInputProps>(
  function IntegerInput(
    { value, onChange, min = 1, max, placeholder, disabled, className, ariaLabel, blurOnEnter = true },
    ref,
  ) {
    const [focused, setFocused] = useState(false)
    const [draft, setDraft] = useState('')

    const displayValue = focused ? draft : String(value)

    const commit = () => {
      const parsed = parseInteger(draft)
      // Empty (or unparseable) falls back to the floor rather than to 0 —
      // a quantity of nothing isn't a thing the order can hold.
      let next = parsed ?? min
      next = Math.max(min, next)
      if (max != null) next = Math.min(max, next)
      if (next !== value) onChange(next)
    }

    const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
      if (blurOnEnter && e.key === 'Enter') {
        e.preventDefault()
        ;(e.target as HTMLInputElement).blur()
      }
    }

    return (
      <input
        ref={ref}
        // `text` + inputMode, not `type="number"`: number inputs swallow the
        // transient empty/partial states this component exists to allow, and
        // bring scroll-wheel edits nobody asked for.
        type="text"
        inputMode="numeric"
        value={displayValue}
        placeholder={placeholder}
        disabled={disabled}
        aria-label={ariaLabel}
        onFocus={(e) => {
          setFocused(true)
          setDraft(String(value))
          requestAnimationFrame(() => {
            try { e.target.select() } catch { /* no-op */ }
          })
        }}
        onBlur={() => {
          setFocused(false)
          commit()
        }}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={handleKeyDown}
        className={className}
      />
    )
  },
)
