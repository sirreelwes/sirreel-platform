'use client'

/**
 * In-Job creation actions (canonical-Job consolidation, 2026-07-15).
 * The user path is: create Job (global "+ New Job") → open it → add a
 * quote or reservation HERE, with the Job already decided:
 *
 *   - "+ New quote"       → /orders/new-quote?jobId=… (the page's
 *                           JobPicker opens pre-seeded to this Job).
 *   - "+ New reservation" → category picker → <NewHoldModal> with
 *                           defaultJob pre-seeded (the modal's JobPicker
 *                           opens bound to this Job). Same write path as
 *                           the gantt: POST /api/scheduling/holds.
 *
 * The reservation button is sales-gated (canCreateBooking), mirroring
 * the holds endpoint — same rule the retired top-bar "+ New" menu used.
 */

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useSession } from 'next-auth/react'
import type { UserRole } from '@prisma/client'
import { getPermissions } from '@/lib/permissions'
import { NewHoldModal } from '@/components/scheduling/NewHoldModal'

interface Category {
  id: string
  name: string
  slug: string
}

export function JobQuickActions({
  job,
}: {
  job: {
    id: string
    jobCode: string
    name: string
    company: { id: string; name: string }
    startDate: string | null
    endDate: string | null
  }
}) {
  const router = useRouter()
  const wrapperRef = useRef<HTMLDivElement>(null)
  const { data: session } = useSession()
  const sessionRole = (session?.user as { role?: UserRole } | undefined)?.role ?? null
  const sessionSalesOnly = (session?.user as { salesOnly?: boolean } | undefined)?.salesOnly ?? false
  const canCreateBooking = sessionRole
    ? getPermissions({ role: sessionRole, salesOnly: sessionSalesOnly }).canCreateBooking
    : false

  const [categories, setCategories] = useState<Category[]>([])
  const [pickingCategory, setPickingCategory] = useState(false)
  const [holdCategory, setHoldCategory] = useState<Category | null>(null)

  useEffect(() => {
    if (!pickingCategory || categories.length > 0) return
    fetch('/api/scheduling/categories')
      .then((r) => r.json())
      .then((d) => {
        if (d.ok) setCategories(d.categories || [])
      })
      .catch(() => {})
  }, [pickingCategory, categories.length])

  // Click-outside collapses the category picker.
  useEffect(() => {
    if (!pickingCategory) return
    const onDoc = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setPickingCategory(false)
      }
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [pickingCategory])

  const today = new Date().toISOString().slice(0, 10)
  const holdStart = job.startDate?.slice(0, 10) || today
  const holdEnd = job.endDate?.slice(0, 10) || holdStart

  return (
    <div className="relative flex items-center gap-2" ref={wrapperRef}>
      <button
        onClick={() => router.push(`/orders/new-quote?jobId=${job.id}`)}
        className="px-3 py-1.5 bg-amber-600 hover:bg-amber-500 text-white rounded-lg text-xs font-semibold"
        title="Draft a quote on this job — the quote page opens with the Job pre-selected"
      >
        + New quote
      </button>
      {canCreateBooking && (
        <button
          onClick={() => setPickingCategory((v) => !v)}
          className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-white rounded-lg text-xs font-semibold"
          title="Hold fleet units for this job — pick a category, the hold lands attached to this Job"
        >
          + New reservation
        </button>
      )}

      {pickingCategory && (
        <div className="absolute right-0 top-full mt-1 z-40 bg-zinc-900 border border-zinc-700 rounded-lg shadow-xl w-64 max-h-80 overflow-auto">
          <div className="px-3 py-2 text-[10px] uppercase tracking-wide text-zinc-500 border-b border-zinc-800 flex items-center justify-between">
            Pick a category
            <button onClick={() => setPickingCategory(false)} className="text-zinc-500 hover:text-white text-base leading-none">×</button>
          </div>
          {categories.length === 0 ? (
            <div className="px-3 py-3 text-xs text-zinc-500">Loading…</div>
          ) : (
            categories.map((c) => (
              <button
                key={c.id}
                onClick={() => {
                  setPickingCategory(false)
                  setHoldCategory(c)
                }}
                className="block w-full text-left px-3 py-1.5 text-[12px] text-zinc-200 hover:bg-zinc-800"
              >
                {c.name}
              </button>
            ))
          )}
        </div>
      )}

      {holdCategory && (
        <NewHoldModal
          categoryId={holdCategory.id}
          categoryName={holdCategory.name}
          startDate={holdStart}
          endDate={holdEnd}
          bufferDays={1}
          defaultJob={{
            id: job.id,
            jobCode: job.jobCode,
            name: job.name,
            companyId: job.company.id,
            companyName: job.company.name,
          }}
          onClose={() => setHoldCategory(null)}
          onCreated={() => {
            setHoldCategory(null)
            router.refresh()
          }}
        />
      )}
    </div>
  )
}
