'use client'

/**
 * "+ New" quick-create dropdown wired into the dashboard top bar.
 *
 * Two entries (New Inquiry / New Quote were removed as redundant — those
 * flows stay reachable via InquiriesSection / the /orders/new-quote route):
 *
 *   - New Reservation → reveals the category picker (same UX as the
 *                       gantt's "+ New Hold" header button), then opens
 *                       <NewHoldModal>. On an /orders/[id] or /jobs/[id]
 *                       page the saved entity's job + company + dates are
 *                       pre-seeded so the hold lands attached in one motion.
 *   - New Task        → opens <NewTaskModal> in standalone mode (no order):
 *                       a delivery/pickup DispatchTask created via
 *                       POST /api/scheduling/dispatch-tasks (orderId null).
 *                       Lands PENDING and shows in the gantt needs-assignment
 *                       lane by date. Gated on canCreateBooking (sales).
 *
 * NewHoldModal write-path is untouched (POST /api/scheduling/holds).
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { useSession } from 'next-auth/react'
import type { UserRole } from '@prisma/client'
import { getPermissions } from '@/lib/permissions'
import { NewHoldModal } from '@/components/scheduling/NewHoldModal'
import { NewTaskModal } from '@/components/scheduling/NewTaskModal'

interface Category {
  id: string
  name: string
  slug: string
}

interface HoldContext {
  jobId: string | null
  jobCode: string | null
  jobName: string | null
  companyId: string | null
  companyName: string | null
  startDate: string | null
  endDate: string | null
  /** Order-derived shortlist of category+dates+qty combos. Populated
   *  only when context is /orders/[id] and at least one line item has
   *  an assetCategoryId. One row per distinct (category, dates, qty)
   *  combo. The QuickCreate flow uses this to skip the full category
   *  picker when the order already implies the categories to hold. */
  orderShortlist: OrderShortlistItem[]
}

interface OrderShortlistItem {
  categoryId: string
  categoryName: string
  pickupDate: string
  returnDate: string
  quantity: number
}

const EMPTY_CONTEXT: HoldContext = {
  jobId: null,
  jobCode: null,
  jobName: null,
  companyId: null,
  companyName: null,
  startDate: null,
  endDate: null,
  orderShortlist: [],
}

function toYMD(d: string | Date | null | undefined): string | null {
  if (!d) return null
  if (typeof d === 'string') return d.slice(0, 10)
  return d.toISOString().slice(0, 10)
}

export function QuickCreateMenu() {
  const router = useRouter()
  const pathname = usePathname()
  const wrapperRef = useRef<HTMLDivElement>(null)
  // Sales gate for "New Task" (delivery/pickup) — same perm as order-nudge
  // task creation. Hidden for non-sales; the endpoint also enforces it.
  const { data: session } = useSession()
  const sessionRole = (session?.user as { role?: UserRole } | undefined)?.role ?? null
  const sessionSalesOnly = (session?.user as { salesOnly?: boolean } | undefined)?.salesOnly ?? false
  const canCreate = sessionRole
    ? getPermissions({ role: sessionRole, salesOnly: sessionSalesOnly }).canCreateBooking
    : false

  const [menuOpen, setMenuOpen] = useState(false)
  const [categories, setCategories] = useState<Category[]>([])
  const [pickingCategory, setPickingCategory] = useState<false | 'full' | 'shortlist'>(false)
  const [holdModal, setHoldModal] = useState<null | {
    category: Category
    context: HoldContext
    shortlistItem?: OrderShortlistItem
  }>(null)
  const [taskOpen, setTaskOpen] = useState(false)
  const [context, setContext] = useState<HoldContext>(EMPTY_CONTEXT)

  // Click-outside collapses the menu + category picker.
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!wrapperRef.current) return
      if (!wrapperRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
        setPickingCategory(false)
      }
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  // Lazy-load categories once — small endpoint, used by both the
  // gantt and this menu.
  useEffect(() => {
    if (categories.length > 0) return
    fetch('/api/scheduling/categories')
      .then((r) => r.json())
      .then((d) => {
        if (d.ok) setCategories(d.categories || [])
      })
      .catch(() => {})
  }, [categories.length])

  // Derive Hold context from the current route. Refreshes on every
  // navigation. Skips the new-quote pre-save page (page-local state
  // isn't server-addressable yet) and the /jobs list page.
  useEffect(() => {
    let cancelled = false
    const orderMatch = pathname.match(/^\/orders\/([^/]+)/)
    const jobMatch = pathname.match(/^\/jobs\/([^/]+)/)

    const orderId = orderMatch && orderMatch[1] !== 'new-quote' && orderMatch[1] !== 'new' ? orderMatch[1] : null
    const jobId = jobMatch && jobMatch[1] !== 'new' ? jobMatch[1] : null

    if (!orderId && !jobId) {
      setContext(EMPTY_CONTEXT)
      return
    }

    if (orderId) {
      fetch(`/api/orders/${orderId}`)
        .then((r) => r.json())
        .then((o) => {
          if (cancelled || !o?.id) return
          // Derive the order's category shortlist from line items.
          // Filter: type=VEHICLE OR assetCategoryId present (per brief
          // — vehicles are the typical hold target; some EQUIPMENT
          // line items also bind to AssetCategory via assetCategoryId
          // and should be included). De-dupe by (categoryId, dates,
          // qty) so two identical lines collapse to one shortlist row.
          type RawLine = {
            type: string
            assetCategoryId: string | null
            assetCategory: { id: string; name: string } | null
            pickupDate: string | null
            returnDate: string | null
            quantity: number
          }
          const rawLines: RawLine[] = Array.isArray(o.lineItems) ? o.lineItems : []
          const dedupe = new Map<string, OrderShortlistItem>()
          for (const li of rawLines) {
            if (!li.assetCategory || !li.assetCategoryId) continue
            const pickup = toYMD(li.pickupDate) || toYMD(o.startDate) || ''
            const ret = toYMD(li.returnDate) || toYMD(o.endDate) || pickup
            if (!pickup) continue
            const key = `${li.assetCategoryId}|${pickup}|${ret}|${li.quantity || 1}`
            if (dedupe.has(key)) continue
            dedupe.set(key, {
              categoryId: li.assetCategoryId,
              categoryName: li.assetCategory.name,
              pickupDate: pickup,
              returnDate: ret,
              quantity: Math.max(1, Math.floor(li.quantity || 1)),
            })
          }
          setContext({
            jobId: o.jobId ?? null,
            jobCode: o.job?.jobCode ?? null,
            jobName: o.job?.name ?? null,
            companyId: o.companyId ?? o.company?.id ?? null,
            companyName: o.company?.name ?? null,
            startDate: toYMD(o.startDate),
            endDate: toYMD(o.endDate),
            orderShortlist: [...dedupe.values()],
          })
        })
        .catch(() => {})
    } else if (jobId) {
      fetch(`/api/jobs/${jobId}`)
        .then((r) => r.json())
        .then((d) => {
          if (cancelled || !d?.job?.id) return
          const j = d.job
          setContext({
            jobId: j.id,
            jobCode: j.jobCode,
            jobName: j.name,
            companyId: j.companyId ?? j.company?.id ?? null,
            companyName: j.company?.name ?? null,
            startDate: toYMD(j.startDate),
            endDate: toYMD(j.endDate),
            orderShortlist: [],
          })
        })
        .catch(() => {})
    }
    return () => {
      cancelled = true
    }
  }, [pathname])

  const onPickNewHold = useCallback(() => {
    setMenuOpen(false)
    // Order-context shortcut: skip the category picker entirely when
    // the order already implies exactly one hold candidate. Multiple
    // candidates → scoped shortlist. Zero → full picker.
    const shortlist = context.orderShortlist
    if (shortlist.length === 1) {
      const sl = shortlist[0]
      setHoldModal({
        category: { id: sl.categoryId, name: sl.categoryName, slug: '' },
        context,
        shortlistItem: sl,
      })
      return
    }
    if (shortlist.length > 1) {
      setPickingCategory('shortlist')
      return
    }
    setPickingCategory('full')
  }, [context])

  const onPickCategory = useCallback(
    (cat: Category) => {
      setPickingCategory(false)
      setHoldModal({ category: cat, context })
    },
    [context],
  )

  const onPickShortlistItem = useCallback(
    (sl: OrderShortlistItem) => {
      setPickingCategory(false)
      setHoldModal({
        category: { id: sl.categoryId, name: sl.categoryName, slug: '' },
        context,
        shortlistItem: sl,
      })
    },
    [context],
  )

  const onPickNewTask = useCallback(() => {
    setMenuOpen(false)
    setTaskOpen(true)
  }, [])

  // Default the hold window. Priority:
  //   1. The picked shortlist item's per-line dates (most specific).
  //   2. The order/job context's overall window.
  //   3. Today → today (single-day fallback).
  const holdStart =
    holdModal?.shortlistItem?.pickupDate ||
    holdModal?.context.startDate ||
    new Date().toISOString().slice(0, 10)
  const holdEnd =
    holdModal?.shortlistItem?.returnDate ||
    holdModal?.context.endDate ||
    holdStart
  const holdDefaultQuantity = holdModal?.shortlistItem?.quantity

  const holdDefaultJob =
    holdModal?.context.jobId &&
    holdModal.context.jobCode &&
    holdModal.context.jobName &&
    holdModal.context.companyId &&
    holdModal.context.companyName
      ? {
          id: holdModal.context.jobId,
          jobCode: holdModal.context.jobCode,
          name: holdModal.context.jobName,
          companyId: holdModal.context.companyId,
          companyName: holdModal.context.companyName,
        }
      : undefined

  const holdDefaultCompany =
    !holdDefaultJob && holdModal?.context.companyId && holdModal.context.companyName
      ? { id: holdModal.context.companyId, name: holdModal.context.companyName }
      : undefined

  // Both entries (New Reservation, New Task) are sales-only creates
  // (canCreateBooking). Fleet/warehouse get NO "+ New" button at all — not a
  // dead/empty menu. The holds + dispatch-tasks endpoints enforce the same gate.
  if (!canCreate) return null

  return (
    <div className="relative" ref={wrapperRef}>
      <button
        type="button"
        onClick={() => setMenuOpen((v) => !v)}
        className="bg-zinc-900 hover:bg-zinc-800 text-white text-[12px] font-semibold px-3 py-1.5 rounded-lg inline-flex items-center gap-1.5"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
      >
        <span className="text-base leading-none">+</span>
        <span>New</span>
      </button>

      {menuOpen && !pickingCategory && (
        <div
          role="menu"
          className="absolute right-0 top-full mt-1 z-40 bg-white border border-gray-200 rounded-lg shadow-lg w-56 overflow-hidden"
        >
          <button
            type="button"
            onClick={onPickNewHold}
            className="w-full text-left px-3 py-2 text-[13px] hover:bg-gray-50 flex flex-col gap-0.5"
          >
            <span className="font-semibold text-gray-900">New Reservation</span>
            <span className="text-[11px] text-gray-500">
              {context.jobCode ? `for ${context.jobCode}` : 'pick category'}
            </span>
          </button>
          {canCreate && (
            <button
              type="button"
              onClick={onPickNewTask}
              className="w-full text-left px-3 py-2 text-[13px] hover:bg-gray-50 border-t border-gray-100 flex flex-col gap-0.5"
            >
              <span className="font-semibold text-gray-900">New Task</span>
              <span className="text-[11px] text-gray-500">delivery / pickup</span>
            </button>
          )}
        </div>
      )}

      {pickingCategory === 'full' && (
        <div
          role="menu"
          className="absolute right-0 top-full mt-1 z-40 bg-white border border-gray-200 rounded-lg shadow-lg w-64 max-h-80 overflow-auto"
        >
          <div className="px-3 py-2 text-[10px] uppercase tracking-wide text-gray-400 border-b border-gray-100 flex items-center justify-between">
            Pick a category
            <button onClick={() => setPickingCategory(false)} className="text-gray-400 hover:text-gray-700 text-base leading-none">×</button>
          </div>
          {categories.length === 0 ? (
            <div className="px-3 py-3 text-xs text-gray-500">Loading…</div>
          ) : (
            categories.map((c) => (
              <button
                key={c.id}
                onClick={() => onPickCategory(c)}
                className="block w-full text-left px-3 py-1.5 text-[12px] hover:bg-gray-50"
              >
                {c.name}
              </button>
            ))
          )}
        </div>
      )}

      {pickingCategory === 'shortlist' && (
        <div
          role="menu"
          className="absolute right-0 top-full mt-1 z-40 bg-white border border-gray-200 rounded-lg shadow-lg w-72 max-h-80 overflow-auto"
        >
          <div className="px-3 py-2 text-[10px] uppercase tracking-wide text-gray-400 border-b border-gray-100 flex items-center justify-between">
            From this order
            <button onClick={() => setPickingCategory(false)} className="text-gray-400 hover:text-gray-700 text-base leading-none">×</button>
          </div>
          {context.orderShortlist.map((sl, idx) => (
            <button
              key={`${sl.categoryId}-${sl.pickupDate}-${sl.returnDate}-${sl.quantity}-${idx}`}
              onClick={() => onPickShortlistItem(sl)}
              className="w-full text-left px-3 py-2 hover:bg-gray-50 border-b border-gray-50 last:border-0"
            >
              <div className="text-[12px] font-semibold text-gray-900">
                {sl.categoryName}{' '}
                <span className="font-normal text-gray-500">× {sl.quantity}</span>
              </div>
              <div className="text-[10px] text-gray-500 mt-0.5">
                {sl.pickupDate} → {sl.returnDate}
              </div>
            </button>
          ))}
          <button
            onClick={() => setPickingCategory('full')}
            className="w-full text-left px-3 py-1.5 text-[11px] text-gray-500 hover:bg-gray-50 border-t border-gray-100"
          >
            Or pick any category…
          </button>
        </div>
      )}

      {holdModal && (
        <NewHoldModal
          categoryId={holdModal.category.id}
          categoryName={holdModal.category.name}
          startDate={holdStart}
          endDate={holdEnd}
          bufferDays={1}
          defaultJob={holdDefaultJob}
          defaultCompany={holdDefaultCompany}
          defaultQuantity={holdDefaultQuantity}
          onClose={() => setHoldModal(null)}
          onCreated={() => setHoldModal(null)}
        />
      )}

      {taskOpen && (
        <NewTaskModal
          onClose={() => setTaskOpen(false)}
          onCreated={() => {
            setTaskOpen(false)
            // Surface the new PENDING task in the reservations needs-assignment lane.
            router.push('/gantt')
          }}
        />
      )}
    </div>
  )
}
