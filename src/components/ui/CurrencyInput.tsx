'use client'

/**
 * USD currency input.
 *
 * - `$` prefix adornment rendered inside the input padding so the
 *   stored value stays numeric (no $ in the data).
 * - On blur: display formats to two decimals (3 → "3.00", 3.6 → "3.60").
 * - On focus: display flips to a raw editable string so the cursor
 *   isn't fighting the prefix. The input also selects-all on focus
 *   so a single keystroke replaces the value — matches the typing
 *   pattern on every other number-ish field in the editor.
 * - Lenient parse: strips `$`, commas, and whitespace on blur so a
 *   pasted "$1,250.00" or " 1250 " lands as 1250.
 *
 * Display only — schema and math stay numeric. Used by every price /
 * rate / amount input in the order editor, the discount form, and
 * the admin package builder.
 */

import { forwardRef, useState, type KeyboardEvent } from 'react'

export interface CurrencyInputProps {
  value: number
  onChange: (next: number) => void
  /** Lower clamp on blur. Omit to accept any value (used by the
   *  discount Amount field which accepts negatives). Line-item rate
   *  / price fields should explicitly pass `min={0}`. */
  min?: number
  /** Upper clamp on blur. */
  max?: number
  placeholder?: string
  disabled?: boolean
  /** Wrapper class — controls width / layout. */
  className?: string
  /** Class for the input element itself — typography, border, focus. */
  inputClassName?: string
  /** Submit on Enter (blurs input). Default true. */
  blurOnEnter?: boolean
  ariaLabel?: string
}

export function parseCurrency(s: string): number {
  if (!s) return 0
  const cleaned = s.replace(/[$,\s]/g, '')
  const n = parseFloat(cleaned)
  return Number.isFinite(n) ? n : 0
}

export function formatCurrencyDisplay(n: number): string {
  if (!Number.isFinite(n)) return '0.00'
  return n.toFixed(2)
}

export const CurrencyInput = forwardRef<HTMLInputElement, CurrencyInputProps>(
  function CurrencyInput(
    {
      value, onChange, min, max, placeholder, disabled,
      className, inputClassName, blurOnEnter = true, ariaLabel,
    },
    ref,
  ) {
    const [focused, setFocused] = useState(false)
    const [draft, setDraft] = useState('')

    const displayValue = focused ? draft : formatCurrencyDisplay(value)

    const commit = () => {
      let parsed = parseCurrency(draft)
      if (min != null) parsed = Math.max(min, parsed)
      if (max != null) parsed = Math.min(max, parsed)
      if (parsed !== value) onChange(parsed)
    }

    const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
      if (blurOnEnter && e.key === 'Enter') {
        e.preventDefault()
        ;(e.target as HTMLInputElement).blur()
      }
    }

    return (
      <div className={`relative ${className ?? ''}`}>
        <span className="absolute left-2 top-1/2 -translate-y-1/2 text-lt-fg3 text-sm pointer-events-none select-none">
          $
        </span>
        <input
          ref={ref}
          type="text"
          inputMode="decimal"
          value={displayValue}
          placeholder={placeholder ?? '0.00'}
          disabled={disabled}
          aria-label={ariaLabel}
          onFocus={(e) => {
            setFocused(true)
            setDraft(value === 0 ? '' : String(value))
            // Defer select() so the focus settle's done first.
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
          className={`w-full pl-5 ${inputClassName ?? ''}`}
        />
      </div>
    )
  },
)
