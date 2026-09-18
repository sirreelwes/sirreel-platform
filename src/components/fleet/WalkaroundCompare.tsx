'use client'

/**
 * Check-out beside check-in, one angle at a time — the view Hugo asked
 * for (2026-09-17): "scroll through the check out and check in photos
 * side by side to see if there was any damage done to the vehicle."
 *
 * Out is ALWAYS the left frame, back the right, whichever end the
 * viewer was opened from: the question is what changed, and that reads
 * before → after. Prev/next, arrow keys, a filmstrip to jump. Under
 * each frame: when it was taken (lib/fleet/photoStamp — the same
 * wording that gets drawn onto a saved copy) and a Save button, which
 * downloads a stamped copy for a damage report.
 *
 * READ-ONLY like the record page it opens from. The current slot rides
 * in the URL (?slot=) so a link pasted into Slack opens on the panel
 * being argued about.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, ChevronLeft, ChevronRight, Download, ExternalLink } from 'lucide-react'
import type { ComparePair, CompareRecord, CompareSide } from '@/lib/fleet/comparePairs'
import { photoStampWhen, photoStampShort } from '@/lib/fleet/photoStamp'

const src = (id: string) => `/api/fleet/photos/${id}`
const saveHref = (id: string) => `/api/fleet/photos/${id}?download=1`

function fmtWhen(iso: string): string {
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit', timeZone: 'America/Los_Angeles',
  }).format(new Date(iso))
}

export function WalkaroundCompare({
  record,
  start,
  backHref,
}: {
  record: CompareRecord
  start: number
  backHref: string
}) {
  const { pairs } = record
  const [i, setI] = useState(() => Math.min(Math.max(0, start), Math.max(0, pairs.length - 1)))
  const pair: ComparePair | undefined = pairs[i]
  const stripRef = useRef<HTMLDivElement | null>(null)

  const go = useCallback(
    (next: number) => setI(Math.min(Math.max(0, next), pairs.length - 1)),
    [pairs.length],
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      if (e.key === 'ArrowLeft') { e.preventDefault(); go(i - 1) }
      if (e.key === 'ArrowRight') { e.preventDefault(); go(i + 1) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [i, go])

  // The slot in the URL, without a navigation.
  useEffect(() => {
    if (!pair) return
    const url = new URL(window.location.href)
    url.searchParams.set('slot', pair.key)
    window.history.replaceState(window.history.state, '', url.toString())
  }, [pair])

  // The neighbours' frames, warmed so a step does not wait on the blob.
  useEffect(() => {
    const warm = (p?: ComparePair) => {
      for (const s of [p?.out, p?.back]) {
        if (s) { const im = new Image(); im.src = src(s.id) }
      }
    }
    warm(pairs[i + 1])
    warm(pairs[i - 1])
  }, [i, pairs])

  // Keep the filmstrip's current tile in view.
  useEffect(() => {
    const el = stripRef.current?.querySelector<HTMLElement>(`[data-idx="${i}"]`)
    el?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' })
  }, [i])

  if (!pair) {
    return (
      <p className="border border-lt-hairline bg-lt-card rounded-xl px-4 py-8 text-center text-[15px] text-lt-fg3">
        No photographs are filed on either end of this rental.
      </p>
    )
  }

  return (
    <div>
      <Link href={backHref} className="inline-flex items-center gap-1.5 text-[13px] text-lt-fg2 hover:text-lt-fg mb-2">
        <ArrowLeft size={14} aria-hidden /> The walk-around
      </Link>

      <header className="mb-3">
        <div className="text-amber-600 text-[13px] font-semibold uppercase tracking-wide mb-1">Out vs back</div>
        <h1 className="text-lt-fg text-2xl font-bold">
          {record.unitName} <span className="text-lt-fg3 font-normal text-[18px]">· {record.category}</span>
        </h1>
        <p className="text-lt-fg2 text-[15px] mt-0.5">
          {record.jobName ?? 'No booking attached'}
          {record.company ? ` · ${record.company}` : ''}
        </p>
      </header>

      {/* Which angle, and where in the walk. */}
      <div className="flex items-center justify-between gap-3 mb-2">
        <button
          type="button"
          onClick={() => go(i - 1)}
          disabled={i === 0}
          aria-label="Previous angle"
          className="flex-none w-11 h-11 rounded-lg border border-lt-hairline bg-lt-card text-lt-fg2 hover:text-lt-fg disabled:opacity-30 inline-flex items-center justify-center"
        >
          <ChevronLeft size={20} aria-hidden />
        </button>
        <div className="min-w-0 text-center">
          <div className="text-lt-fg text-[18px] font-semibold truncate">{pair.title}</div>
          <div className="text-lt-fg3 text-[13px]">
            {pair.group} · {i + 1} of {pairs.length}
          </div>
        </div>
        <button
          type="button"
          onClick={() => go(i + 1)}
          disabled={i === pairs.length - 1}
          aria-label="Next angle"
          className="flex-none w-11 h-11 rounded-lg border border-lt-hairline bg-lt-card text-lt-fg2 hover:text-lt-fg disabled:opacity-30 inline-flex items-center justify-center"
        >
          <ChevronRight size={20} aria-hidden />
        </button>
      </div>

      {/* Side by side is the point, so two columns at every width. */}
      <div className="grid grid-cols-2 gap-2 mb-3">
        <Pane
          heading="Check-out"
          side={pair.out}
          filed={record.out}
          alt={`${pair.title} at check-out`}
          missing={record.out ? (pair.slot ? 'Not photographed at check-out' : 'Check-out only has its own extras') : 'No check-out filed'}
        />
        <Pane
          heading="Check-in"
          side={pair.back}
          filed={record.back}
          alt={`${pair.title} at check-in`}
          missing={record.back ? (pair.slot ? 'Not photographed at check-in' : 'Check-in only has its own extras') : 'No check-in filed yet'}
        />
      </div>

      {/* The whole walk, to jump. A tile shows the out shot, else the
          back shot, else a blank — a blank tile is "nobody shot this",
          which is worth seeing in the strip. */}
      <div ref={stripRef} className="flex gap-1.5 overflow-x-auto pb-2 -mx-1 px-1 snap-x">
        {pairs.map((p, idx) => {
          const thumb = p.out ?? p.back
          const current = idx === i
          return (
            <button
              key={p.key}
              type="button"
              data-idx={idx}
              onClick={() => go(idx)}
              title={p.title}
              aria-label={`${p.title}${current ? ' (current)' : ''}`}
              className={`flex-none w-20 snap-center rounded-md overflow-hidden border-2 ${
                current ? 'border-amber-600' : 'border-transparent hover:border-lt-hairline'
              }`}
            >
              {thumb ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={src(thumb.id)} alt="" loading="lazy" className="w-20 h-14 object-cover bg-lt-inner" />
              ) : (
                <div className="w-20 h-14 bg-lt-inner" />
              )}
              <span className={`block text-[10px] leading-tight px-0.5 py-0.5 truncate ${current ? 'text-lt-fg font-semibold' : 'text-lt-fg3'}`}>
                {p.title}
              </span>
            </button>
          )
        })}
      </div>

      <p className="text-lt-fg3 text-[12px] mt-1">
        ← → arrow keys step through the walk. Save gives a copy with the date and time printed on it.
      </p>
    </div>
  )
}

function Pane({
  heading,
  side,
  filed,
  alt,
  missing,
}: {
  heading: string
  side: CompareSide | null
  filed: CompareRecord['out']
  alt: string
  missing: string
}) {
  return (
    <div className="border border-lt-hairline bg-lt-card rounded-xl overflow-hidden">
      <div className="px-2 py-1.5 border-b border-lt-hairline flex items-baseline justify-between gap-2">
        <span className="text-[12px] uppercase tracking-wide text-lt-fg2 font-semibold">{heading}</span>
        {filed && (
          <span className="text-[11px] text-lt-fg3 truncate" title={fmtWhen(filed.at)}>
            {filed.inspectorName ?? fmtWhen(filed.at)}
          </span>
        )}
      </div>
      {/* Opaque dark box: the photo is letterboxed inside it, so the
          whole frame shows rather than a crop that could hide the dent. */}
      <div className="bg-zinc-900 aspect-[4/3] flex items-center justify-center">
        {side ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src(side.id)} alt={alt} className="max-w-full max-h-full object-contain" />
        ) : (
          <span className="text-zinc-400 text-[13px] text-center px-3">{missing}</span>
        )}
      </div>
      <div className="px-2 py-1.5 flex items-center justify-between gap-2 min-h-[38px]">
        <span className="text-[12px] text-lt-fg2 tabular-nums truncate">
          {side ? (
            <>
              <span className="sm:hidden">{photoStampShort(new Date(side.takenAt))}</span>
              <span className="hidden sm:inline">{photoStampWhen(new Date(side.takenAt))}</span>
            </>
          ) : (
            '—'
          )}
        </span>
        {side && (
          <span className="flex-none inline-flex items-center gap-1">
            <a
              href={src(side.id)}
              target="_blank"
              rel="noreferrer"
              aria-label="Open full size"
              className="text-lt-fg3 hover:text-lt-fg p-1"
            >
              <ExternalLink size={14} aria-hidden />
            </a>
            <a
              href={saveHref(side.id)}
              download
              className="inline-flex items-center gap-1 text-[12px] font-semibold text-lt-fg2 hover:text-lt-fg border border-lt-hairline rounded-md px-2 py-1"
            >
              <Download size={13} aria-hidden /> Save
            </a>
          </span>
        )}
      </div>
    </div>
  )
}
