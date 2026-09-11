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
import { ChevronRight, Eye, FileCheck2, ShieldCheck, Users } from 'lucide-react'

export type ChipTone = 'good' | 'bad' | 'neutral' | 'warn'

const TONE: Record<ChipTone, string> = {
  good: 'bg-chip-good-bg text-chip-good-fg',
  bad: 'bg-chip-bad-bg text-chip-bad-fg',
  neutral: 'bg-chip-neutral-bg text-chip-neutral-fg',
  warn: 'bg-chip-warn-bg text-chip-warn-fg',
}

export function CompanyPortalRow({
  companyId,
  name,
  hasLogo,
  annual,
  coi,
  coiAwaiting = 0,
  peopleCount,
  uninvited,
  children,
}: {
  companyId: string
  name: string
  hasLogo: boolean
  annual: { tone: ChipTone; label: string }
  coi: { tone: ChipTone; label: string }
  /** Certificates on the account still waiting on an HQ decision (Wes
   *  2026-09-11: "if the COI needs approval why can't i see that?"). */
  coiAwaiting?: number
  peopleCount: number
  uninvited: number
  children: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const [everOpened, setEverOpened] = useState(false)

  return (
    <div className="bg-lt-card border border-lt-hairline rounded-xl">
      {/* The header is a toggle BUTTON plus one sibling link — "See what
          they see" (Wes 2026-09-06) must not nest inside the button, so the
          row is a flex of the two. */}
      <div className="flex items-stretch">
      <button
        type="button"
        onClick={() => {
          setOpen((o) => !o)
          setEverOpened(true)
        }}
        aria-expanded={open}
        className="min-w-0 flex-1 text-left px-3 py-2.5 flex flex-wrap items-center gap-x-3 gap-y-2"
      >
        {/* The arrow is the affordance — a bordered button, not a bare
            glyph, so it reads as "press me" (Wes 2026-09-04). */}
        <span className="inline-flex items-center justify-center w-7 h-7 rounded-md border border-lt-hairline bg-lt-inner shrink-0">
          <ChevronRight
            className={`w-4 h-4 text-lt-fg2 transition-transform ${open ? 'rotate-90' : ''}`}
          />
        </span>

        {/* The wordmark — theirs if filed, else the name in the display face.
            On a phone the chips wrap under it (w-full below sm). */}
        <div className="min-w-0 flex-1 basis-32 flex items-center">
          {hasLogo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={`/api/crm/companies/${companyId}/logo`}
              alt={name}
              className="block h-6 w-auto max-w-[180px] object-contain object-left"
            />
          ) : (
            <span className="font-display text-[16px] leading-none text-lt-fg tracking-tight truncate">
              {name}
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto sm:shrink-0 pl-10 sm:pl-0">
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
          {coiAwaiting > 0 && (
            <span
              className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded ${TONE.warn}`}
              title="Open the row to review"
            >
              <ShieldCheck className="w-3.5 h-3.5" /> {coiAwaiting} COI awaiting approval
            </span>
          )}
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
      <Link
        href={`/crm/portals/preview/company/${companyId}`}
        className="shrink-0 inline-flex items-center gap-1.5 self-center mr-3 text-[11px] font-semibold px-2.5 py-1.5 rounded-md border border-lt-hairline bg-lt-inner text-lt-fg hover:text-black hover:border-lt-fg3"
        title="Open their account portal exactly as they see it — nothing is stamped"
      >
        <Eye className="w-3.5 h-3.5" /> See what they see
      </Link>
      </div>

      {open && (
        <div className="px-3 pb-3 space-y-3 border-t border-lt-hairline pt-3">
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
