'use client'

/**
 * One client on /crm/portals — collapsed to a wordmark and a few facts,
 * opens to the full rates + access panels.
 *
 * Wes 2026-09-04: "make each one start collapsed with basically a word
 * mark and a couple of icons 'Annual Agreement' (green showing on file)
 * 'COI' (maybe red if expired) and then drop down to open and inspect."
 *
 * The panels are mounted only after the first open: they each fetch on
 * mount, and a page of twenty collapsed clients should not fire forty
 * requests for panels nobody has looked at.
 */

import { useState, type ReactNode } from 'react'
import Link from 'next/link'
import { ChevronRight, FileCheck2, ShieldCheck, Users } from 'lucide-react'

export type ChipTone = 'good' | 'bad' | 'neutral'

const TONE: Record<ChipTone, string> = {
  good: 'bg-chip-good-bg text-chip-good-fg',
  bad: 'bg-chip-bad-bg text-chip-bad-fg',
  neutral: 'bg-chip-neutral-bg text-chip-neutral-fg',
}

export function CompanyPortalRow({
  companyId,
  name,
  hasLogo,
  annual,
  coi,
  peopleCount,
  uninvited,
  children,
}: {
  companyId: string
  name: string
  hasLogo: boolean
  annual: { tone: ChipTone; label: string }
  coi: { tone: ChipTone; label: string }
  peopleCount: number
  uninvited: number
  children: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const [everOpened, setEverOpened] = useState(false)

  return (
    <div className="bg-lt-card border border-lt-hairline rounded-xl">
      <button
        type="button"
        onClick={() => {
          setOpen((o) => !o)
          setEverOpened(true)
        }}
        aria-expanded={open}
        className="w-full text-left p-4 flex items-center gap-4"
      >
        <ChevronRight
          className={`w-4 h-4 text-lt-fg3 shrink-0 transition-transform ${open ? 'rotate-90' : ''}`}
        />

        {/* The wordmark — theirs if filed, else the name in the display face. */}
        <div className="min-w-0 flex-1 flex items-center">
          {hasLogo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={`/api/crm/companies/${companyId}/logo`}
              alt={name}
              className="block h-7 w-auto max-w-[200px] object-contain object-left"
            />
          ) : (
            <span className="font-display text-[18px] leading-none text-lt-fg tracking-tight truncate">
              {name}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <span
            className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded ${TONE[annual.tone]}`}
            title="Annual agreement"
          >
            <FileCheck2 className="w-3.5 h-3.5" /> {annual.label}
          </span>
          <span
            className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded ${TONE[coi.tone]}`}
            title="Certificate of insurance"
          >
            <ShieldCheck className="w-3.5 h-3.5" /> {coi.label}
          </span>
          <span
            className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded ${
              uninvited > 0 ? TONE.neutral : TONE.good
            }`}
            title={uninvited > 0 ? `${uninvited} not yet invited` : 'Everyone invited'}
          >
            <Users className="w-3.5 h-3.5" /> {peopleCount}
            {uninvited > 0 ? ` · ${uninvited} to invite` : ''}
          </span>
        </div>
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-4 border-t border-lt-hairline pt-4">
          <div className="flex justify-end -mb-2">
            <Link href={`/crm/${companyId}`} className="text-xs text-lt-fg2 hover:text-lt-fg underline">
              Open company page →
            </Link>
          </div>
          {everOpened && children}
        </div>
      )}
    </div>
  )
}
