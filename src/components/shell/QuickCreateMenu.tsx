'use client'

/**
 * "+ New" quick-create dropdown wired into the dashboard top bar.
 *
 * Three entries, all wiring to existing flows — no new modal logic,
 * no scheduler write-path changes:
 *
 *   - New Hold     → reveals the category picker (same UX as the
 *                    gantt's "+ New Hold" header button), then opens
 *                    <NewHoldModal>. When the agent is on an
 *                    /orders/[id] or /jobs/[id] page, the saved
 *                    entity's job + company + dates are pre-seeded
 *                    so the hold lands attached to that job in one
 *                    motion. On /orders/new-quote (pre-save) we just
 *                    open blank — the page's draft state isn't
 *                    addressable server-side yet.
 *   - New Inquiry  → opens the existing <NewInquiryModal> (manual
 *                    capture form already used by InquiriesSection).
 *   - New Quote    → navigates to /orders/new-quote (the AI-parse
 *                    builder).
 *
 * NewHoldModal write-path is untouched: it still calls
 * POST /api/scheduling/holds with the same payload shape. This file
 * adds an entry point, nothing else.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { NewHoldModal } from '@/components/scheduling/NewHoldModal'
import { NewInquiryModal } from '@/components/sales/NewInquiryModal'

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
}

const EMPTY_CONTEXT: HoldContext = {
  jobId: null,
  jobCode: null,
  jobName: null,
  companyId: null,
  companyName: null,
  startDate: null,
  endDate: null,
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

  const [menuOpen, setMenuOpen] = useState(false)
  const [categories, setCategories] = useState<Category[]>([])
  const [pickingCategory, setPickingCategory] = useState(false)
  const [holdModal, setHoldModal] = useState<null | {
    category: Category
    context: HoldContext
  }>(null)
  const [inquiryOpen, setInquiryOpen] = useState(false)
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
          setContext({
            jobId: o.jobId ?? null,
            jobCode: o.job?.jobCode ?? null,
            jobName: o.job?.name ?? null,
            companyId: o.companyId ?? o.company?.id ?? null,
            companyName: o.company?.name ?? null,
            startDate: toYMD(o.startDate),
            endDate: toYMD(o.endDate),
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
    setPickingCategory(true)
  }, [])

  const onPickCategory = useCallback(
    (cat: Category) => {
      setPickingCategory(false)
      setHoldModal({ category: cat, context })
    },
    [context],
  )

  const onPickNewInquiry = useCallback(() => {
    setMenuOpen(false)
    setInquiryOpen(true)
  }, [])

  const onPickNewQuote = useCallback(() => {
    setMenuOpen(false)
    router.push('/orders/new-quote')
  }, [router])

  // Default the hold window. If context has dates → use them. Else
  // today → today (single-day hold, agent can extend in modal).
  const holdStart = holdModal?.context.startDate || new Date().toISOString().slice(0, 10)
  const holdEnd = holdModal?.context.endDate || holdStart

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
            <span className="font-semibold text-gray-900">New Hold</span>
            <span className="text-[11px] text-gray-500">
              {context.jobCode ? `for ${context.jobCode}` : 'pick category'}
            </span>
          </button>
          <button
            type="button"
            onClick={onPickNewInquiry}
            className="w-full text-left px-3 py-2 text-[13px] hover:bg-gray-50 border-t border-gray-100 flex flex-col gap-0.5"
          >
            <span className="font-semibold text-gray-900">New Inquiry</span>
            <span className="text-[11px] text-gray-500">manual capture form</span>
          </button>
          <button
            type="button"
            onClick={onPickNewQuote}
            className="w-full text-left px-3 py-2 text-[13px] hover:bg-gray-50 border-t border-gray-100 flex flex-col gap-0.5"
          >
            <span className="font-semibold text-gray-900">New Quote</span>
            <span className="text-[11px] text-gray-500">paste email → AI parse</span>
          </button>
        </div>
      )}

      {pickingCategory && (
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

      {holdModal && (
        <NewHoldModal
          categoryId={holdModal.category.id}
          categoryName={holdModal.category.name}
          startDate={holdStart}
          endDate={holdEnd}
          bufferDays={1}
          defaultJob={holdDefaultJob}
          defaultCompany={holdDefaultCompany}
          onClose={() => setHoldModal(null)}
          onCreated={() => setHoldModal(null)}
        />
      )}

      <NewInquiryModal
        open={inquiryOpen}
        onClose={() => setInquiryOpen(false)}
        onCreated={(inquiryId) => {
          setInquiryOpen(false)
          if (inquiryId) router.push(`/inquiries/${inquiryId}`)
        }}
      />
    </div>
  )
}
