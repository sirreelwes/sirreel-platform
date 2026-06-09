'use client'

/**
 * DiscountsPanel — first-class discount UI on the order detail page.
 *
 * Two scopes:
 *   DEPARTMENT — per-department row; only departments with a current
 *                lineSubtotal > 0 (i.e. there's something to discount
 *                against) show an "+ Add discount" affordance.
 *   ORDER      — single row for an order-wide discount; offers three
 *                entry modes: PERCENT, FIXED, FLAT TOTAL. Flat-total
 *                computes the implied FIXED-value discount against the
 *                already-department-discounted subtotal and stores it
 *                as a FIXED OrderDiscount row.
 *
 * The panel renders nothing (`null`) when the order has no line items
 * AND no existing discounts — "no discounts = layout unchanged" per
 * the spec.
 *
 * Reads /api/orders/[id]/discounts which returns
 * `{ discounts, breakdown }` from the shared discount-aware totals
 * util. Mutations call /api/orders/[id]/discounts (POST) and
 * /api/orders/[id]/discounts/[discountId] (PATCH/DELETE), each of
 * which cascades recalcOrderTotals server-side. Parent passes
 * onChange so it can re-fetch the Order row after persisted columns
 * shift.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'

const DEPT_LABELS: Record<string, string> = {
  VEHICLES: 'Trucking',
  COMMUNICATIONS: 'Communications',
  STAGES: 'Studios',
  PRO_SUPPLIES: 'Pro Supplies',
  EXPENDABLES: 'Expendables',
  GE: 'Grip & Electric',
  ART: 'Art Department',
}

type Scope = 'ORDER' | 'DEPARTMENT'
type Type = 'PERCENT' | 'FIXED'

interface DiscountRow {
  id: string
  scope: Scope
  departmentKey: string | null
  type: Type
  value: number
  label: string
}

interface DeptBreakdown {
  department: string
  lineSubtotal: number
  discount: number
  discountLabel: string | null
  netSubtotal: number
}

interface Breakdown {
  rawSubtotal: number
  byDepartment: DeptBreakdown[]
  departmentDiscountSum: number
  discountedSubtotal: number
  orderDiscount: number
  orderDiscountLabel: string | null
  preTaxSubtotal: number
  taxRate: number
  taxAmount: number
  total: number
}

export interface DiscountsPanelData {
  discounts: DiscountRow[]
  breakdown: Breakdown
}

function fmt(n: number): string {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
}

export function DiscountsPanel({
  orderId,
  isEditable,
  data,
  onChange,
}: {
  orderId: string
  isEditable: boolean
  data: DiscountsPanelData | null
  onChange: () => void
}) {
  const [addingDept, setAddingDept] = useState<string | null>(null) // dept key or null
  const [addingOrder, setAddingOrder] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  // Reset any open form when the underlying data shifts (post-save).
  useEffect(() => {
    if (!pending) return
    setPending(false)
    setAddingDept(null)
    setAddingOrder(false)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data])

  const departments = useMemo(() => data?.breakdown.byDepartment ?? [], [data])
  const existingDeptDiscounts = useMemo(
    () => Object.fromEntries((data?.discounts ?? []).filter(d => d.scope === 'DEPARTMENT' && d.departmentKey).map(d => [d.departmentKey, d])),
    [data],
  )
  const existingOrderDiscount = useMemo(
    () => (data?.discounts ?? []).find(d => d.scope === 'ORDER') ?? null,
    [data],
  )

  const hasAnyContent =
    departments.length > 0 ||
    (data?.discounts.length ?? 0) > 0

  if (!data || !hasAnyContent) return null

  const post = async (body: object) => {
    setError(null)
    setPending(true)
    try {
      const res = await fetch(`/api/orders/${orderId}/discounts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data?.error || `HTTP ${res.status}`)
        setPending(false)
        return
      }
      onChange()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'network error')
      setPending(false)
    }
  }

  const remove = async (discountId: string) => {
    setError(null)
    setPending(true)
    try {
      const res = await fetch(`/api/orders/${orderId}/discounts/${discountId}`, { method: 'DELETE' })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        setError(d?.error || `HTTP ${res.status}`)
        setPending(false)
        return
      }
      onChange()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'network error')
      setPending(false)
    }
  }

  return (
    <div className="px-6 py-4 border-t border-lt-hairline">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-lt-fg3">Discounts</h3>
      </div>

      {error && (
        <div className="mb-3 text-xs text-chip-bad-fg bg-chip-bad-bg px-2 py-1 rounded">{error}</div>
      )}

      {/* ── Per-department ─────────────────────────────────────── */}
      <div className="space-y-2">
        {departments.filter(d => d.lineSubtotal > 0).map(dept => {
          const existing = existingDeptDiscounts[dept.department]
          const open = addingDept === dept.department
          return (
            <div key={dept.department} className="text-sm">
              <div className="flex items-center justify-between py-1">
                <span className="text-lt-fg2">
                  <span className="font-medium text-lt-fg">{DEPT_LABELS[dept.department] ?? dept.department}</span>
                  <span className="text-lt-fg3 ml-2 text-xs">subtotal {fmt(dept.lineSubtotal)}</span>
                </span>
                {existing ? (
                  <div className="flex items-center gap-2 text-xs">
                    <span className="text-chip-bad-fg font-mono">
                      −{fmt(dept.discount)} ({existing.type === 'PERCENT' ? `${existing.value}%` : fmt(existing.value)})
                    </span>
                    {existing.label && existing.label !== 'Discount' && (
                      <span className="text-lt-fg3 italic">"{existing.label}"</span>
                    )}
                    {isEditable && (
                      <button
                        onClick={() => remove(existing.id)}
                        disabled={pending}
                        className="text-lt-fg3 hover:text-chip-bad-fg ml-1"
                      >
                        Remove
                      </button>
                    )}
                  </div>
                ) : isEditable ? (
                  <button
                    onClick={() => setAddingDept(open ? null : dept.department)}
                    className="text-xs text-lt-fg2 hover:text-lt-fg"
                  >
                    {open ? 'Cancel' : '+ Add discount'}
                  </button>
                ) : null}
              </div>
              {open && (
                <DeptDiscountForm
                  pending={pending}
                  lineSubtotal={dept.lineSubtotal}
                  onSubmit={({ type, value, label }) => post({
                    scope: 'DEPARTMENT', departmentKey: dept.department, type, value, label,
                  })}
                />
              )}
            </div>
          )
        })}
      </div>

      {/* ── Order-scope ──────────────────────────────────────── */}
      <div className="mt-4 pt-3 border-t border-lt-hairline/60 text-sm">
        <div className="flex items-center justify-between py-1">
          <span className="text-lt-fg font-medium">Order discount</span>
          {existingOrderDiscount ? (
            <div className="flex items-center gap-2 text-xs">
              <span className="text-chip-bad-fg font-mono">
                −{fmt(data.breakdown.orderDiscount)} ({existingOrderDiscount.type === 'PERCENT' ? `${existingOrderDiscount.value}%` : fmt(existingOrderDiscount.value)})
              </span>
              {existingOrderDiscount.label && existingOrderDiscount.label !== 'Discount' && (
                <span className="text-lt-fg3 italic">"{existingOrderDiscount.label}"</span>
              )}
              {isEditable && (
                <button
                  onClick={() => remove(existingOrderDiscount.id)}
                  disabled={pending}
                  className="text-lt-fg3 hover:text-chip-bad-fg ml-1"
                >
                  Remove
                </button>
              )}
            </div>
          ) : isEditable ? (
            <button
              onClick={() => setAddingOrder(v => !v)}
              className="text-xs text-lt-fg2 hover:text-lt-fg"
            >
              {addingOrder ? 'Cancel' : '+ Add order discount'}
            </button>
          ) : null}
        </div>
        {addingOrder && !existingOrderDiscount && (
          <OrderDiscountForm
            pending={pending}
            discountedSubtotal={data.breakdown.discountedSubtotal}
            taxRate={data.breakdown.taxRate}
            currentTotal={data.breakdown.total}
            onSubmit={(value, type, label) => post({ scope: 'ORDER', type, value, label })}
          />
        )}
      </div>
    </div>
  )
}

// ── Inline form: department discount ─────────────────────────────

function DeptDiscountForm({
  pending, lineSubtotal, onSubmit,
}: {
  pending: boolean
  lineSubtotal: number
  onSubmit: (args: { type: Type; value: number; label: string }) => void
}) {
  const [type, setType] = useState<Type>('PERCENT')
  const [value, setValue] = useState('')
  const [label, setLabel] = useState('')
  const [err, setErr] = useState<string | null>(null)

  const submit = () => {
    const n = Number(value)
    if (!Number.isFinite(n) || n <= 0) { setErr('value must be > 0'); return }
    if (type === 'PERCENT' && n > 100) { setErr('percent ≤ 100'); return }
    if (type === 'FIXED' && n > lineSubtotal) { setErr(`cannot exceed dept subtotal ${fmt(lineSubtotal)}`); return }
    setErr(null)
    onSubmit({ type, value: n, label: label.trim() })
  }

  return (
    <div className="mt-1 mb-2 pl-3 pr-1 py-2 bg-lt-inner/40 rounded text-xs">
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex border border-lt-hairline rounded overflow-hidden">
          <button onClick={() => setType('PERCENT')} className={`px-2 py-1 ${type === 'PERCENT' ? 'bg-lt-fg text-white' : 'bg-lt-card text-lt-fg2'}`}>%</button>
          <button onClick={() => setType('FIXED')} className={`px-2 py-1 ${type === 'FIXED' ? 'bg-lt-fg text-white' : 'bg-lt-card text-lt-fg2'}`}>$</button>
        </div>
        <input
          type="number" step="0.01" min="0"
          value={value} onChange={(e) => setValue(e.target.value)}
          placeholder={type === 'PERCENT' ? '10' : '50.00'}
          className="w-24 px-2 py-1 border border-lt-hairline rounded font-mono"
        />
        <input
          type="text" value={label} onChange={(e) => setLabel(e.target.value)}
          placeholder="Label (optional)"
          className="flex-1 max-w-xs px-2 py-1 border border-lt-hairline rounded"
        />
        <button
          onClick={submit} disabled={pending}
          className="px-3 py-1 bg-lt-fg text-white rounded text-xs disabled:opacity-50"
        >
          {pending ? 'Saving…' : 'Apply'}
        </button>
      </div>
      {err && <div className="mt-1 text-chip-bad-fg">{err}</div>}
    </div>
  )
}

// ── Inline form: order discount with three modes ─────────────────

function OrderDiscountForm({
  pending, discountedSubtotal, taxRate, currentTotal, onSubmit,
}: {
  pending: boolean
  discountedSubtotal: number
  taxRate: number
  currentTotal: number
  onSubmit: (value: number, type: Type, label: string) => void
}) {
  const [mode, setMode] = useState<'PERCENT' | 'FIXED' | 'FLAT'>('PERCENT')
  const [value, setValue] = useState('')
  const [label, setLabel] = useState('')
  const [err, setErr] = useState<string | null>(null)

  // Live preview of the implied FIXED discount in FLAT mode so the
  // user sees the magnitude before they commit.
  const flatPreview = useMemo(() => {
    if (mode !== 'FLAT') return null
    const n = Number(value)
    if (!Number.isFinite(n) || n <= 0) return null
    const preTax = n / (1 + taxRate)
    const implied = Math.round((discountedSubtotal - preTax) * 100) / 100
    return implied
  }, [mode, value, taxRate, discountedSubtotal])

  const submit = () => {
    const n = Number(value)
    if (!Number.isFinite(n) || n <= 0) { setErr('value must be > 0'); return }
    if (mode === 'PERCENT') {
      if (n > 100) { setErr('percent ≤ 100'); return }
      setErr(null)
      onSubmit(n, 'PERCENT', label.trim())
      return
    }
    if (mode === 'FIXED') {
      if (n > discountedSubtotal) { setErr(`cannot exceed discounted subtotal ${fmt(discountedSubtotal)}`); return }
      setErr(null)
      onSubmit(n, 'FIXED', label.trim())
      return
    }
    // FLAT — n is the target grand total
    if (n <= 0) { setErr('target must be > 0'); return }
    if (n >= currentTotal) { setErr(`target must be below current total ${fmt(currentTotal)}`); return }
    if (flatPreview == null || flatPreview <= 0) { setErr('implied discount is zero or negative'); return }
    setErr(null)
    const finalLabel = label.trim() || `Flat ${fmt(n)} total`
    onSubmit(flatPreview, 'FIXED', finalLabel)
  }

  return (
    <div className="mt-1 mb-1 px-3 py-3 bg-lt-inner/40 rounded text-xs space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex border border-lt-hairline rounded overflow-hidden">
          <button onClick={() => setMode('PERCENT')} className={`px-3 py-1 ${mode === 'PERCENT' ? 'bg-lt-fg text-white' : 'bg-lt-card text-lt-fg2'}`}>%</button>
          <button onClick={() => setMode('FIXED')} className={`px-3 py-1 ${mode === 'FIXED' ? 'bg-lt-fg text-white' : 'bg-lt-card text-lt-fg2'}`}>$</button>
          <button onClick={() => setMode('FLAT')} className={`px-3 py-1 ${mode === 'FLAT' ? 'bg-lt-fg text-white' : 'bg-lt-card text-lt-fg2'}`} title="Set the grand total directly; we compute the discount">Flat total</button>
        </div>
        <input
          type="number" step="0.01" min="0"
          value={value} onChange={(e) => setValue(e.target.value)}
          placeholder={mode === 'PERCENT' ? '5' : mode === 'FIXED' ? '100.00' : 'Target total'}
          className="w-32 px-2 py-1 border border-lt-hairline rounded font-mono"
        />
        <input
          type="text" value={label} onChange={(e) => setLabel(e.target.value)}
          placeholder="Label (optional)"
          className="flex-1 max-w-xs px-2 py-1 border border-lt-hairline rounded"
        />
        <button
          onClick={submit} disabled={pending}
          className="px-3 py-1 bg-lt-fg text-white rounded text-xs disabled:opacity-50"
        >
          {pending ? 'Saving…' : 'Apply'}
        </button>
      </div>
      {mode === 'FLAT' && flatPreview != null && flatPreview > 0 && (
        <div className="text-lt-fg2">
          Will store as a FIXED discount of <span className="font-mono text-lt-fg">{fmt(flatPreview)}</span>.
          Not live-pinned — later edits will move the total visibly.
        </div>
      )}
      {err && <div className="text-chip-bad-fg">{err}</div>}
    </div>
  )
}
