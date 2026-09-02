'use client'

/**
 * "+ Add asset" on the job page's Reserved assets panel (Wes 2026-08-31:
 * "we need to be able to add assets on this page").
 *
 * The header's "+ New reservation" (JobQuickActions) already carried this
 * flow, but a rep looking at an empty Reserved-assets panel reads the
 * panel, not the header — so the panel gets its own entry point. Same
 * flow, same write path: category picker → <NewHoldModal> pre-seeded to
 * this Job → POST /api/scheduling/holds (with the modal's optional
 * assign-units step after). Sales-gated like the endpoint.
 */

import { useEffect, useRef, useState } from 'react'
import { useSession } from 'next-auth/react'
import type { UserRole } from '@prisma/client'
import { getPermissions } from '@/lib/permissions'
import { NewHoldModal } from '@/components/scheduling/NewHoldModal'

interface Category {
  id: string
  name: string
  slug: string
}

export function AddAssetButton({
  job,
  onCreated,
}: {
  job: {
    id: string
    jobCode: string
    name: string
    company: { id: string; name: string }
    startDate: string | null
    endDate: string | null
  }
  /** Called after a hold lands so the page can refetch. */
  onCreated: () => void
}) {
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

  if (!canCreateBooking) return null

  const today = new Date().toISOString().slice(0, 10)
  const holdStart = job.startDate?.slice(0, 10) || today
  const holdEnd = job.endDate?.slice(0, 10) || holdStart

  return (
    <div className="relative" ref={wrapperRef}>
      <button
        onClick={() => setPickingCategory((v) => !v)}
        className="px-2.5 py-1 bg-zinc-100 hover:bg-zinc-200 border border-zinc-300 text-zinc-900 rounded-lg text-[11px] font-semibold"
        title="Hold fleet units for this job — pick a category, the hold lands attached to this Job"
      >
        + Add asset
      </button>

      {pickingCategory && (
        <div className="absolute right-0 top-full mt-1 z-40 bg-white border border-zinc-300 rounded-lg shadow-xl w-64 max-h-80 overflow-auto">
          <div className="px-3 py-2 text-[10px] uppercase tracking-wide text-zinc-600 border-b border-zinc-200 flex items-center justify-between">
            Pick a category
            <button onClick={() => setPickingCategory(false)} className="text-zinc-600 hover:text-zinc-900 text-base leading-none">×</button>
          </div>
          {categories.length === 0 ? (
            <div className="px-3 py-3 text-xs text-zinc-600">Loading…</div>
          ) : (
            categories.map((c) => (
              <button
                key={c.id}
                onClick={() => {
                  setPickingCategory(false)
                  setHoldCategory(c)
                }}
                className="block w-full text-left px-3 py-1.5 text-[12px] text-zinc-800 hover:bg-zinc-100"
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
            onCreated()
          }}
        />
      )}
    </div>
  )
}
