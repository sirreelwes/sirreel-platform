'use client'

/**
 * /admin/paperwork — paperwork tools picker.
 *
 * Phase 7 consolidation. Three pre-existing tools (COI Check,
 * Contract Review, Contract History) collapsed under one nav entry.
 * Each card links to its existing route — pages themselves are
 * untouched.
 *
 * If/when these become tabs of one shared layout, the routes can
 * collapse without changing this page (it just becomes the parent
 * with three tab links). For now: three cards, three destinations.
 */

import Link from 'next/link'

const TOOLS = [
  {
    href: '/tools/coi-check',
    title: 'COI Check',
    description:
      'Upload a Certificate of Insurance — AI reads coverage, expiry, additional-insured. One-off review.',
  },
  {
    href: '/tools/contract-review',
    title: 'Contract Review',
    description:
      'Upload a client redline — AI compares against the SirReel baseline and flags every change with a recommended response.',
  },
  {
    href: '/admin/contract-review/history',
    title: 'Contract Review History',
    description:
      'Past contract reviews — search, re-open a previous AI run, see per-clause decisions.',
  },
  {
    href: '/admin/negotiated-agreements',
    title: 'Negotiated Agreements',
    description:
      'Every client with a recorded standing agreement — established date, review-due, summary, and the PDF in use on new orders.',
  },
]

export default function PaperworkToolsIndex() {
  return (
    <div className="p-6 max-w-5xl mx-auto">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">Paperwork tools</h1>
        <p className="text-sm text-gray-500 mt-1">
          One-off AI surfaces for client paperwork — pick a tool to open it.
        </p>
      </header>

      <div className="grid gap-4 md:grid-cols-2">
        {TOOLS.map((t) => (
          <Link
            key={t.href}
            href={t.href}
            className="block rounded-xl border border-gray-200 bg-white hover:border-gray-400 transition-colors px-5 py-4"
          >
            <div className="text-base font-semibold text-gray-900">{t.title} →</div>
            <p className="text-[13px] text-gray-600 mt-1.5 leading-relaxed">{t.description}</p>
          </Link>
        ))}
      </div>
    </div>
  )
}
