'use client'

/**
 * The check in/out report — a paper pull sheet, typed in.
 *
 * The whole design follows from what the person doing this is actually
 * holding: a marked-up sheet, a pen, and forty lines of which two are
 * wrong. So:
 *
 *   - Every line arrives pre-filled with what the order says. Doing
 *     nothing and hitting Submit records "it all went as written",
 *     which is the truth on most days and should take one tap.
 *   - A line only opens its exchange/note fields when its count differs
 *     or the supervisor asks for them. The sheet stays scannable.
 *   - The consequences are stated on screen BEFORE submitting, not
 *     discovered afterwards: a check-out that differs says, in words,
 *     that it will change the order and tell the agent.
 *
 * Hugo, 2026-09-03: "there are last minute exchanges and modifications
 * that will need to be done to the order based on the check out report.
 * This should be done and modify the order and flag back to the sales
 * agent."
 */

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Plus, Trash2, AlertTriangle, Check, Camera, Printer } from 'lucide-react'
import type { ReportDraft, DraftLine, OutBlockedReason } from '@/lib/orders/checkReports'
import {
  classifyCheckLine, countEdit, describeCheckChange, describeStillOut,
} from '@/lib/orders/checkLineChange'
import { UnitScanPanel, LineUnitStrip } from '@/components/reports/UnitScanPanel'
import type { UnitScanSummary } from '@/lib/warehouse/unitScanRules'

/**
 * What to tell the supervisor when a complete outbound sheet did not put
 * the order out. Each line names the next step, because "still Booked"
 * on its own is what sent Jose hunting for a button that wasn't there.
 *
 * The two fleet sentences deliberately do not offer to settle the lane
 * from this screen — a truck leaves through the driver check-out and its
 * walk-around, and a typed sheet is not a stand-in for that.
 */
const OUT_BLOCKED_MESSAGE: Record<OutBlockedReason, string> = {
  'prep-for-a-later-day':
    'The gear is marked loaded. This sheet is for a later day, so the job stays as it is until the pickup day itself.',
  'not-booked':
    'The gear is marked loaded, but the order is still a quote — sales has to book it before the job can read On rental.',
  'fleet-no-vehicle-assigned':
    'There is a vehicle on this order and no truck that reaches it — either none is assigned, or the one holding it is not linked to this order. Dispatch needs to sort that before a check-out can count.',
  'fleet-vehicle-not-checked-out':
    'The gear side is done. The truck still has to be checked out — that walk-around is what puts the job On rental.',
}

/**
 * `decided` is the inbound edge's answer to a short count: "5 of 10" is
 * either five back with five still on the truck, or five back with five
 * lost, and the two file very differently. False = the supervisor has
 * not said which yet, and the form will not file until they have. See
 * countEdit. Always true on the outbound edge.
 */
type Row = DraftLine & { open: boolean; decided: boolean }

// ── Inbound line states ─────────────────────────────────────────────
// Oliver, 2026-09-12: partial returns come back on different days, and
// filing what came back so far read as "the job is done and a whole
// bunch of stuff is missing". So a short count on the way back is one
// of three things, and the row says which:
//   still out  — off the sheet, count = back so far; the order stays
//                open here and on the board, nothing is flagged;
//   missing    — on the sheet, classified SHORT, flagged to the agent;
//   undecided  — the supervisor has not said, and cannot file yet.
// Module-level so the memo below can list its real dependencies.
const isShort = (r: Row) => r.actualQty < r.expectedQty
const isStillOut = (isOut: boolean, r: Row) => !isOut && !r.onSheet
const isMissing = (isOut: boolean, r: Row) => !isOut && r.onSheet && isShort(r) && r.decided
const isUndecided = (isOut: boolean, r: Row) => !isOut && r.onSheet && isShort(r) && !r.decided
type Extra = {
  key: string
  description: string
  actualQty: number
  note: string
  /** What the FILED report already records for this row, if it came from
   *  one. An addition is never written onto the order, so it stays a
   *  "difference" forever; this is how the form tells an addition it has
   *  already filed and flagged from one the yard just typed. */
  filedAs?: { description: string; actualQty: number }
}

const fmtDay = (ymd: string | null) => {
  if (!ymd) return '—'
  const [y, m, d] = ymd.split('-').map(Number)
  return new Intl.DateTimeFormat('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC',
  }).format(new Date(Date.UTC(y, m - 1, d)))
}

export function CheckReportForm({ draft }: { draft: ReportDraft }) {
  const router = useRouter()
  const isOut = draft.edge === 'OUT'

  const [rows, setRows] = useState<Row[]>(() =>
    draft.lines.map((l) => ({
      ...l,
      // A line a previous report marked up opens already expanded, so a
      // correction shows what was said rather than hiding it. A line
      // still coming back is not marked up — its count is a running
      // total, not a difference.
      open: (l.onSheet && l.actualQty !== l.expectedQty) || !!l.substituteFor || !!l.note,
      // Whatever the filed report says was decided when it was filed;
      // the pre-fill ("it all came back") needs no decision.
      decided: true,
    })),
  )
  const [extras, setExtras] = useState<Extra[]>(() =>
    draft.extras.map((e, i) => ({
      key: `prior-${i}`,
      description: e.description,
      actualQty: e.actualQty,
      note: e.note ?? '',
      filedAs: e.filed ? { description: e.description, actualQty: e.actualQty } : undefined,
    })),
  )
  const [preppedBy, setPreppedBy] = useState(draft.preppedBy)
  // ── Photo of the paper ────────────────────────────────────────────
  // Wes, 2026-09-03: photograph the marked-up sheet and let HQ read it.
  // What comes back is a SUGGESTION — it fills the form and nothing
  // else. The supervisor still reviews and files, because a misread
  // digit here would rewrite a client's order and email them about it.
  const [reading, setReading] = useState(false)
  /** Highlighted while a file is held over the drop zone. */
  const [dragging, setDragging] = useState(false)
  const [photo, setPhoto] = useState<{ key: string; url: string } | null>(null)
  const [readNote, setReadNote] = useState<string | null>(null)
  const [readWarn, setReadWarn] = useState<string | null>(null)
  /** Line ids the photo filled in, so the form can show which they are. */
  const [fromPhoto, setFromPhoto] = useState<Record<string, number>>({})
  const [notes, setNotes] = useState(draft.notes)
  const [saving, setSaving] = useState(false)
  /** Second click. See the confirm panel at the foot of the form. */
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<{
    /** Something here is the agent's to act on. */
    changedOrder: boolean
    /** The order's own lines actually moved. Narrower — an added row
     *  is recorded and flagged, but never written onto the order. */
    orderLinesChanged: boolean
    changes: string[]
    /** Whether the corrected quote went back to the client, and why not. */
    resend: { sent: true; to: string; cc: string[] } | { sent: false; reason: string } | null
    /** What filing this sheet settled in the yard. */
    gear: {
      pickListAdvanced: boolean
      jobReturned: boolean
      orderOut: boolean
      orderReturned: boolean
      outBlocked: OutBlockedReason | null
    } | null
    /** The sheet covered only part of the order. */
    partial: boolean
    offSheet: number
    /** IN: the lines still coming back, with what is back so far. */
    stillOut: string[]
  } | null>(null)

  const patch = (id: string, next: Partial<Row>) =>
    setRows((prev) => prev.map((r) => (r.orderLineItemId === id ? { ...r, ...next } : r)))
  /** A new count on a line, through the one rule that decides whether
   *  it needs a still-out / missing answer (countEdit). Every way a
   *  number lands — typed, read off the photo, counted by the scanner —
   *  goes through here. */
  const setCount = (id: string, qty: number) =>
    setRows((prev) => prev.map((r) => (r.orderLineItemId === id ? { ...r, ...countEdit(draft.edge, r, qty) } : r)))

  // ── Barcode phase 3: the scanner counts the line ──────────────────
  // Null when the scan table is not there yet (schema not pushed): the
  // panel simply does not render and the sheet is typed as before.
  const [unitScans, setUnitScans] = useState<UnitScanSummary | null>(draft.unitScans)
  const scanCount = (s: UnitScanSummary | null, lineId: string): number | null => {
    const l = s?.lines.find((x) => x.orderLineItemId === lineId)
    if (!l) return null
    return isOut ? l.out : l.back
  }
  /**
   * A new summary from the scanner. A line whose scan count CHANGED
   * takes that count as its Out/In number — the scanner is the count on
   * a scanned line — and comes back on the sheet if it had been left
   * off. A line whose scans were all withdrawn goes back to the
   * pre-filled "it all went". Lines the scanner never touched are left
   * exactly as the supervisor typed them.
   */
  // "SR004674 without Antenna" — the parts the desk marked missing on
  // this edge, as one sentence the agent will read on the filed report.
  // Owned by the scanner: it lives in the note behind a fixed prefix so
  // the supervisor's own words stay and the sentence updates in place.
  const MISSING_PREFIX = isOut ? 'Went out without: ' : 'Came back without: '
  const missingSentence = (s: UnitScanSummary | null, lineId: string): string | null => {
    const l = s?.lines.find((x) => x.orderLineItemId === lineId)
    const parts = (l?.units ?? [])
      .map((u) => ({ b: u.barcode, m: isOut ? u.missingOut : u.missingIn }))
      .filter((x) => x.m.length > 0)
      .map((x) => `${x.b} ${x.m.join(' + ')}`)
    return parts.length ? `${MISSING_PREFIX}${parts.join('; ')}` : null
  }
  const withMissingNote = (note: string | null, sentence: string | null): string | null => {
    const own = (note ?? '')
      .split('\n')
      .filter((line) => !line.startsWith(MISSING_PREFIX))
      .join('\n')
      .trim()
    const joined = [own, sentence].filter(Boolean).join('\n')
    return joined || null
  }
  const applySummary = (next: UnitScanSummary) => {
    setRows((prev) =>
      prev.map((r) => {
        const before = scanCount(unitScans, r.orderLineItemId)
        const after = scanCount(next, r.orderLineItemId)
        const sentence = missingSentence(next, r.orderLineItemId)
        const prevSentence = missingSentence(unitScans, r.orderLineItemId)
        const noteChanged = sentence !== prevSentence
        const note = noteChanged ? withMissingNote(r.note, sentence) : r.note
        // A missing part is something the agent has to see: open the row.
        const open = noteChanged && sentence ? true : r.open
        if (before === after) return noteChanged ? { ...r, note, open } : r
        if (after === null) return { ...r, actualQty: r.expectedQty, onSheet: true, decided: true, note, open }
        // The scanner's count lands like a typed one: on the way back a
        // short scan count asks "still out or missing?" unless the line
        // already had its answer (countEdit). Outbound, a scanned unit
        // puts its line back on the sheet — as it always has.
        return { ...r, ...countEdit(draft.edge, r, after), ...(isOut ? { onSheet: true } : {}), note, open }
      }),
    )
    setUnitScans(next)
  }
  const trackedLines = draft.lines.filter((l) => l.unitTracked).length

  /**
   * Every difference on the sheet, described the way the order, the audit
   * row and the client's re-sent quote will describe it — same functions
   * the server runs, so the confirm step cannot promise one thing and
   * file another.
   */
  const changeList = useMemo(() => {
    const out: Array<{ key: string; text: string; added: boolean; alreadyFiled: boolean }> = []
    for (const r of rows) {
      // A line left off this pull says nothing about itself — it is not
      // a change, it is a line that has not happened yet. Nor does a
      // short count nobody has called yet: it is not "missing" until
      // the supervisor says so, and the form will not file it before.
      if (!r.onSheet || isUndecided(isOut, r)) continue
      const change = classifyCheckLine(r)
      if (change === 'NONE') continue
      out.push({
        key: r.orderLineItemId, text: describeCheckChange(r, change, draft.edge), added: false, alreadyFiled: false,
      })
    }
    for (const e of extras) {
      const description = e.description.trim()
      if (!description) continue
      out.push({
        key: e.key,
        text: describeCheckChange({
          orderLineItemId: null, description, expectedQty: 0, actualQty: e.actualQty,
        }, 'ADDED', draft.edge),
        added: true,
        // Untouched since it was filed → already on the report and
        // already in front of the agent. Not outstanding work.
        alreadyFiled:
          !!e.filedAs && e.filedAs.description === description && e.filedAs.actualQty === e.actualQty,
      })
    }
    return out
  }, [rows, extras, isOut, draft.edge])
  /** Outstanding work — what filing would actually change. An addition
   *  the last submission already recorded is NOT outstanding: it cannot
   *  be reconciled against the order by design, so counting it here is
   *  what made the report re-demand a read-back forever. */
  const diffs = changeList.filter((c) => !c.alreadyFiled).length
  const pendingAdditions = changeList.filter((c) => c.alreadyFiled)
  /** Of the outstanding work, what would actually rewrite the order.
   *  Additions never do — so a sheet whose only difference is an added
   *  row must not promise the client a corrected quote. */
  const orderLineDiffs = changeList.filter((c) => !c.added && !c.alreadyFiled).length

  /**
   * The partial pull (Wes, 2026-09-04: "we should have the ability to
   * send a partial pick list"). Ticking a line off this sheet is the
   * same gesture twice over: it is left off the printed paper, and it
   * is left out of the count when the paper comes back. Which is the
   * point — the alternative was typing a zero, and a zero here means
   * "the client didn't get it", which rewrites the order and emails
   * them a smaller quote.
   */
  const offSheet = rows.filter((r) => !r.onSheet)
  const onSheetIds = rows.filter((r) => r.onSheet).map((r) => r.orderLineItemId)
  /** Inbound lines whose short count has no answer yet. Blocks filing. */
  const undecided = rows.filter((r) => isUndecided(isOut, r))
  /**
   * Which lines the printer should give them, which flips once a
   * partial sheet is already on file:
   *
   *   - setting up the first partial → the lines still ticked ON are
   *     what is going, so print those;
   *   - coming back for the second pull → the ones ticked ON were
   *     counted last time, so what is left is the OFF set.
   *
   * Getting this backwards would hand the floor a sheet for gear that
   * is already on the truck.
   */
  const pickedUpWhereWeLeftOff = !!draft.filed?.partial && offSheet.length > 0
  const printIds = pickedUpWhereWeLeftOff
    ? offSheet.map((r) => r.orderLineItemId)
    : onSheetIds
  const sheetLabel = pickedUpWhereWeLeftOff
    ? `Print what's left (${offSheet.length})`
    : offSheet.length
      ? `Print these ${onSheetIds.length} line${onSheetIds.length === 1 ? '' : 's'}`
      : 'Print a fresh sheet'
  const sheetHref = offSheet.length
    ? `/api/orders/${draft.orderId}/pick-list-pdf?lines=${printIds.join(',')}`
    : `/api/orders/${draft.orderId}/pick-list-pdf`

  // Any edit reopens the question. Without this, a supervisor who hits
  // File, spots a wrong digit in the read-back, fixes it behind the panel
  // and clicks the confirm button would be confirming a list they never
  // actually read.
  useEffect(() => { setConfirming(false) }, [rows, extras])

  /**
   * Both doors into the reader — the camera/file picker and a dropped
   * file — come through here. A drop can hand over anything at all (a
   * PDF of the same sheet, a folder, a screenshot of an email), so the
   * type is checked once, in words, rather than failing in the API.
   */
  function acceptFile(file: File | null | undefined) {
    if (!file || reading) return
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setReadNote(null)
      setReadWarn(
        `${file.name || 'That file'} is not a photo — drop a JPEG, PNG or WEBP of the sheet.`,
      )
      return
    }
    void readPhoto(file)
  }

  async function readPhoto(file: File) {
    setReading(true)
    setError(null)
    setReadNote(null)
    setReadWarn(null)
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('edge', draft.edge)
      const res = await fetch(`/api/orders/${draft.orderId}/check-report/photo`, {
        method: 'POST',
        body: fd,
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error || `Could not read the photo (${res.status}).`)
        return
      }
      if (data.photoKey) setPhoto({ key: data.photoKey, url: data.photoUrl })

      if (!data.read) {
        setReadWarn(data.error || 'The photo was saved but could not be read — type the sheet in.')
        return
      }
      if (data.read.unreadable) {
        setReadWarn(`${data.read.unreadable} The photo is attached; type the sheet in or retake it.`)
        return
      }
      // A supervisor with a stack of paper will photograph the wrong
      // sheet eventually. Say so loudly and change nothing.
      if (data.mismatch) {
        setReadWarn(
          `That photo looks like order ${data.mismatch}, not ${draft.orderNumber}. Nothing was filled in.`,
        )
        return
      }

      const conf: Record<string, number> = {}
      setRows((prev) =>
        prev.map((r) => {
          const hit = (data.read.lines as Array<{ orderLineItemId: string; actualQty: number; note: string | null; confidence: number }>)
            .find((l) => l.orderLineItemId === r.orderLineItemId)
          if (!hit) return r
          conf[r.orderLineItemId] = hit.confidence
          // A "SWAP: x" note from the reader lands in the substitution
          // field, where it belongs — same place a person would type it.
          const swap = hit.note?.startsWith('SWAP: ') ? hit.note.slice(6) : null
          return {
            ...r,
            // Through countEdit: a short count read off a return sheet
            // still has to be called still-out or missing by a person.
            ...countEdit(draft.edge, r, hit.actualQty),
            substituteFor: swap ?? r.substituteFor,
            note: swap ? r.note : (hit.note ?? r.note),
            // Open anything that differs or that the reader was unsure
            // about, so the supervisor's eye lands on exactly those.
            open: hit.actualQty !== r.expectedQty || !!swap || hit.confidence < 0.75,
          }
        }),
      )
      setFromPhoto(conf)
      if (data.read.extras?.length) {
        setExtras((prev) => [
          ...prev,
          ...(data.read.extras as Array<{ description: string; actualQty: number; note: string | null }>).map(
            (e, i) => ({
              key: `photo-${Date.now()}-${i}`,
              description: e.description,
              actualQty: e.actualQty,
              note: e.note ?? '',
            }),
          ),
        ])
      }
      if (data.read.preppedBy && !preppedBy) setPreppedBy(data.read.preppedBy)
      if (data.read.notes) setNotes((n) => (n ? `${n}\n${data.read.notes}` : data.read.notes))

      const filled = Object.keys(conf).length
      setReadNote(
        filled === 0
          ? 'Nothing was written on the sheet that changed a line — check the counts and file.'
          : `Filled in ${filled} line${filled === 1 ? '' : 's'} from the photo. Check them before filing — lines the reader was unsure about are opened below.`,
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read the photo.')
    } finally {
      setReading(false)
    }
  }

  async function submit() {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/orders/${draft.orderId}/check-report`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          edge: draft.edge,
          preppedBy,
          notes,
          sheetPhotoKey: photo?.key ?? null,
          sheetPhotoUrl: photo?.url ?? null,
          lines: [
            ...rows.map((r) => ({
              orderLineItemId: r.orderLineItemId,
              description: r.description,
              actualQty: r.actualQty,
              substituteFor: (r.substituteFor ?? '').trim() || null,
              note: (r.note ?? '').trim() || null,
              onSheet: r.onSheet,
            })),
            ...extras
              .filter((e) => e.description.trim())
              .map((e) => ({
                orderLineItemId: null,
                description: e.description.trim(),
                actualQty: e.actualQty,
                note: e.note.trim() || null,
              })),
          ],
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.reason || data.error || `Could not file the report (${res.status}).`)
        return
      }
      setDone({
        changedOrder: !!data.changedOrder,
        orderLinesChanged: !!data.orderLinesChanged,
        changes: data.changes ?? [],
        resend: data.resend ?? null,
        gear: data.gear ?? null,
        partial: !!data.partial,
        offSheet: data.offSheet ?? 0,
        stillOut: Array.isArray(data.stillOut) ? data.stillOut : [],
      })
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not file the report.')
    } finally {
      setSaving(false)
    }
  }

  if (done) {
    return (
      <div className="max-w-2xl mx-auto px-1 py-8">
        <div className="border border-lt-hairline rounded-xl p-6 bg-lt-card text-center">
          <Check size={28} aria-hidden className="mx-auto mb-3 text-chip-good-fg" />
          <h1 className="text-lt-fg text-xl font-semibold mb-1">
            {isOut ? 'Check-out report filed' : 'Check-in report filed'}
          </h1>
          {done.changedOrder ? (
            <>
              <p className="text-lt-fg2 text-[15px] max-w-[52ch] mx-auto">
                {done.orderLinesChanged
                  ? `The order has been updated and ${draft.agentName || 'the agent'} has been flagged to review what changed.`
                  : `${draft.agentName || 'The agent'} has been flagged to price what went out. The order is unchanged until they do — an added row is never written onto it here.`}
              </p>
              <ul className="mt-3 text-[14px] text-chip-warn-fg space-y-0.5">
                {done.changes.map((c, i) => <li key={i}>{c}</li>)}
              </ul>
              {/* Say plainly whether the client was told. A supervisor
                  who does not know the email went out will send their
                  own — or worse, assume one went and nothing did. */}
              {done.resend && (
                done.resend.sent ? (
                  <p className="mt-3 text-[14px] text-chip-good-fg">
                    The updated quote was emailed to {done.resend.to}, copying the office.
                  </p>
                ) : (
                  <p className="mt-3 text-[14px] text-lt-fg2">
                    The client was <b>not</b> emailed — {done.resend.reason}. The agent still has
                    the flag.
                  </p>
                )
              )}
            </>
          ) : (
            <p className="text-lt-fg2 text-[15px]">
              {isOut
                ? 'Everything went out as ordered — nothing to change.'
                : 'Everything came back as expected.'}
            </p>
          )}
          {/* Filing the inbound sheet is what closes the gear lane —
              say so, because the next question a supervisor has is
              whether anyone still has to mark the job returned. */}
          {done.partial && (
            isOut ? (
              <p className="mt-3 text-[14px] text-pill-quoted-fg">
                {done.offSheet} line{done.offSheet === 1 ? '' : 's'} weren&rsquo;t on this sheet — the
                order is unchanged there, and the job stays open on the board until they go out.
              </p>
            ) : (
              /* The partial return. Say what is still out and, just as
                 plainly, what did NOT happen: nothing was marked
                 returned, nobody was told anything is missing, and the
                 order is still in the check-in list for the next count. */
              <div className="mt-3 text-[14px] text-pill-quoted-fg">
                <p>
                  <b>Partial return</b> — {done.offSheet} line{done.offSheet === 1 ? ' is' : 's are'} still
                  out. Nothing is marked returned or missing; the order stays under Check in and on the
                  board until the rest comes back. Open it again for the next count and it starts from
                  these totals.
                </p>
                {done.stillOut.length > 0 && (
                  <ul className="mt-1.5 space-y-0.5 text-lt-fg2">
                    {done.stillOut.map((s, i) => <li key={i}>{s}</li>)}
                  </ul>
                )}
              </div>
            )
          )}
          {done.gear?.jobReturned && (
            <p className="mt-3 text-[14px] text-chip-good-fg">
              Everything on this job is back — it&rsquo;s marked returned.
            </p>
          )}
          {/* The outbound answer to the same question. Jose filed this
              sheet and then asked what else had to happen; nothing does,
              and the screen should say so rather than leave him hunting
              for a button. */}
          {done.gear?.orderOut && (
            <p className="mt-3 text-[14px] text-chip-good-fg">
              The gear is marked out — the job reads <b>On rental</b> now. Nothing else to do.
            </p>
          )}
          {/* And the honest version when it did NOT: say what is still
              holding the order, and who closes it. A sheet that settles
              nothing and says nothing is the dead end Jose hit on a
              fleet-only order. */}
          {done.gear?.outBlocked && (
            <p className="mt-3 text-[14px] text-pill-quoted-fg">
              {OUT_BLOCKED_MESSAGE[done.gear.outBlocked]}
            </p>
          )}
          {/* The inbound mirror. Reaching RETURNED is also what lets the
              order be invoiced, so it is worth saying plainly. */}
          {done.gear?.orderReturned && (
            <p className="mt-3 text-[14px] text-chip-good-fg">
              The order is marked <b>Returned</b> — it&rsquo;s ready to invoice. Nothing else to do.
            </p>
          )}

          <div className="mt-5 flex items-center justify-center gap-2">
            <Link
              href="/reports/orders"
              className="text-[13px] font-bold px-3 py-2 rounded-lg bg-amber-600 hover:bg-chip-warn-bg0 text-white"
            >
              Back to reports
            </Link>
            <Link
              href="/yard"
              className="text-[13px] font-semibold px-3 py-2 rounded-lg border border-lt-hairline text-lt-fg2 hover:bg-lt-inner"
            >
              Today&rsquo;s board
            </Link>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-3xl mx-auto px-1 py-2">
      <Link
        href="/reports/orders"
        className="inline-flex items-center gap-1.5 text-[13px] text-lt-fg2 hover:text-amber-600 mb-3"
      >
        <ArrowLeft size={13} aria-hidden />
        All reports
      </Link>

      <header className="mb-5">
        <div className="text-amber-600 text-[13px] font-semibold uppercase tracking-wide mb-1">
          {isOut ? 'Check out' : 'Check in'}
        </div>
        <h1 className="text-lt-fg text-2xl font-bold">{draft.jobName}</h1>
        <p className="text-lt-fg2 text-[15px] mt-0.5">
          <span className="font-mono">{draft.orderNumber}</span>
          <span> · {draft.company}</span>
          <span> · {fmtDay(draft.startDate)} – {fmtDay(draft.endDate)}</span>
          {draft.agentName && <span> · agent {draft.agentName}</span>}
        </p>
        {/* The document is often still a quote when the truck leaves —
            the status catches up after everything is back. Naming it
            keeps the supervisor from wondering whether they have the
            right screen. */}
        {draft.preBooked && (
          <p className="text-[13px] text-pill-quoted-fg mt-2 border border-pill-quoted-fg/25 bg-pill-quoted-bg rounded-lg px-3 py-2">
            This is still a <b>quote</b> ({draft.status.replace(/_/g, ' ').toLowerCase()}). File the
            sheet anyway — it goes onto the same lines, and the agent sees whatever changed.
          </p>
        )}
        {draft.filed && (
          <p className="text-[13px] text-lt-fg2 mt-2 border border-lt-hairline bg-lt-card rounded-lg px-3 py-2">
            Already filed {new Date(draft.filed.submittedAt).toLocaleString('en-US')}
            {draft.filed.preppedBy ? ` · prepped by ${draft.filed.preppedBy}` : ''}.{' '}
            {draft.filed.partial ? (
              isOut ? (
                <>
                  That was a <b>partial</b> pull — the lines below marked &ldquo;stays on the
                  shelf&rdquo; are what is left. Print those, then put them back and count them here;
                  filing again keeps the counts already on record.
                </>
              ) : (
                <>
                  That was a <b>partial</b> return — the lines below marked &ldquo;still out&rdquo;
                  show how much is back so far. When more arrives, type the new total on the line
                  (or &ldquo;All back&rdquo;); filing again keeps the counts already on record and the
                  order stays here until everything is in.
                </>
              )
            ) : (
              'Submitting again replaces it.'
            )}
          </p>
        )}
      </header>

      {/* ── Photograph the paper ────────────────────────────────────
          The sheet comes off the floor covered in pen. Typing 40 lines
          out of it is the whole cost of this screen, so the phone in
          their hand does the first pass and the supervisor confirms. */}
      <div
        onDragOver={(e) => {
          e.preventDefault()
          if (!reading) setDragging(true)
        }}
        onDragLeave={(e) => {
          // Moving onto a child fires dragleave on the parent; only a
          // pointer that has actually left the card should un-highlight.
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false)
        }}
        onDrop={(e) => {
          e.preventDefault()
          setDragging(false)
          acceptFile(e.dataTransfer.files?.[0])
        }}
        className={`mb-4 border-2 border-dashed rounded-xl p-3 transition-colors ${
          dragging ? 'border-amber-500 bg-chip-warn-bg' : 'border-lt-hairline bg-lt-card'
        }`}
      >
        <div className="flex flex-wrap items-center gap-3">
          <label
            className={`inline-flex items-center gap-2 text-[14px] font-semibold rounded-lg px-3 py-2 ${
              reading
                ? 'bg-lt-inner text-lt-fg3 cursor-wait'
                : 'bg-lt-fg hover:opacity-90 text-white cursor-pointer'
            }`}
          >
            <Camera size={15} aria-hidden />
            {reading ? 'Reading the sheet…' : photo ? 'Retake the photo' : 'Photograph the sheet'}
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              // capture= puts a phone straight into the camera; on a
              // desktop it is ignored and this is an ordinary file picker.
              capture="environment"
              className="hidden"
              disabled={reading}
              onChange={(e) => {
                acceptFile(e.target.files?.[0])
                e.target.value = ''
              }}
            />
          </label>
          <span className="text-[13px] text-lt-fg2 flex-1 min-w-[16rem]">
            {dragging ? (
              <b className="text-chip-warn-fg">Drop the photo to read it.</b>
            ) : (
              <>
                <b className="text-lt-fg">Or drag a photo of the sheet onto this box.</b> Fills
                the counts below from the handwriting. Nothing is filed until you check it and hit
                File — the photo is kept with the report either way.
              </>
            )}
          </span>
          {/* A plain anchor, not next/link: this is an API route that
              streams a PDF, and the client router has no business
              prefetching or intercepting it. */}
          <a
            href={sheetHref}
            target="_blank"
            rel="noreferrer"
            className="text-[13px] font-semibold text-lt-fg2 hover:text-amber-600 inline-flex items-center gap-1.5"
          >
            <Printer size={14} aria-hidden />
            {sheetLabel}
          </a>
        </div>
        {photo && !readWarn && (
          <p className="mt-2 text-[13px] text-chip-good-fg">Photo attached to this report.</p>
        )}
        {readNote && <p className="mt-2 text-[13px] text-pill-quoted-fg">{readNote}</p>}
        {readWarn && (
          <p className="mt-2 text-[13px] text-chip-warn-fg flex items-start gap-1.5">
            <AlertTriangle size={13} aria-hidden className="flex-none mt-0.5" />
            <span>{readWarn}</span>
          </p>
        )}
        {draft.filed?.sheetPhotoUrl && !photo && (
          <p className="mt-2 text-[13px] text-lt-fg2">
            A photo of the sheet is already on the filed report.
          </p>
        )}
      </div>

      {/* Who prepped it — the name on the paper. */}
      <div className="mb-4">
        <label className="block">
          <span className="text-[12px] uppercase tracking-wide text-lt-fg2 font-semibold">
            Prepped &amp; loaded by
          </span>
          <input
            value={preppedBy}
            onChange={(e) => setPreppedBy(e.target.value)}
            placeholder="The associate who pulled it"
            className="mt-1 w-full bg-lt-inner border border-lt-hairline rounded-lg px-3 py-2 text-[15px] text-lt-fg placeholder:text-lt-fg3"
          />
        </label>
      </div>

      {unitScans && (
        <UnitScanPanel
          orderId={draft.orderId}
          edge={draft.edge}
          trackedLines={trackedLines}
          summary={unitScans}
          onSummary={applySummary}
        />
      )}

      <div className="border border-lt-hairline bg-lt-card rounded-xl overflow-hidden mb-4">
        <div className="px-3 py-2 bg-lt-inner border-b border-lt-hairline flex items-center justify-between">
          <span className="text-[12px] uppercase tracking-wide text-lt-fg2 font-semibold">
            {isOut ? 'What actually went out' : 'What actually came back'}
          </span>
          <span className="text-[12px] text-lt-fg3">
            {offSheet.length
              ? isOut
                ? `${onSheetIds.length} of ${rows.length} lines on this pull`
                : `${offSheet.length} of ${rows.length} lines still out`
              : `${rows.length} lines · pre-filled from the order`}
          </span>
        </div>

        {rows.length === 0 && (
          <p className="px-3 py-6 text-center text-[15px] text-lt-fg3">This order has no line items.</p>
        )}

        {rows.map((r) => {
          const differs =
            r.onSheet && (r.actualQty !== r.expectedQty || !!(r.substituteFor ?? '').trim())
          const stillOut = isStillOut(isOut, r)
          const undecided = isUndecided(isOut, r)
          const missing = isMissing(isOut, r)
          const notBack = Math.max(0, r.expectedQty - r.actualQty)
          // A line held back for a later pull: dimmed, no count, and no
          // controls that would imply something happened to it. Outbound
          // only — an inbound line still out KEEPS its count (how much is
          // back so far) and renders below with the others.
          if (!r.onSheet && isOut) {
            return (
              <div
                key={r.orderLineItemId}
                className="px-3 py-2.5 border-b border-lt-hairline last:border-b-0 bg-lt-inner flex items-center gap-3"
              >
                <div className="min-w-0 flex-1">
                  <div className="text-lt-fg3 text-[16px] font-medium truncate line-through decoration-lt-fg3">
                    {r.description}
                  </div>
                  <div className="text-lt-fg3 text-[13px] truncate">
                    ordered {r.expectedQty} · stays on the shelf for a later pull
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => patch(r.orderLineItemId, { onSheet: true })}
                  className="flex-none text-[12px] font-semibold text-lt-fg2 hover:text-amber-600 border border-lt-hairline rounded-lg px-2.5 py-1.5"
                >
                  Put back
                </button>
              </div>
            )
          }
          return (
            <div
              key={r.orderLineItemId}
              className={`px-3 py-2.5 border-b border-lt-hairline last:border-b-0 ${
                stillOut ? 'bg-lt-inner' : differs ? 'bg-chip-warn-bg' : ''
              }`}
            >
              <div className="flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <div className="text-lt-fg text-[16px] font-medium truncate">{r.description}</div>
                  <div className="text-lt-fg2 text-[13px] truncate">
                    {r.qualifier && <span>{r.qualifier} · </span>}
                    ordered {r.expectedQty}
                    {r.lane && <span className="text-lt-fg3"> · {r.lane.toLowerCase()}</span>}
                  </div>
                  {/* A line the scanner can count, or already has. */}
                  {unitScans && (r.unitTracked || unitScans.lines.some((l) => l.orderLineItemId === r.orderLineItemId)) && (
                    <LineUnitStrip
                      orderId={draft.orderId}
                      edge={draft.edge}
                      expectedQty={r.expectedQty}
                      line={unitScans.lines.find((l) => l.orderLineItemId === r.orderLineItemId) ?? null}
                      onSummary={applySummary}
                    />
                  )}
                </div>
                <label className="flex items-center gap-1.5 flex-none">
                  <span className="text-[12px] text-lt-fg3 uppercase tracking-wide">
                    {isOut ? 'Out' : 'In'}
                  </span>
                  <input
                    type="number"
                    min={0}
                    inputMode="numeric"
                    value={r.actualQty}
                    onChange={(e) => setCount(r.orderLineItemId, Number(e.target.value) || 0)}
                    className={`w-20 text-center bg-lt-inner border rounded-lg px-2 py-1.5 text-[16px] text-lt-fg ${
                      differs || undecided ? 'border-amber-500' : stillOut ? 'border-pill-quoted-fg/40' : 'border-lt-hairline'
                    }`}
                  />
                </label>
                {/* Where a number came from matters more than what it
                    is: a low-confidence read is exactly the line a
                    supervisor should look at twice. */}
                {fromPhoto[r.orderLineItemId] !== undefined && (
                  <span
                    title={`Read from the photo (${Math.round(fromPhoto[r.orderLineItemId] * 100)}% confident)`}
                    className={`text-[11px] font-bold uppercase tracking-wider rounded px-1.5 py-0.5 flex-none border ${
                      fromPhoto[r.orderLineItemId] < 0.75
                        ? 'text-chip-warn-fg border-chip-warn-fg/30 bg-chip-warn-bg'
                        : 'text-pill-quoted-fg border-pill-quoted-fg/25 bg-pill-quoted-bg'
                    }`}
                  >
                    {fromPhoto[r.orderLineItemId] < 0.75 ? 'Check' : 'Photo'}
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => patch(r.orderLineItemId, { open: !r.open })}
                  className="text-[12px] font-semibold text-lt-fg2 hover:text-amber-600 px-2 py-1.5 flex-none"
                >
                  {r.open ? 'Hide' : 'Swap / note'}
                </button>
                {/* NOT a zero. Zero means the client didn't get it and
                    rewrites the order; this means it hasn't gone yet.
                    Inbound, the same button says nothing on the line is
                    back yet — count 0, still out — and once a line is
                    still out it flips to the quick "All back". */}
                {isOut ? (
                  <button
                    type="button"
                    title="Leave this line off this pull"
                    onClick={() => patch(r.orderLineItemId, { onSheet: false, open: false })}
                    className="text-[12px] font-semibold text-lt-fg3 hover:text-amber-600 px-2 py-1.5 flex-none"
                  >
                    Not this pull
                  </button>
                ) : stillOut ? (
                  <button
                    type="button"
                    title="Everything on this line is back"
                    onClick={() => patch(r.orderLineItemId, { actualQty: r.expectedQty, onSheet: true, decided: true })}
                    className="text-[12px] font-semibold text-lt-fg3 hover:text-amber-600 px-2 py-1.5 flex-none"
                  >
                    All back
                  </button>
                ) : (
                  <button
                    type="button"
                    title="Nothing on this line has come back yet — it stays open, nothing is flagged"
                    onClick={() => patch(r.orderLineItemId, { actualQty: 0, onSheet: false, decided: true, open: false })}
                    className="text-[12px] font-semibold text-lt-fg3 hover:text-amber-600 px-2 py-1.5 flex-none"
                  >
                    Still out
                  </button>
                )}
              </div>

              {/* ── The inbound question ──────────────────────────────
                  A short count on the way back is ambiguous, and the
                  two readings file very differently: "still out" keeps
                  the order open for the next count; "missing" closes
                  the count on this line and flags the agent. The row
                  asks, then says which it is and offers the other. */}
              {undecided && (
                <div className="mt-2 flex flex-wrap items-center gap-2 text-[13px]">
                  <span className="text-chip-warn-fg font-semibold">
                    {notBack} of {r.expectedQty} not back — still out, or missing?
                  </span>
                  <button
                    type="button"
                    onClick={() => patch(r.orderLineItemId, { onSheet: false, decided: true })}
                    className="text-[12px] font-bold px-2.5 py-1.5 rounded-lg bg-lt-fg text-white hover:opacity-90"
                  >
                    Still out — coming back later
                  </button>
                  <button
                    type="button"
                    onClick={() => patch(r.orderLineItemId, { onSheet: true, decided: true, open: true })}
                    className="text-[12px] font-bold px-2.5 py-1.5 rounded-lg border border-chip-warn-fg/40 text-chip-warn-fg hover:bg-chip-warn-bg"
                  >
                    Missing
                  </button>
                </div>
              )}
              {stillOut && (
                <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[13px] text-pill-quoted-fg">
                  <span>
                    {r.actualQty > 0 ? `${r.actualQty} of ${r.expectedQty} back` : 'Nothing back yet'} ·{' '}
                    <b>{notBack} still out</b> — the order stays open for the next count.
                  </span>
                  <button
                    type="button"
                    onClick={() => patch(r.orderLineItemId, { onSheet: true, decided: true, open: true })}
                    className="text-[12px] font-semibold underline hover:text-chip-warn-fg"
                  >
                    It&rsquo;s missing instead
                  </button>
                </div>
              )}
              {missing && (
                <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[13px] text-chip-warn-fg">
                  <span>
                    <b>{notBack} missing</b> — recorded and flagged to {draft.agentName || 'the agent'}.
                  </span>
                  <button
                    type="button"
                    onClick={() => patch(r.orderLineItemId, { onSheet: false, decided: true })}
                    className="text-[12px] font-semibold underline hover:text-pill-quoted-fg"
                  >
                    Still out instead
                  </button>
                </div>
              )}

              {r.open && (
                <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <label className="block">
                    <span className="text-[11px] uppercase tracking-wide text-lt-fg2 font-semibold">
                      Sent something else instead
                    </span>
                    <input
                      value={r.substituteFor ?? ''}
                      onChange={(e) => patch(r.orderLineItemId, { substituteFor: e.target.value })}
                      placeholder="What this replaced"
                      className="mt-1 w-full bg-lt-inner border border-lt-hairline rounded-lg px-2.5 py-1.5 text-[14px] text-lt-fg placeholder:text-lt-fg3"
                    />
                    {/* The order line is RENAMED, not deleted — it keeps
                        its rate and dates, and the report holds the
                        original wording. */}
                    <span className="text-[11px] text-lt-fg3 mt-0.5 block">
                      Put the swapped-in item in the line name above; this field records what it replaced.
                    </span>
                  </label>
                  <label className="block">
                    <span className="text-[11px] uppercase tracking-wide text-lt-fg2 font-semibold">Note</span>
                    <input
                      value={r.note ?? ''}
                      onChange={(e) => patch(r.orderLineItemId, { note: e.target.value })}
                      placeholder="Anything the agent should know"
                      className="mt-1 w-full bg-lt-inner border border-lt-hairline rounded-lg px-2.5 py-1.5 text-[14px] text-lt-fg placeholder:text-lt-fg3"
                    />
                  </label>
                  <label className="block sm:col-span-2">
                    <span className="text-[11px] uppercase tracking-wide text-lt-fg2 font-semibold">
                      Line name
                    </span>
                    <input
                      value={r.description}
                      onChange={(e) => patch(r.orderLineItemId, { description: e.target.value })}
                      className="mt-1 w-full bg-lt-inner border border-lt-hairline rounded-lg px-2.5 py-1.5 text-[14px] text-lt-fg"
                    />
                  </label>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Things that went that were never on the order. Recorded and
          flagged, never priced here — the yard cannot see rates, and a
          line added at $0 would silently under-bill the job. */}
      <div className="border border-lt-hairline bg-lt-card rounded-xl overflow-hidden mb-4">
        <div className="px-3 py-2 bg-lt-inner border-b border-lt-hairline">
          <span className="text-[12px] uppercase tracking-wide text-lt-fg2 font-semibold">
            Not on the order
          </span>
          <span className="text-[12px] text-lt-fg3 ml-2">
            Flagged to the agent to price — nothing is added to the order here.
          </span>
        </div>
        {/* Units the scanner recorded that matched no line. Each one is
            a row the agent has to price — one tap turns it into one. */}
        {unitScans && unitScans.unlisted.length > 0 && (
          <div className="px-3 py-2 border-b border-lt-hairline bg-chip-warn-bg">
            <div className="text-[12px] font-semibold text-chip-warn-fg mb-1">
              Scanned {isOut ? 'out' : 'back'} but not on the order
            </div>
            <ul className="space-y-1">
              {unitScans.unlisted.map((u) => {
                const name = u.description ?? u.barcode
                const listed = extras.some((e) => e.description.trim() === `${name} (${u.barcode})`)
                return (
                  <li key={u.scanId} className="flex items-center gap-2 text-[13px] text-chip-warn-fg">
                    <span className="font-mono">{u.barcode}</span>
                    <span className="truncate flex-1 min-w-0">{u.description ?? ''}</span>
                    {listed ? (
                      <span className="text-[11px] uppercase tracking-wider font-bold">row added</span>
                    ) : (
                      <button
                        type="button"
                        onClick={() =>
                          setExtras((prev) => [
                            ...prev,
                            { key: `scan-${u.scanId}`, description: `${name} (${u.barcode})`, actualQty: 1, note: '' },
                          ])
                        }
                        className="underline font-semibold hover:text-amber-700"
                      >
                        Add as a row
                      </button>
                    )}
                  </li>
                )
              })}
            </ul>
          </div>
        )}
        {extras.map((e, i) => (
          <div key={e.key} className="px-3 py-2.5 border-b border-lt-hairline last:border-b-0 flex items-center gap-2">
            <input
              value={e.description}
              onChange={(ev) =>
                setExtras((prev) => prev.map((x, j) => (j === i ? { ...x, description: ev.target.value } : x)))
              }
              placeholder="What went out that isn't on the order"
              className="flex-1 min-w-0 bg-lt-inner border border-lt-hairline rounded-lg px-2.5 py-1.5 text-[14px] text-lt-fg placeholder:text-lt-fg3"
            />
            <input
              type="number"
              min={0}
              inputMode="numeric"
              value={e.actualQty}
              onChange={(ev) =>
                setExtras((prev) =>
                  prev.map((x, j) => (j === i ? { ...x, actualQty: Math.max(0, Number(ev.target.value) || 0) } : x)),
                )
              }
              className="w-20 text-center bg-lt-inner border border-lt-hairline rounded-lg px-2 py-1.5 text-[16px] text-lt-fg flex-none"
            />
            <button
              type="button"
              onClick={() => setExtras((prev) => prev.filter((_, j) => j !== i))}
              aria-label="Remove this row"
              className="text-lt-fg3 hover:text-chip-bad-fg px-1.5 py-1.5 flex-none"
            >
              <Trash2 size={15} aria-hidden />
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() =>
            setExtras((prev) => [...prev, { key: `new-${Date.now()}`, description: '', actualQty: 1, note: '' }])
          }
          className="w-full px-3 py-2.5 text-[13px] font-semibold text-lt-fg2 hover:text-amber-600 inline-flex items-center justify-center gap-1.5"
        >
          <Plus size={13} aria-hidden />
          Add a row
        </button>
      </div>

      <label className="block mb-4">
        <span className="text-[12px] uppercase tracking-wide text-lt-fg2 font-semibold">
          Notes on the sheet
        </span>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          placeholder="Anything written on the paper that doesn't belong to one line."
          className="mt-1 w-full bg-lt-inner border border-lt-hairline rounded-lg px-3 py-2 text-[15px] text-lt-fg placeholder:text-lt-fg3 leading-relaxed"
        />
      </label>

      {/* A partial pull is the one case where filing does LESS than it
          looks like it does — say so plainly, both because the
          supervisor should know the order is untouched and because
          somebody still has to pull the rest. */}
      {offSheet.length > 0 && !confirming && (
        isOut ? (
          <p className="mb-3 text-[14px] text-pill-quoted-fg border border-pill-quoted-fg/25 bg-pill-quoted-bg rounded-lg px-3 py-2">
            <b>Partial pull.</b> {offSheet.length} line{offSheet.length === 1 ? ' is' : 's are'} not on
            this sheet — they stay on the order untouched, and this job stays open on the yard board
            until the rest goes out. Re-open this screen for the next pull and it picks up where this
            one stopped.
          </p>
        ) : (
          <div className="mb-3 text-[14px] text-pill-quoted-fg border border-pill-quoted-fg/25 bg-pill-quoted-bg rounded-lg px-3 py-2">
            <p>
              <b>Partial return.</b> {offSheet.length} line{offSheet.length === 1 ? ' is' : 's are'} still
              out. Filing records what is back so far and nothing more — the order is not marked
              returned, nothing is flagged as missing, and it stays under Check in and on the board
              until the rest comes back. Open it again for the next count and it starts from these
              totals.
            </p>
            <ul className="mt-1.5 space-y-0.5 text-[13px]">
              {offSheet.map((r) => <li key={r.orderLineItemId}>{describeStillOut(r)}</li>)}
            </ul>
          </div>
        )
      )}

      {/* The file button is off until every short inbound count has
          been called. Saying why, beside it, beats a dead button. */}
      {undecided.length > 0 && !confirming && (
        <p className="mb-3 text-[14px] text-chip-warn-fg border border-chip-warn-fg/30 bg-chip-warn-bg rounded-lg px-3 py-2 flex items-start gap-2">
          <AlertTriangle size={15} aria-hidden className="flex-none mt-0.5" />
          <span>
            {undecided.length === 1
              ? `${undecided[0].description} came back short — say whether the rest is still out or missing before filing.`
              : `${undecided.length} lines came back short — say on each whether the rest is still out or missing before filing.`}
          </span>
        </p>
      )}

      {/* The report is filed and the only thing still "differing" is an
          addition the agent has to price. That is not the yard's work,
          and it is not a reason to file again — which is exactly what
          the old screen implied, forever. */}
      {pendingAdditions.length > 0 && diffs === 0 && !confirming && (
        <p className="mb-3 text-[14px] text-lt-fg2 border border-lt-hairline bg-lt-card rounded-lg px-3 py-2">
          <b className="text-lt-fg">This sheet is filed.</b>{' '}
          {pendingAdditions.length === 1 ? 'One row went out' : `${pendingAdditions.length} rows went out`}{' '}
          that was not on the order — {pendingAdditions.map((c) => c.text).join(', ')} — and{' '}
          {draft.agentName || 'the agent'} has been flagged to price{' '}
          {pendingAdditions.length === 1 ? 'it' : 'them'}. The order will not change until they do.
          Nothing further is needed here; file again only to correct the counts above.
        </p>
      )}

      {/* Say what Submit will do before it does it. */}
      {diffs > 0 && !confirming && (
        <p className="mb-3 text-[14px] text-chip-warn-fg border border-chip-warn-fg/30 bg-chip-warn-bg rounded-lg px-3 py-2 flex items-start gap-2">
          <AlertTriangle size={15} aria-hidden className="flex-none mt-0.5" />
          <span>
            {diffs} line{diffs === 1 ? '' : 's'} differ from the order.
            {!isOut
              ? ' A check-in is recorded and flagged, but never changes what was rented — the agent decides what a shortfall costs.'
              : orderLineDiffs > 0
                ? ` Filing this updates the order and flags ${draft.agentName || 'the agent'} to review it.` +
                  (draft.preBooked
                    ? ' The client is emailed the corrected quote automatically, copying the office.'
                    : '')
                : ` Nothing on the order moves — added rows are flagged to ${draft.agentName || 'the agent'} to price.`}
          </span>
        </p>
      )}

      {error && <p className="mb-3 text-[14px] text-chip-bad-fg">{error}</p>}

      {/* ── The read-back ───────────────────────────────────────────
          Wes, 2026-09-04: a mis-keyed digit used to rewrite the order
          and email the client on one tap. A sheet that matches the
          order still files on one tap — that is the common case and
          costs nothing. A sheet that DIFFERS gets read back, line by
          line, in the words the client and the agent will see. */}
      {confirming ? (
        <div className="mb-8 rounded-xl border-2 border-chip-warn-fg/40 bg-chip-warn-bg p-4">
          <h2 className="text-[15px] font-bold text-chip-warn-fg flex items-center gap-2">
            <AlertTriangle size={16} aria-hidden className="flex-none" />
            Check this back against the sheet
          </h2>

          {changeList.some((c) => !c.added) && (
            <>
              <p className="mt-3 text-[13px] font-semibold text-chip-warn-fg">
                {isOut
                  ? 'Written onto the order:'
                  : 'Recorded against the order — the order itself is not changed:'}
              </p>
              <ul className="mt-1 space-y-1">
                {changeList.filter((c) => !c.added).map((c) => (
                  <li key={c.key} className="text-[15px] text-lt-fg font-medium">{c.text}</li>
                ))}
              </ul>
            </>
          )}

          {changeList.some((c) => c.added) && (
            <>
              <p className="mt-3 text-[13px] font-semibold text-chip-warn-fg">
                Flagged to {draft.agentName || 'the agent'} to price — not added to the order:
              </p>
              <ul className="mt-1 space-y-1">
                {changeList.filter((c) => c.added).map((c) => (
                  <li key={c.key} className="text-[15px] text-lt-fg font-medium">{c.text}</li>
                ))}
              </ul>
            </>
          )}

          <p className="mt-3 text-[13px] text-chip-warn-fg leading-relaxed">
            {isOut ? (
              orderLineDiffs > 0 ? (
                <>
                  Filing this changes what {draft.company} is billed for and flags{' '}
                  {draft.agentName || 'the agent'} to review it.
                  {draft.preBooked
                    ? ' The corrected quote is emailed to the client automatically, copying the office.'
                    : ''}
                </>
              ) : (
                <>
                  Nothing on the order moves — an added row is never written onto it, because the
                  yard cannot see rates and a line at $0 would under-bill the job. This records what
                  went out and flags {draft.agentName || 'the agent'} to price it.
                </>
              )
            ) : (
              <>
                A check-in never changes what was rented — this is recorded and flagged to{' '}
                {draft.agentName || 'the agent'}, who decides what a shortfall costs.
              </>
            )}
          </p>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              onClick={() => void submit()}
              disabled={saving}
              className="px-4 py-2.5 bg-amber-600 hover:bg-chip-warn-bg0 text-white text-[15px] font-semibold rounded-lg disabled:opacity-50"
            >
              {saving
                ? 'Filing…'
                : isOut
                  ? 'Yes — file it and update the order'
                  : 'Yes — file it'}
            </button>
            <button
              onClick={() => setConfirming(false)}
              disabled={saving}
              className="text-[14px] font-semibold text-lt-fg2 hover:text-lt-fg disabled:opacity-50"
            >
              Go back and fix it
            </button>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-3 pb-8">
          <button
            onClick={() => {
              if (undecided.length > 0) return
              // Nothing differs → nothing to read back. One tap, as before.
              if (diffs > 0) { setConfirming(true); return }
              void submit()
            }}
            disabled={saving || undecided.length > 0}
            className="px-4 py-2.5 bg-amber-600 hover:bg-chip-warn-bg0 text-white text-[15px] font-semibold rounded-lg disabled:opacity-50"
          >
            {saving
              ? 'Filing…'
              : diffs > 0
                ? `Review ${diffs} change${diffs === 1 ? '' : 's'} and file`
                : !isOut && offSheet.length > 0
                  ? `File the partial return · ${offSheet.length} still out`
                  : draft.filed ? 'Replace the filed report' : 'File the report'}
          </button>
          <Link href="/reports/orders" className="text-[14px] text-lt-fg2 hover:text-lt-fg">
            Cancel
          </Link>
        </div>
      )}
    </div>
  )
}
