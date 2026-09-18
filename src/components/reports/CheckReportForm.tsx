'use client'

/**
 * The check in/out report — a paper pull sheet, typed in.
 *
 * The whole design follows from what the person doing this is actually
 * holding: a marked-up sheet, a pen, and forty lines of which two are
 * wrong. So:
 *
 *   - EVERY count starts at zero — both edges. Wes, 2026-09-14: "The
 *     pull list OUT numbers should start at zero because they haven't
 *     pulled anything yet. The quantity ordered should be next to the
 *     box so they know the quantity they need to pull. If three walkies
 *     are ordered, the quantity out should say zero until three walkies
 *     are scanned out." Then, the same day: "For check out AND check in
 *     reports, the quantities need to be started at zero."
 *     A pre-filled number is indistinguishable from a counted one — the
 *     same reason the photo reader is told to omit blank lines rather
 *     than echo the order. So a line is UNCOUNTED until somebody scans
 *     it, types it, or taps its ordered quantity, and the sheet will not
 *     file while any line on it is still uncounted. "Everything as
 *     ordered" keeps the one-tap day one tap.
 *   - A zero is still a real answer, and a dangerous one: on the way out
 *     it rewrites the order and emails the client a smaller quote, and
 *     on the way in it is gear that did not come home. Uncounted is NOT
 *     that, and never reaches the server as a count.
 *   - VEHICLES are not on this sheet's hook at all. A FLEET-lane line is
 *     listed so the floor knows what else is going, with no count box —
 *     it leaves on the driver's check-out and comes back through the yard
 *     walk-around (Wes, 2026-09-14).
 *   - A line only opens its exchange/note fields when its count differs
 *     or the supervisor asks for them. The sheet stays scannable.
 *   - The consequences are stated on screen BEFORE submitting, not
 *     discovered afterwards: a check-out that differs says, in words,
 *     that it will change the order and tell the agent.
 *   - A sheet is often done in PASSES by different people (Wes,
 *     2026-09-15: somebody does the walkies, gets pulled away, and
 *     somebody else finishes). "Save what's done" files the counted
 *     lines and leaves every uncounted one open; re-opening shows those
 *     as not-pulled-yet, and every counted line says who counted it.
 *
 * Hugo, 2026-09-03: "there are last minute exchanges and modifications
 * that will need to be done to the order based on the check out report.
 * This should be done and modify the order and flag back to the sales
 * agent."
 */

import { useEffect, useMemo, useState } from 'react'
import { CheckoutAddOnsCard } from '@/components/orders/CheckoutAddOnsCard'
import { SendCheckInReportButton } from '@/components/reports/SendCheckInReportButton'
import { WALKAROUND_CREW, WAREHOUSE_CREW } from '@/lib/fleet/walkaroundCrew'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Plus, Trash2, AlertTriangle, Check, Camera, Printer } from 'lucide-react'
import type { ReportDraft, DraftLine, OutBlockedReason } from '@/lib/orders/checkReports'
import { sameCount } from '@/lib/orders/checkPasses'
import { classifyCheckLine, describeCheckChange } from '@/lib/orders/checkLineChange'
import { ExtraItemPicker } from '@/components/reports/ExtraItemPicker'
import {
  kitShortfalls,
  describeShortfall,
  describeParents,
  type CountedQuantities,
} from '@/lib/orders/kitCompleteness'
import { pullGapsForLine, type PullGap } from '@/lib/orders/pullAmbiguity'
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

type Row = DraftLine & {
  open: boolean
  /**
   * Somebody has said what happened to this line. FALSE is not "zero
   * went out" — it is "nobody has pulled this yet", which is why a zero
   * here may never reach the server as a count (a real zero rewrites the
   * order and emails the client a smaller quote).
   */
  counted: boolean
}
type Extra = {
  key: string
  description: string
  /** The catalog row the supervisor named, when they could. It is what
   *  prices the order line this row becomes; null means the line lands
   *  unpriced and an agent has to set a rate before the order can be
   *  invoiced. */
  inventoryItemId: string | null
  actualQty: number
  note: string
  /** What the FILED report already records for this row, if it came from
   *  one. An addition is never written onto the order, so it stays a
   *  "difference" forever; this is how the form tells an addition it has
   *  already filed and flagged from one the yard just typed. */
  filedAs?: { description: string; actualQty: number }
}

/**
 * A vehicle is not warehouse work.
 *
 * Wes, 2026-09-14: "it's making warehouse check out the vehicles on the
 * order to complete the check out. The vehicles should be separate check
 * in/out." A FLEET-lane line leaves through the driver's check-out and its
 * 22-slot walk-around, and comes back through the yard walking it — which
 * is what `settleGearAfterReport` already believes (it only ever advances
 * WAREHOUSE lines). The sheet still SHOWS the truck, because the floor
 * loading it wants to know it is going; it just never asks them to count
 * it, and a van nobody typed a number into no longer holds the pull.
 */
const isFleetLine = (l: { lane: string | null }) => l.lane === 'FLEET'

/** "10:14 AM" today, "Mon 4:02 PM" otherwise — a byline, not a record. */
const fmtWhen = (iso: string | null) => {
  if (!iso) return ''
  const d = new Date(iso)
  const tz = 'America/Los_Angeles'
  const day = (x: Date) => new Intl.DateTimeFormat('en-US', { dateStyle: 'short', timeZone: tz }).format(x)
  const time = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone: tz }).format(d)
  if (day(d) === day(new Date())) return time
  return `${new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: tz }).format(d)} ${time}`
}

const fmtDay = (ymd: string | null) => {
  if (!ymd) return '—'
  const [y, m, d] = ymd.split('-').map(Number)
  return new Intl.DateTimeFormat('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC',
  }).format(new Date(Date.UTC(y, m - 1, d)))
}

export function CheckReportForm({
  draft,
  viewerName,
  initialScan = null,
}: {
  draft: ReportDraft
  viewerName: string | null
  /** A barcode scanned on the reports page to open this sheet. */
  initialScan?: string | null
}) {
  const router = useRouter()
  const isOut = draft.edge === 'OUT'
  const draftById = useMemo(() => new Map(draft.lines.map((l) => [l.orderLineItemId, l])), [draft.lines])

  /**
   * A fresh sheet starts empty, on BOTH edges — see the header. A sheet
   * already on file keeps its numbers: those were counted by a person,
   * and re-opening one is a correction, not a re-count from nothing.
   */
  // A filed sheet's lines start counted — somebody stood there and
  // counted them. EXCEPT a line the sheet has no row for: that gear was
  // added to the order after the pull, nobody has touched it, and
  // pre-filling it as counted is exactly how a truck leaves without it
  // (Wes, 2026-09-18). It starts at zero, like a fresh sheet's line.
  const startsCounted = (l: DraftLine) =>
    isFleetLine(l) ||
    (draft.filed
      ? l.onSheet && !l.addedAfterPull
      : l.actualQty !== l.expectedQty || !!l.substituteFor || !!l.note)
  const [rows, setRows] = useState<Row[]>(() =>
    draft.lines.map((l) => {
      const counted = startsCounted(l)
      return {
        ...l,
        // The rest of a sheet somebody saved partway: back ON the sheet
        // and UNCOUNTED, exactly like a fresh line. The person picking it
        // up sees what is left as work to do, not as struck-through rows
        // they have to un-strike one at a time first.
        onSheet: true,
        // A line a previous report marked up opens already expanded, so a
        // correction shows what was said rather than hiding it.
        open: l.actualQty !== l.expectedQty || !!l.substituteFor || !!l.note,
        counted,
        actualQty: counted ? l.actualQty : 0,
        // Same rule as the count: a line nobody has counted says nothing
        // about damage either, so it starts at zero rather than carrying
        // a number from a sheet this pass has not looked at.
        damagedQty: counted ? l.damagedQty : 0,
      }
    }),
  )
  const [extras, setExtras] = useState<Extra[]>(() =>
    draft.extras.map((e, i) => ({
      key: `prior-${i}`,
      description: e.description,
      inventoryItemId: null,
      actualQty: e.actualQty,
      note: e.note ?? '',
      filedAs: e.filed ? { description: e.description, actualQty: e.actualQty } : undefined,
    })),
  )
  const [preppedBy, setPreppedBy] = useState(draft.preppedBy)
  /**
   * "Begin Check In" — Wes, 2026-09-18: *"That needs to only be possible
   * when the order is back."*
   *
   * A fresh inbound sheet opens on a door, not on forty count boxes. The
   * two ways through it are the two things that actually happen: it all
   * came back, or some of it didn't. Filing a check-in advances the order
   * to Returned and takes the job off the board, so the accidental one —
   * tapping the row above the one you meant — is worth a deliberate tap.
   *
   * Re-opening a sheet already on file skips the door entirely: that is a
   * correction, and the person doing it knows what they came for.
   */
  const [begun, setBegun] = useState(false)
  /** The person asserted the gate's condition anyway — it went out on
   *  paper, or it came back early. See lib/orders/checkInReady.ts. */
  const [gateOverridden, setGateOverridden] = useState(false)
  /** Nothing files without a name — Wes, 2026-09-15: "we should require
   *  a name for any pull or checkin of items". */
  const nameMissing = !preppedBy.trim()
  /** Gear added to the order after this sheet was filed. Nobody pulled
   *  it — to the floor it is a new order, so it prints on its own sheet
   *  and counts as work still owed (lib/orders/addedAfterPull.ts). */
  const addedSincePull = useMemo(
    () => new Set(draft.lines.filter((l) => l.addedAfterPull).map((l) => l.orderLineItemId)),
    [draft.lines],
  )
  /** How many of those the floor is actually being asked to go and get.
   *  Zero once the truck is back — the server stops counting there, and
   *  the uncounted rows stay uncounted (checkReports.reportDraft). */
  const addedToPull = draft.filed?.addedSince ?? 0
  /** Everything still to pull — what "Print what's left" and the header
   *  count as the remainder: lines a previous pass held back, plus the
   *  lines added since it. */
  const leftByEarlierPass = useMemo(
    () =>
      new Set([
        ...(draft.filed?.partial ? draft.lines.filter((l) => !l.onSheet).map((l) => l.orderLineItemId) : []),
        ...addedSincePull,
      ]),
    [draft.filed, draft.lines, addedSincePull],
  )
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
  /** Second click. See the confirm panel at the foot of the form. Which
   *  button opened it decides what the confirm button does: file the
   *  whole sheet, or save what is done and leave the rest open. */
  const [confirming, setConfirming] = useState<null | 'file' | 'save'>(null)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<{
    /** Something here is the agent's to act on. */
    changedOrder: boolean
    /** The order's own lines actually moved — a rewritten line, or a
     *  row the warehouse wrote in that became one. */
    orderLinesChanged: boolean
    changes: string[]
    /** Lines this filing put ON the order (2026-09-14). */
    added: Array<{ description: string; quantity: number; rate: number | null; unpriced: boolean }>
    /** How many of those have no price, and so are holding the invoice. */
    unpriced: number
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
    /** The name this pass went under and how many lines it counted. */
    passBy: string | null
    countedThisPass: number
  } | null>(null)

  const patch = (id: string, next: Partial<Row>) =>
    setRows((prev) => prev.map((r) => (r.orderLineItemId === id ? { ...r, ...next } : r)))

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
        // Every scan of this line withdrawn → back to where it started:
        // uncounted on a fresh sheet, pre-filled on a filed one.
        if (after === null) {
          // Judged on the line as it was FILED — every row is on the sheet
          // once the form opens, including the ones an earlier pass left.
          const counted = startsCounted(draftById.get(r.orderLineItemId) ?? r)
          return { ...r, actualQty: counted ? r.expectedQty : 0, counted, note, open }
        }
        return { ...r, actualQty: after, counted: true, onSheet: true, note, open }
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
      // A line left off this pull — or one nobody has counted yet — says
      // nothing about itself. It is not a change, it is a line that has
      // not happened yet.
      if (!r.onSheet || !r.counted) continue
      const change = classifyCheckLine(r)
      if (change === 'NONE') continue
      // A difference an earlier pass already filed and flagged — on a
      // check-in, a short case stays "different" for ever, because IN
      // never rewrites the order. The person finishing the sheet did not
      // count it and is not the one to read it back.
      const d = draftById.get(r.orderLineItemId)
      out.push({
        key: r.orderLineItemId, text: describeCheckChange(r, change), added: false,
        alreadyFiled: !!draft.filed && !!d && sameCount(
          { ...d, countedById: null, countedAt: null }, r,
        ),
      })
    }
    for (const e of extras) {
      const description = e.description.trim()
      if (!description) continue
      out.push({
        key: e.key,
        text: describeCheckChange({
          orderLineItemId: null, description, expectedQty: 0, actualQty: e.actualQty,
        }),
        added: true,
        // Untouched since it was filed → already on the report and
        // already in front of the agent. Not outstanding work.
        alreadyFiled:
          !!e.filedAs && e.filedAs.description === description && e.filedAs.actualQty === e.actualQty,
      })
    }
    return out
  }, [rows, extras, draft.filed, draftById])
  /** Outstanding work — what filing would actually change. An addition
   *  the last submission already recorded is NOT outstanding: it cannot
   *  be reconciled against the order by design, so counting it here is
   *  what made the report re-demand a read-back forever. */
  const diffs = changeList.filter((c) => !c.alreadyFiled).length
  const pendingAdditions = changeList.filter((c) => c.alreadyFiled && c.added)
  /** Of the outstanding work, what would actually rewrite the order.
   *  Additions never do — so a sheet whose only difference is an added
   *  row must not promise the client a corrected quote. */
  const orderLineDiffs = changeList.filter((c) => !c.added && !c.alreadyFiled).length

  /**
   * The kit double-check (Wes, 2026-09-13, after two walkie orders in one
   * week went out with no antennas). The catalog knows an antenna and a
   * battery ride with every radio and a charger with every twelve; this
   * compares that against the numbers being typed, live.
   *
   * OUT only, deliberately. On the way out a short companion means the
   * truck leaves incomplete and the crew is stuck on location. On the way
   * back a line that came up short already classifies as SHORT and
   * reaches the agent, and a staggered return is ordinary — flagging it
   * again here would be noise on the one edge where it changes nothing.
   */
  const shortfalls = useMemo(() => {
    if (!isOut || draft.kitExpectations.length === 0) return []
    const counted: CountedQuantities = {}
    for (const r of rows) counted[r.orderLineItemId] = r.onSheet && r.counted ? r.actualQty : null
    return kitShortfalls(draft.kitExpectations, counted)
  }, [isOut, draft.kitExpectations, rows])
  /** Lines the desk has to add — the yard cannot fix these from here. */
  const missingFromOrder = shortfalls.filter((s) => s.missingFromOrder)

  /**
   * The partial pull (Wes, 2026-09-04: "we should have the ability to
   * send a partial pick list"). Ticking a line off this sheet is the
   * same gesture twice over: it is left off the printed paper, and it
   * is left out of the count when the paper comes back. Which is the
   * point — the alternative was typing a zero, and a zero here means
   * "the client didn't get it", which rewrites the order and emails
   * them a smaller quote.
   */
  /** Written-in rows with no catalog item behind them — each becomes an
   *  unpriced order line that holds the invoice. */
  const unnamedExtras = extras.filter((e) => e.description.trim() && !e.inventoryItemId).length

  const offSheet = rows.filter((r) => !r.onSheet && !isFleetLine(r))
  const onSheetIds = rows.filter((r) => r.onSheet && !isFleetLine(r)).map((r) => r.orderLineItemId)
  /**
   * Lines nobody can pull from as written — a bundle with no piece count
   * ("10' x 10' Pop-Ups with Sides"), or a line booked against a catalog
   * row that is a different thing. Said on the sheet because this is the
   * last screen before the truck leaves; fixing it is the agent's, since
   * the line carries a rate the client agreed to.
   */
  const pullGaps = useMemo(() => {
    const all = draft.lines.map((l) => ({
      description: l.description,
      quantity: l.expectedQty,
      catalogName: l.catalogName,
    }))
    const out = new Map<string, PullGap[]>()
    draft.lines.forEach((l, i) => {
      const gaps = pullGapsForLine(all[i], all)
      if (gaps.length) out.set(l.orderLineItemId, gaps)
    })
    return out
  }, [draft.lines])

  /** On this pull and still without a count — the sheet cannot file.
   *  Vehicles are never in here: they are the driver's check-out. */
  const uncounted = rows.filter((r) => r.onSheet && !r.counted && !isFleetLine(r))
  const countedRows = rows.filter((r) => r.onSheet && r.counted && !isFleetLine(r)).length
  /** Pieces that came back broken. Not a count difference — see the Dmg
   *  box below — so nothing else on this screen would mention it. */
  const damagedUnits = isOut
    ? 0
    : rows.reduce((n, r) => (r.onSheet && r.counted ? n + (r.damagedQty || 0) : n), 0)
  /** The one-tap day: everything came off the shelf exactly as ordered. */
  const countEverything = () =>
    setRows((prev) =>
      prev.map((r) => (r.onSheet && !r.counted ? { ...r, counted: true, actualQty: r.expectedQty } : r)),
    )
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
  const leftIds = rows
    .filter((r) => !isFleetLine(r) && (!r.onSheet || (leftByEarlierPass.has(r.orderLineItemId) && !r.counted)))
    .map((r) => r.orderLineItemId)
  const pickedUpWhereWeLeftOff = leftByEarlierPass.size > 0 && leftIds.length > 0
  const printIds = pickedUpWhereWeLeftOff ? leftIds : onSheetIds
  /** Only the added gear is outstanding → say so. A sheet of just the
   *  new lines IS the "as if it were a new order" pull. */
  const addedOnlyRemainder = !draft.filed?.partial && addedToPull > 0
  const sheetLabel = pickedUpWhereWeLeftOff
    ? addedOnlyRemainder
      ? `Print the ${leftIds.length} added line${leftIds.length === 1 ? '' : 's'}`
      : `Print what's left (${leftIds.length})`
    : offSheet.length
      ? `Print these ${onSheetIds.length} line${onSheetIds.length === 1 ? '' : 's'}`
      : 'Print a fresh sheet'
  const sheetHref = offSheet.length || pickedUpWhereWeLeftOff
    ? `/api/orders/${draft.orderId}/pick-list-pdf?lines=${printIds.join(',')}`
    : `/api/orders/${draft.orderId}/pick-list-pdf`

  // Any edit reopens the question. Without this, a supervisor who hits
  // File, spots a wrong digit in the read-back, fixes it behind the panel
  // and clicks the confirm button would be confirming a list they never
  // actually read.
  useEffect(() => { setConfirming(null) }, [rows, extras])

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
            actualQty: hit.actualQty,
            // Somebody wrote a number on the paper — that is a count.
            counted: true,
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
              // Read off handwriting — nobody named a catalog row, so the
              // line it becomes lands unpriced until someone does.
              inventoryItemId: null,
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

  /**
   * `saveProgress`: the person has done part of the sheet and has to go.
   * Every line still uncounted goes up as OFF this sheet — the same
   * "not this pull" the row button says, done for all of them at once —
   * so nothing they did not touch reads as a zero (a zero rewrites the
   * order and emails the client). The report files PARTIAL, settles no
   * gear, and the next person opens it where this one stopped.
   */
  async function submit(saveProgress = false, rowsOverride?: Row[]) {
    if (nameMissing) {
      setError(`Put your name in first — every ${isOut ? 'pull' : 'check-in'} is filed under who did it.`)
      return
    }
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/orders/${draft.orderId}/check-report`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          edge: draft.edge,
          preppedBy: preppedBy.trim(),
          notes,
          sheetPhotoKey: photo?.key ?? null,
          sheetPhotoUrl: photo?.url ?? null,
          lines: [
            // The override is how "Everything came back" files in one tap
            // without waiting a render for the counts it just set.
            ...(rowsOverride ?? rows).map((r) => ({
              orderLineItemId: r.orderLineItemId,
              description: r.description,
              actualQty: r.actualQty,
              // Came back broken. Server-clamped to what came back.
              damagedQty: isOut ? 0 : r.damagedQty,
              substituteFor: (r.substituteFor ?? '').trim() || null,
              note: (r.note ?? '').trim() || null,
              // A vehicle is never "left on the shelf for a later pull" —
              // off-sheet is what makes a report PARTIAL, and a partial
              // report settles no gear at all.
              onSheet: isFleetLine(r) ? true : r.onSheet && (r.counted || !saveProgress),
            })),
            ...extras
              .filter((e) => e.description.trim())
              .map((e) => ({
                orderLineItemId: null,
                inventoryItemId: e.inventoryItemId,
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
        added: data.added ?? [],
        unpriced: data.unpriced ?? 0,
        changes: data.changes ?? [],
        resend: data.resend ?? null,
        gear: data.gear ?? null,
        partial: !!data.partial,
        offSheet: data.offSheet ?? 0,
        passBy: data.passBy ?? null,
        countedThisPass: data.countedThisPass ?? 0,
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
            {done.partial
              ? `Saved — ${done.offSheet} line${done.offSheet === 1 ? '' : 's'} still to ${isOut ? 'pull' : 'count'}`
              : isOut ? 'Check-out report filed' : 'Check-in report filed'}
          </h1>
          {/* Print, right under the check mark (Wes 2026-09-16, from the
              warehouse: "can there also be a print option on that screen,
              so they can give the driver their order / check out contract
              receipt"). It was at the bottom of this card, under every
              message, and nobody found it. */}
          {isOut && (
            <a
              href={`/api/orders/${draft.orderId}/pick-list-pdf?receipt=1`}
              target="_blank"
              rel="noreferrer"
              className="mx-auto mt-2 mb-3 inline-flex min-h-[52px] items-center justify-center gap-2 rounded-xl bg-amber-600 px-6 text-[16px] font-bold text-white hover:bg-amber-500"
            >
              <Printer size={18} aria-hidden />
              Print driver receipt
            </a>
          )}
          {done.passBy && done.countedThisPass > 0 && (
            <p className="text-lt-fg2 text-[14px] mb-2">
              {done.countedThisPass} line{done.countedThisPass === 1 ? '' : 's'} credited to <b className="text-lt-fg">{done.passBy}</b>.
            </p>
          )}
          {done.changedOrder || done.added.length > 0 ? (
            <>
              <p className="text-lt-fg2 text-[15px] max-w-[52ch] mx-auto">
                {!done.changedOrder
                  ? 'The added gear is on the order.'
                  : done.orderLinesChanged
                  ? `The order has been updated and ${draft.agentName || 'the agent'} has been flagged to review what changed.`
                  : `${draft.agentName || 'The agent'} has been flagged to review what went out.`}
              </p>
              <ul className="mt-3 text-[14px] text-chip-warn-fg space-y-0.5">
                {done.changes.map((c, i) => <li key={i}>{c}</li>)}
              </ul>
              {/* What went ON the order, and at what price. A supervisor
                  who has just changed what a client is billed should be
                  told so in numbers, not left to infer it. */}
              {done.added.length > 0 && (
                <div className="mt-3 text-[14px]">
                  <p className="text-lt-fg2">
                    {done.added.length === 1 ? 'One row is' : `${done.added.length} rows are`} now on
                    the order:
                  </p>
                  <ul className="mt-1 space-y-0.5">
                    {done.added.map((a, i) => (
                      <li key={i} className={a.unpriced ? 'text-chip-bad-fg font-semibold' : 'text-lt-fg'}>
                        {a.quantity}× {a.description} —{' '}
                        {a.unpriced
                          ? 'no price yet'
                          : `$${a.rate?.toLocaleString('en-US')} ea.`}
                      </li>
                    ))}
                  </ul>
                  {done.unpriced > 0 && (
                    <p className="mt-1.5 text-[13px] text-chip-bad-fg">
                      The order cannot be invoiced until {draft.agentName || 'the agent'} prices{' '}
                      {done.unpriced === 1 ? 'that line' : `those ${done.unpriced} lines`} — that is
                      deliberate, so nothing goes out billed at zero.
                    </p>
                  )}
                </div>
              )}
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
                : damagedUnits > 0
                  ? `Every piece came back, ${damagedUnits} of them damaged.`
                  : 'Everything came back as expected.'}
            </p>
          )}
          {/* Filing the inbound sheet is what closes the gear lane —
              say so, because the next question a supervisor has is
              whether anyone still has to mark the job returned. */}
          {done.partial && (
            <p className="mt-3 text-[14px] text-pill-quoted-fg max-w-[56ch] mx-auto">
              The lines nobody counted are untouched on the order, and the job stays open on the
              board. Whoever picks it up opens this same sheet — what&rsquo;s done shows who did it,
              and what&rsquo;s left is waiting to be counted.
            </p>
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

          {/* The report Albert sends (Wes, 2026-09-18). It is the last
              step of a check-in and belongs on the screen that just
              finished one — not on a list somebody has to go back to.
              Offered on a partial only as an explanation, because a
              half-counted order has nothing to report yet. */}
          {!isOut && (
            <div className="mt-5 flex flex-col items-center gap-1">
              <SendCheckInReportButton
                orderId={draft.orderId}
                blockedReason={
                  done.partial
                    ? `${done.offSheet} line${done.offSheet === 1 ? '' : 's'} still to count — the report goes out once the whole order has been counted back in.`
                    : null
                }
              />
              {!done.partial && (
                <p className="text-[13px] text-lt-fg3 max-w-[52ch]">
                  Goes to billing, the office and {draft.agentName || 'the agent'} — what came back,
                  what didn&rsquo;t, and what came back broken. Nothing is billed by it.
                </p>
              )}
            </div>
          )}

          {/* The driver's receipt (Oliver, 2026-09-13: "they don't have
              the ability to print the pick list with the completed
              quantities to give to the driver. This is an important
              feature, as it's the driver's receipt").

              First action and primary on the OUT edge, because this is
              the moment it is needed: the counts are in, the truck is
              loading, and the driver is standing there. It prints from
              the sheet that was just filed, so a swap or a shortfall
              reads as Ordered vs Went out — none of the staff-only
              "the warehouse changed this" flagging goes on the paper.

              Not offered on the IN edge: a check-in is a count of what
              came back, and nobody is driving away with it. */}
          <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
            {/* The receipt button sits under the check mark now; a second
                copy here was the one nobody scrolled down to. */}
            <Link
              href="/reports/orders"
              className={`text-[13px] px-3 py-2 rounded-lg ${
                isOut
                  ? 'font-semibold border border-lt-hairline text-lt-fg2 hover:bg-lt-inner'
                  : 'font-bold bg-amber-600 hover:bg-chip-warn-bg0 text-white'
              }`}
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

  /**
   * The one-tap return: every gear line back whole, nothing damaged.
   *
   * The counts are handed straight to submit rather than set on state
   * first — a setRows followed by a submit in the same handler files the
   * PREVIOUS render's rows, which on a fresh sheet is every line at zero.
   * That is not a cosmetic bug: zeros on an inbound sheet are gear that
   * did not come home.
   */
  function fileEverythingBack() {
    submit(
      false,
      rows.map((r) =>
        r.onSheet && !isFleetLine(r) ? { ...r, counted: true, actualQty: r.expectedQty, damagedQty: 0 } : r,
      ),
    )
  }

  // ── Begin Check In ────────────────────────────────────────────────
  // The door in front of a fresh inbound sheet. See `begun` above for why
  // it exists; a sheet already on file goes straight through, because
  // re-opening one is a correction.
  if (!isOut && !draft.filed && !begun) {
    const gate = draft.checkIn
    const blocked = !!gate && !gate.ready && !gateOverridden
    const countable = rows.filter((r) => !isFleetLine(r)).length
    const fleet = rows.length - countable
    return (
      <div className="max-w-2xl mx-auto px-1 py-2">
        <Link
          href="/reports/orders"
          className="inline-flex items-center gap-1.5 text-[13px] text-lt-fg2 hover:text-amber-600 mb-3"
        >
          <ArrowLeft size={13} aria-hidden />
          All reports
        </Link>

        <div className="border border-lt-hairline bg-lt-card rounded-xl p-5">
          <div className="text-amber-600 text-[13px] font-semibold uppercase tracking-wide mb-1">Check in</div>
          <h1 className="text-lt-fg text-2xl font-bold">{draft.jobName}</h1>
          <p className="text-lt-fg2 text-[15px] mt-0.5">
            <span className="font-mono">{draft.orderNumber}</span>
            <span> · {draft.company}</span>
            <span> · due back {fmtDay(draft.endDate)}</span>
          </p>

          {/* What the count will be made against — the sheet it went out
              on, not the order as it was quoted. */}
          <p className="text-lt-fg2 text-[14px] mt-3">
            {countable} line{countable === 1 ? '' : 's'} to count
            {fleet > 0 && (
              <span className="text-lt-fg3">
                {' '}· {fleet} vehicle{fleet === 1 ? '' : 's'} come back through the yard walk-around
              </span>
            )}
            {draft.outSheet && (
              <span className="text-lt-fg3">
                {' '}· went out {fmtWhen(draft.outSheet.submittedAt)}
                {draft.outSheet.preppedBy ? `, pulled by ${draft.outSheet.preppedBy}` : ''}
              </span>
            )}
          </p>

          {/* Not a wall: the reason is stated and the way through says
              what the person is asserting. See lib/orders/checkInReady.ts. */}
          {blocked && gate && (
            <div className="mt-4 border border-chip-warn-fg/30 bg-chip-warn-bg rounded-lg px-3 py-3">
              <p className="text-chip-warn-fg text-[15px] font-semibold flex items-start gap-2">
                <AlertTriangle size={16} aria-hidden className="flex-none mt-0.5" />
                <span>{gate.reason}</span>
              </p>
              <button
                type="button"
                onClick={() => setGateOverridden(true)}
                className="mt-2 text-[13px] font-semibold text-lt-fg2 hover:text-amber-600 border border-lt-hairline bg-lt-card rounded-lg px-3 py-1.5"
              >
                {gate.override}
              </button>
            </div>
          )}
          {gateOverridden && gate && !gate.ready && (
            <p className="mt-3 text-[13px] text-lt-fg3">{gate.override} — go ahead.</p>
          )}

          {/* The name, before either button. Every check-in is filed under
              whoever did it (Wes, 2026-09-15), and asking here means the
              one-tap return is still one tap for the person who typed it. */}
          <label className="block mt-4">
            <span className="text-[12px] uppercase tracking-wide text-lt-fg2 font-semibold">
              Who counted it back in
            </span>
            <input
              value={preppedBy}
              onChange={(e) => setPreppedBy(e.target.value)}
              placeholder="Name"
              className={`mt-1 w-full bg-lt-inner border rounded-lg px-3 py-2 text-[16px] text-lt-fg placeholder:text-lt-fg3 ${
                nameMissing ? 'border-chip-warn-fg/50' : 'border-lt-hairline'
              }`}
            />
          </label>
          {/* The floor crew, one tap each — same row as the sheet's. */}
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {[...WAREHOUSE_CREW, ...WALKAROUND_CREW].map((name) => (
              <button
                key={name}
                type="button"
                onClick={() => setPreppedBy(name)}
                className={`min-h-[40px] rounded-lg border px-3 text-[14px] font-medium ${
                  preppedBy.trim() === name
                    ? 'border-amber-600 bg-chip-warn-bg text-lt-fg'
                    : 'border-lt-hairline bg-lt-inner text-lt-fg2 hover:text-lt-fg'
                }`}
              >
                {name}
              </button>
            ))}
          </div>
          {nameMissing && viewerName && (
            <button
              type="button"
              onClick={() => setPreppedBy(viewerName)}
              className="mt-1.5 text-[13px] font-semibold text-lt-fg2 hover:text-amber-600"
            >
              That&rsquo;s me — {viewerName}
            </button>
          )}

          {error && (
            <p className="mt-3 text-[14px] text-chip-bad-fg border border-chip-bad-fg/30 bg-chip-bad-bg rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          {/* The two things that actually happen. Both are real filings —
              the clean one is not a shortcut around the record, it is the
              record with every line counted whole. */}
          <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-2">
            <button
              type="button"
              disabled={blocked || saving || nameMissing || countable === 0}
              onClick={fileEverythingBack}
              className="min-h-[60px] rounded-xl bg-amber-600 hover:bg-amber-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-[17px] font-bold inline-flex flex-col items-center justify-center"
            >
              {saving ? 'Filing…' : '100% returned'}
              <span className="text-[12px] font-semibold text-white/80">
                Everything came back, nothing damaged
              </span>
            </button>
            <button
              type="button"
              disabled={blocked || saving}
              onClick={() => setBegun(true)}
              className="min-h-[60px] rounded-xl border-2 border-chip-warn-fg/40 bg-chip-warn-bg hover:border-chip-warn-fg disabled:opacity-40 disabled:cursor-not-allowed text-chip-warn-fg text-[17px] font-bold inline-flex flex-col items-center justify-center"
            >
              L&amp;D
              <span className="text-[12px] font-semibold text-chip-warn-fg/80">
                Something is missing or damaged
              </span>
            </button>
          </div>
          <p className="mt-3 text-[13px] text-lt-fg3">
            L&amp;D opens the sheet this order went out on — every line, the extras the warehouse
            added at the truck included — and asks how many came back and how many of those are
            broken. {countable === 0 && 'Nothing on this order is warehouse gear, so there is nothing to count.'}
          </p>
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
        {/* A finished sheet with gear added under it is the miss this
            screen shipped with: the added lines used to read exactly like
            the ones the crew counted (Wes, 2026-09-18). It is the first
            thing the banner says now. */}
        {addedToPull > 0 && (
          <p className="text-[13px] text-chip-warn-fg mt-2 border border-chip-warn-fg/30 bg-chip-warn-bg rounded-lg px-3 py-2">
            <b>
              {addedToPull} line{addedToPull === 1 ? '' : 's'}{' '}
              {addedToPull === 1 ? 'was' : 'were'} added to this order after the sheet was filed.
            </b>{' '}
            {addedToPull === 1 ? 'It has' : 'They have'} not been {isOut ? 'pulled' : 'counted'} —{' '}
            {addedToPull === 1 ? 'it is' : "they're"} below with{' '}
            {addedToPull === 1 ? 'an empty count' : 'empty counts'}. Print{' '}
            {addedToPull === 1 ? 'it' : 'them'} and {isOut ? 'pull' : 'count'}{' '}
            {addedToPull === 1 ? 'it' : 'them'} like a new order.
          </p>
        )}
        {draft.filed && (
          <div className="text-[13px] text-lt-fg2 mt-2 border border-lt-hairline bg-lt-card rounded-lg px-3 py-2">
            {draft.filed.partial ? (
              <p>
                <b className="text-lt-fg">Started, not finished.</b> {leftByEarlierPass.size} line
                {leftByEarlierPass.size === 1 ? ' is' : 's are'} still to {isOut ? 'pull' : 'count'} —
                they&rsquo;re below with empty counts. Lines already done keep the name of whoever
                counted them; anything you count or change is credited to you.
              </p>
            ) : (
              <p>
                Filed {new Date(draft.filed.submittedAt).toLocaleString('en-US')}. Submitting again
                replaces it — lines you leave as they are keep who counted them.
              </p>
            )}
            {draft.filed.passes.length > 0 && (
              <ul className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5">
                {draft.filed.passes.map((p) => (
                  <li key={p.name}>
                    <b className="text-lt-fg">{p.name}</b> · {p.lines} line{p.lines === 1 ? '' : 's'}
                    {p.at ? ` · ${fmtWhen(p.at)}` : ''}
                  </li>
                ))}
              </ul>
            )}
          </div>
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
          {/* Reprinting the driver's copy after the fact — a lost
              receipt, a second driver, a supervisor who filed it and
              then found the printer empty. Only on OUT, and only once a
              sheet is on file: the counts are the document. */}
          {isOut && draft.filed && (
            <a
              href={`/api/orders/${draft.orderId}/pick-list-pdf?receipt=1`}
              target="_blank"
              rel="noreferrer"
              className="text-[13px] font-semibold text-lt-fg2 hover:text-amber-600 inline-flex items-center gap-1.5"
            >
              <Printer size={14} aria-hidden />
              Driver&rsquo;s copy
            </a>
          )}
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

      {/* Who is doing THIS pass — the name the lines counted now are
          credited to. Empty on a re-open on purpose: the person picking
          up the rest is usually not the person who started. */}
      <div className="mb-4">
        <label className="block">
          <span className="text-[12px] uppercase tracking-wide text-lt-fg2 font-semibold">
            {draft.filed ? 'Who is counting now' : isOut ? 'Pulled & loaded by' : 'Checked in by'}
            <span className="text-chip-bad-fg"> *</span>
          </span>
          <input
            value={preppedBy}
            onChange={(e) => setPreppedBy(e.target.value)}
            required
            aria-required="true"
            placeholder="Your name — required"
            className={`mt-1 w-full bg-lt-inner border rounded-lg px-3 py-2 text-[15px] text-lt-fg placeholder:text-lt-fg3 ${
              nameMissing ? 'border-dashed border-lt-fg3' : 'border-lt-hairline'
            }`}
          />
        </label>
        {/* The floor crew, one tap each (Wes 2026-09-16) — never a silent
            default from the login. */}
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {[...WAREHOUSE_CREW, ...WALKAROUND_CREW].map((name) => (
            <button
              key={name}
              type="button"
              onClick={() => setPreppedBy(name)}
              className={`min-h-[40px] rounded-lg border px-3 text-[14px] font-medium ${
                preppedBy.trim() === name
                  ? 'border-amber-600 bg-chip-warn-bg text-lt-fg'
                  : 'border-lt-hairline bg-lt-inner text-lt-fg2 hover:border-lt-fg3'
              }`}
            >
              {name}
            </button>
          ))}
        </div>
        {/* One tap for the common case, never a silent default: the
            floor terminal is signed in as whoever used it last. */}
        {nameMissing && viewerName && (
          <button
            type="button"
            onClick={() => setPreppedBy(viewerName)}
            className="mt-1.5 text-[13px] font-semibold text-lt-fg2 hover:text-amber-600"
          >
            That&rsquo;s me — {viewerName}
          </button>
        )}
      </div>

      {/* Last-minute extras the driver asks for — straight onto the order,
          without filing the sheet again (Wes 2026-09-16). */}
      {isOut && (
        <CheckoutAddOnsCard orderId={draft.orderId} orderNumber={draft.orderNumber} tone="light" />
      )}

      {unitScans && (
        <UnitScanPanel
          orderId={draft.orderId}
          edge={draft.edge}
          trackedLines={trackedLines}
          summary={unitScans}
          onSummary={applySummary}
          initialCode={initialScan}
        />
      )}

      <div className="border border-lt-hairline bg-lt-card rounded-xl overflow-hidden mb-4">
        <div className="px-3 py-2 bg-lt-inner border-b border-lt-hairline flex items-center justify-between">
          <span className="text-[12px] uppercase tracking-wide text-lt-fg2 font-semibold">
            {isOut ? 'What actually went out' : 'What actually came back'}
          </span>
          <div className="flex items-center gap-2">
            <span className="text-[12px] text-lt-fg3">
              {`${countedRows} of ${onSheetIds.length} lines counted`}
              {offSheet.length ? ` · ${offSheet.length} ${isOut ? 'off this pull' : 'still out'}` : ''}
            </span>
            {/* Hugo's day: the whole sheet came off the shelf as written,
                or the whole truck came back. Still a deliberate tap, so
                nothing is counted by default. */}
            {uncounted.length > 0 && (
              <button
                type="button"
                onClick={countEverything}
                className="text-[12px] font-semibold text-lt-fg2 hover:text-amber-600 border border-lt-hairline rounded-lg px-2.5 py-1"
              >
                {isOut ? 'Everything as ordered' : 'Everything came back'}
              </button>
            )}
          </div>
        </div>

        {rows.length === 0 && (
          <p className="px-3 py-6 text-center text-[15px] text-lt-fg3">This order has no line items.</p>
        )}

        {/* Every line is a vehicle: there is nothing here for the floor to
            count, and saying so beats an empty-looking sheet with a live
            File button under it. */}
        {rows.length > 0 && onSheetIds.length === 0 && offSheet.length === 0 && (
          <p className="px-3 py-4 text-center text-[15px] text-lt-fg3">
            Nothing on this order is warehouse gear — the {isOut ? 'vehicle leaves on the driver’s check-out' : 'vehicle comes back through the yard walk-around'}.
          </p>
        )}

        {rows.map((r) => {
          const differs =
            r.onSheet && r.counted && (r.actualQty !== r.expectedQty || !!(r.substituteFor ?? '').trim())
          // Three of three back and one of them crushed is not a
          // difference in the count — and it is absolutely something the
          // billing desk has to see. The row colours on it either way.
          const damaged = !isOut && r.onSheet && r.counted && r.damagedQty > 0
          // Nobody has counted this line yet. The box reads zero because
          // that is what has been handled so far, NOT because the client
          // is losing the line or the gear is missing (Wes, 2026-09-14).
          const awaiting = r.onSheet && !r.counted
          // Counted on an earlier pass and not touched on this one — so it
          // still belongs to whoever counted it. Edit it and it is yours,
          // which is exactly what the server will record.
          const d = draftById.get(r.orderLineItemId)
          const carriedBy =
            !awaiting && d?.countedBy && sameCount({ ...d, countedById: null, countedAt: null }, r)
              ? { name: d.countedBy, at: d.countedAt }
              : null
          // The truck. Shown so the floor knows what else is leaving with
          // this order, with no count box and no controls — typing a
          // number here would be the warehouse signing for a walk-around
          // it did not do.
          if (isFleetLine(r)) {
            return (
              <div
                key={r.orderLineItemId}
                className="px-3 py-2.5 border-b border-lt-hairline last:border-b-0 bg-lt-inner flex items-center gap-3"
              >
                <div className="min-w-0 flex-1">
                  <div className="text-lt-fg2 text-[16px] font-medium truncate">{r.description}</div>
                  <div className="text-lt-fg3 text-[13px] truncate">
                    {r.qualifier && <span>{r.qualifier} · </span>}
                    ordered {r.expectedQty} · {isOut
                      ? 'goes out on the driver’s check-out, not this sheet'
                      : 'comes back through the yard walk-around, not this sheet'}
                  </div>
                </div>
                <span className="flex-none text-[12px] font-semibold px-2 py-1 rounded bg-chip-neutral-bg text-chip-neutral-fg">
                  vehicle
                </span>
              </div>
            )
          }
          // A line held back for a later pull: dimmed, no count, and no
          // controls that would imply something happened to it.
          if (!r.onSheet) {
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
              className={`px-3 py-2.5 border-b border-lt-hairline last:border-b-0 ${differs || damaged ? 'bg-chip-warn-bg' : ''}`}
            >
              <div className="flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <div className="text-lt-fg text-[16px] font-medium truncate">{r.description}</div>
                  <div className="text-lt-fg2 text-[13px] truncate">
                    {r.qualifier && <span>{r.qualifier} · </span>}
                    {awaiting ? (
                      <span className="text-lt-fg3">
                        {r.addedAfterPull
                          ? `added after the sheet was filed · ${isOut ? 'not pulled yet' : 'not counted yet'}`
                          : isOut
                            ? 'not pulled yet'
                            : 'not counted yet'}
                      </span>
                    ) : carriedBy ? (
                      <span>
                        counted by <b className="font-semibold text-lt-fg">{carriedBy.name}</b>
                        {carriedBy.at ? ` · ${fmtWhen(carriedBy.at)}` : ''}
                      </span>
                    ) : (
                      <span>counted</span>
                    )}
                    {r.lane && <span className="text-lt-fg3"> · {r.lane.toLowerCase()}</span>}
                    {/* The count is made against the sheet the gear left
                        on, not against the order as it was quoted (Wes,
                        2026-09-18). A line the check-out never counted
                        says so — nothing went, so nothing is owed back. */}
                    {!isOut && draft.outSheet && (
                      <span className="text-lt-fg3">
                        {' '}· {r.outQty === null ? 'not on the check-out' : `${r.outQty} went out`}
                      </span>
                    )}
                    {!isOut && r.addedAtCheckOut && (
                      <span className="ml-1.5 text-[11px] font-semibold uppercase tracking-wider text-pill-quoted-fg border border-pill-quoted-fg/25 bg-pill-quoted-bg rounded px-1.5 py-0.5">
                        Added at the truck
                      </span>
                    )}
                  </div>
                  {/* Nobody can pull "2 pop-ups with sides" — say what is
                      missing where the count is being typed, not on a
                      screen the floor never opens. */}
                  {(pullGaps.get(r.orderLineItemId) ?? []).map((g, i) => (
                    <div
                      key={i}
                      className="mt-1 text-[13px] text-chip-warn-fg bg-chip-warn-bg border border-chip-warn-fg/25 rounded px-2 py-1 flex items-start gap-1.5"
                    >
                      <AlertTriangle size={13} aria-hidden className="flex-none mt-0.5" />
                      <span>{g.message}</span>
                    </div>
                  ))}

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
                {/* The count, with the number they are pulling TO right
                    beside it: "OUT [ 0 ] of 3". Wes, 2026-09-14 — the
                    ordered quantity used to sit in the grey sub-line
                    while the box itself was already filled in with it. */}
                <label className="flex items-center gap-1.5 flex-none">
                  <span className="text-[12px] text-lt-fg3 uppercase tracking-wide">
                    {isOut ? 'Out' : 'In'}
                  </span>
                  <input
                    type="number"
                    min={0}
                    inputMode="numeric"
                    value={r.actualQty}
                    onChange={(e) =>
                      patch(r.orderLineItemId, {
                        actualQty: Math.max(0, Number(e.target.value) || 0),
                        // Typing IS counting — including typing a zero,
                        // which is how "the client didn't get it" is said.
                        counted: true,
                      })
                    }
                    className={`w-20 text-center border rounded-lg px-2 py-1.5 text-[16px] ${
                      differs
                        ? 'border-amber-500 bg-lt-inner text-lt-fg'
                        : awaiting
                          // Uncounted, not disabled. The DASHED border is
                          // what says nobody has counted this line — the
                          // zero itself stays full-strength, because a
                          // greyed-out number reads as a field you are not
                          // allowed to touch (Wes, 2026-09-14).
                          ? 'border-dashed border-lt-fg3 bg-lt-inner text-lt-fg'
                          : 'border-lt-hairline bg-lt-inner text-lt-fg'
                    }`}
                  />
                  <span className="text-[13px] text-lt-fg2 whitespace-nowrap">of {r.expectedQty}</span>
                </label>
                {/* Of the ones that came back, how many are broken.
                    Wes, 2026-09-18: *"note damaged or lost and how many
                    were lost. Maybe it's better just to say how many were
                    returned."* Both, in the end — and this is why: what
                    came back is one number and what came back BROKEN is
                    another, because a crushed case is on the shelf. Take
                    it out of the returned count and the client is billed
                    to replace gear we are holding; leave it out
                    altogether and nobody is billed for a light that can
                    never go out again. Shown only once the line has been
                    counted, so an untouched row stays one number wide. */}
                {!isOut && r.counted && (
                  <label className="flex items-center gap-1.5 flex-none">
                    <span className="text-[12px] text-lt-fg3 uppercase tracking-wide">Dmg</span>
                    <input
                      type="number"
                      min={0}
                      max={r.actualQty}
                      inputMode="numeric"
                      value={r.damagedQty}
                      onChange={(e) => {
                        // Never more than came back: a damaged one is a
                        // returned one. The server clamps this too.
                        const next = Math.max(0, Math.min(Number(e.target.value) || 0, r.actualQty))
                        patch(r.orderLineItemId, {
                          damagedQty: next,
                          // The first damaged unit opens the note — what
                          // is wrong with it is the thing Ana will ask.
                          open: r.damagedQty === 0 && next > 0 ? true : r.open,
                        })
                      }}
                      className={`w-16 text-center border rounded-lg px-2 py-1.5 text-[16px] ${
                        r.damagedQty > 0
                          ? 'border-chip-bad-fg/60 bg-chip-bad-bg text-chip-bad-fg font-semibold'
                          : 'border-lt-hairline bg-lt-inner text-lt-fg'
                      }`}
                    />
                  </label>
                )}
                {/* This line came off the shelf whole — one tap rather
                    than typing the number that is already on screen. */}
                {awaiting && (
                  <button
                    type="button"
                    onClick={() => patch(r.orderLineItemId, { counted: true, actualQty: r.expectedQty })}
                    className="flex-none text-[12px] font-semibold text-lt-fg2 hover:text-amber-600 border border-lt-hairline rounded-lg px-2.5 py-1.5"
                  >
                    All {r.expectedQty}
                  </button>
                )}
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
                    rewrites the order; this means it hasn't gone yet. */}
                <button
                  type="button"
                  title={isOut ? 'Leave this line off this pull' : 'This line has not come back yet'}
                  onClick={() => patch(r.orderLineItemId, { onSheet: false, open: false })}
                  className="text-[12px] font-semibold text-lt-fg3 hover:text-amber-600 px-2 py-1.5 flex-none"
                >
                  {isOut ? 'Not this pull' : 'Still out'}
                </button>
              </div>

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
            {isOut ? 'Add to the order' : 'Came back, not on the order'}
          </span>
          <span className="text-[12px] text-lt-fg3 ml-2">
            {isOut
              ? 'Pick the exact item and how many — it goes on the order at the client’s rate when you file.'
              : 'Recorded for the agent — a check-in never adds to the order.'}
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
                const listed = extras.some((e) => e.key === `scan-${u.scanId}`)
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
                            {
                              key: `scan-${u.scanId}`,
                              // The scanned unit knows its catalog item, so
                              // the row is already the exact line to add.
                              description: u.catalogName ?? `${name} (${u.barcode})`,
                              inventoryItemId: u.inventoryItemId ?? null,
                              actualQty: 1,
                              note: u.catalogName ? `Unit ${u.barcode}` : '',
                            },
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
          <div key={e.key} className="px-3 py-2.5 border-b border-lt-hairline last:border-b-0 flex items-start gap-2">
            {/* Naming the item off the catalog is what prices the
                order line this row becomes. Free text still files — it
                just lands unpriced and holds the invoice. */}
            <ExtraItemPicker
              value={{ description: e.description, inventoryItemId: e.inventoryItemId }}
              onChange={(next) =>
                setExtras((prev) => prev.map((x, j) => (j === i ? { ...x, ...next } : x)))
              }
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
            setExtras((prev) => [
              ...prev,
              { key: `new-${Date.now()}`, description: '', inventoryItemId: null, actualQty: 1, note: '' },
            ])
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

      {/* Nothing files while a line on this sheet has no count. A blank
          line cannot be submitted as a zero: on the way out a zero
          rewrites the order and emails the client a smaller quote, and
          on the way in it is gear that did not come home. "Nobody has
          counted it yet" is neither. Naming the lines is the point —
          this is the last screen before the truck leaves, and the first
          one after it gets back. */}
      {uncounted.length > 0 && !confirming && (
        <div className="mb-3 rounded-lg border border-pill-quoted-fg/25 bg-pill-quoted-bg px-3 py-2.5">
          <p className="text-[14px] text-pill-quoted-fg">
            <b>
              {uncounted.length === 1
                ? 'One line has no count yet.'
                : `${uncounted.length} lines have no count yet.`}
            </b>{' '}
            {isOut ? (
              <>
                Scan or type what came off the shelf, tap <b>All n</b> on a line that went whole, or
                mark it <b>Not this pull</b>. Use <b>Everything as ordered</b> above if the sheet
                went out exactly as written — or <b>Save what&rsquo;s done</b> below if you have to
                stop and somebody else will finish.
              </>
            ) : (
              <>
                Scan or type what came off the truck, tap <b>All n</b> on a line that came back
                whole, or mark it <b>Still out</b>. Use <b>Everything came back</b> above if the
                whole sheet returned — or <b>Save what&rsquo;s done</b> below if you have to stop.
              </>
            )}
          </p>
          <p className="mt-1.5 text-[13px] text-pill-quoted-fg/80 truncate">
            {uncounted.slice(0, 6).map((r) => r.description).join(' · ')}
            {uncounted.length > 6 ? ` · +${uncounted.length - 6} more` : ''}
          </p>
        </div>
      )}

      {/* A partial pull is the one case where filing does LESS than it
          looks like it does — say so plainly, both because the
          supervisor should know the order is untouched and because
          somebody still has to pull the rest. */}
      {offSheet.length > 0 && !confirming && (
        <p className="mb-3 text-[14px] text-pill-quoted-fg border border-pill-quoted-fg/25 bg-pill-quoted-bg rounded-lg px-3 py-2">
          <b>Partial {isOut ? 'pull' : 'return'}.</b> {offSheet.length} line
          {offSheet.length === 1 ? ' is' : 's are'}{' '}
          {isOut ? 'not on this sheet' : 'still out'} — {isOut ? 'they stay' : 'nothing is'} on the
          order untouched, and this job stays open on the yard board until the rest{' '}
          {isOut ? 'goes out' : 'comes back'}. Re-open this screen for the next{' '}
          {isOut ? 'pull' : 'count'} and it picks up where this one stopped.
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

      {/* ── The kit double-check ─────────────────────────────────────
          Wes, 2026-09-13: "make sure that the walkies, their antennas,
          their batteries, and the spare batteries are all included."
          Said in red and above the change list because it is not a
          difference to review — it is gear that is about to be missing
          on location, and the sheet is the last place anyone looks. */}
      {shortfalls.length > 0 && !confirming && (
        <div className="mb-3 rounded-lg border border-chip-bad-fg/30 bg-chip-bad-bg px-3 py-2.5">
          <p className="text-[14px] text-chip-bad-fg flex items-start gap-2">
            <AlertTriangle size={15} aria-hidden className="flex-none mt-0.5" />
            <span>
              <b>The kit is short.</b> This sheet has{' '}
              {shortfalls.length === 1 ? 'a piece' : `${shortfalls.length} pieces`} that should go
              out with what is being counted:
            </span>
          </p>
          <ul className="mt-2 ml-6 space-y-1">
            {shortfalls.map((s) => (
              <li key={s.key} className="text-[15px] font-medium text-lt-fg">
                {describeShortfall(s)}
              </li>
            ))}
          </ul>
          <p className="mt-2 ml-6 text-[13px] text-chip-bad-fg leading-relaxed">
            {missingFromOrder.length > 0
              ? 'A piece that is not on the order never printed on the sheet, so the floor had nothing to pull — put it on the order, or write it in as an extra row below so at least what went out is recorded. '
              : ''}
            Count the shelf before filing. If it really is going out this way, file it anyway and
            say why in the notes.
          </p>
        </div>
      )}

      {/* Written-in rows that nobody named off the catalog. Said before
          filing, because the supervisor is the last person who can fix
          it cheaply — afterwards it is an agent chasing a rate for gear
          that is already on a job. */}
      {isOut && unnamedExtras > 0 && !confirming && (
        <p className="mb-3 text-[14px] text-chip-bad-fg border border-chip-bad-fg/30 bg-chip-bad-bg rounded-lg px-3 py-2 flex items-start gap-2">
          <AlertTriangle size={15} aria-hidden className="flex-none mt-0.5" />
          <span>
            Pick {unnamedExtras === 1 ? 'the added item' : `the ${unnamedExtras} added items`} from the list
            before filing — added gear goes on the order as the exact catalog item.
          </span>
        </p>
      )}

      {/* Damage is not a count difference, so the banner below would
          never mention it — and a sheet that records a broken light and
          says nothing is a sheet whose consequence nobody sees. */}
      {damagedUnits > 0 && !confirming && (
        <p className="mb-3 text-[14px] text-chip-bad-fg border border-chip-bad-fg/30 bg-chip-bad-bg rounded-lg px-3 py-2 flex items-start gap-2">
          <AlertTriangle size={15} aria-hidden className="flex-none mt-0.5" />
          <span>
            {damagedUnits} piece{damagedUnits === 1 ? '' : 's'} came back damaged. That goes to the
            billing desk as something to look at — it is not billed here, and it does not change
            what was rented. Say what is wrong with {damagedUnits === 1 ? 'it' : 'them'} in the
            line note.
          </span>
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
                : ` The written-in rows go onto the order and ${draft.agentName || 'the agent'} is flagged.`}
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

          {/* Above the change list on purpose: a short kit is the one
              thing here that nobody downstream can put right once the
              truck has gone. */}
          {shortfalls.length > 0 && (
            <>
              <p className="mt-3 text-[13px] font-semibold text-chip-bad-fg">
                Going out short — confirm this is really how it leaves:
              </p>
              <ul className="mt-1 space-y-1">
                {shortfalls.map((s) => (
                  <li key={s.key} className="text-[15px] text-lt-fg font-medium">
                    {s.counted} of {s.expected} {s.pieceDescription} for {describeParents(s)}
                    {s.missingFromOrder ? ' — not on the order' : ''}
                  </li>
                ))}
              </ul>
            </>
          )}

          {changeList.some((c) => !c.added && !c.alreadyFiled) && (
            <>
              <p className="mt-3 text-[13px] font-semibold text-chip-warn-fg">
                {isOut
                  ? 'Written onto the order:'
                  : 'Recorded against the order — the order itself is not changed:'}
              </p>
              <ul className="mt-1 space-y-1">
                {changeList.filter((c) => !c.added && !c.alreadyFiled).map((c) => (
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
                  The written-in rows go onto the order as lines, so the order matches the truck.
                  Anything you named from the catalog prices itself at{' '}
                  {draft.company}&rsquo;s rate; anything you didn&rsquo;t goes on with{' '}
                  <b>no price</b>, which holds the invoice until{' '}
                  {draft.agentName || 'the agent'} sets one.
                </>
              )
            ) : (
              <>
                A check-in never changes what was rented — this is recorded and flagged to{' '}
                {draft.agentName || 'the agent'}, who decides what a shortfall costs.
              </>
            )}
          </p>

          {damagedUnits > 0 && (
            <>
              <p className="mt-3 text-[13px] font-semibold text-chip-bad-fg">
                Came back damaged — on the shelf, but not rentable:
              </p>
              <ul className="mt-1 space-y-1">
                {rows
                  .filter((r) => r.onSheet && r.counted && r.damagedQty > 0)
                  .map((r) => (
                    <li key={r.orderLineItemId} className="text-[15px] text-lt-fg font-medium">
                      {r.damagedQty} × {r.description}
                      {r.note?.trim() ? ` — ${r.note.trim()}` : ''}
                    </li>
                  ))}
              </ul>
            </>
          )}

          {confirming === 'save' && uncounted.length > 0 && (
            <p className="mt-2 text-[13px] text-chip-warn-fg">
              The {uncounted.length} uncounted line{uncounted.length === 1 ? '' : 's'} stay open for
              the next person — nothing is recorded against {uncounted.length === 1 ? 'it' : 'them'}.
            </p>
          )}

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              onClick={() => void submit(confirming === 'save')}
              disabled={saving || nameMissing}
              className="px-4 py-2.5 bg-amber-600 hover:bg-chip-warn-bg0 text-white text-[15px] font-semibold rounded-lg disabled:opacity-50"
            >
              {saving
                ? 'Filing…'
                : confirming === 'save'
                  ? isOut && orderLineDiffs > 0
                    ? 'Yes — save it and update the order'
                    : 'Yes — save what’s done'
                  : isOut
                    ? 'Yes — file it and update the order'
                    : 'Yes — file it'}
            </button>
            <button
              onClick={() => setConfirming(null)}
              disabled={saving}
              className="text-[14px] font-semibold text-lt-fg2 hover:text-lt-fg disabled:opacity-50"
            >
              Go back and fix it
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3 pb-8">
          <button
            onClick={() => {
              // Nothing differs and the kit is complete → nothing to read
              // back. One tap, as before, which is most days.
              if (diffs > 0 || shortfalls.length > 0 || damagedUnits > 0) { setConfirming('file'); return }
              void submit()
            }}
            disabled={saving || uncounted.length > 0 || nameMissing || (isOut && unnamedExtras > 0)}
            className="px-4 py-2.5 bg-amber-600 hover:bg-chip-warn-bg0 text-white text-[15px] font-semibold rounded-lg disabled:opacity-50"
          >
            {saving
              ? 'Filing…'
              : nameMissing
                ? `Add your name to ${uncounted.length > 0 && countedRows > 0 ? 'save or file' : 'file'}`
                : uncounted.length > 0
                ? `${uncounted.length} line${uncounted.length === 1 ? '' : 's'} still to count`
                : shortfalls.length > 0
                  ? 'Review the short kit and file'
                  : diffs > 0
                    ? `Review ${diffs} change${diffs === 1 ? '' : 's'} and file`
                    : draft.filed ? 'Replace the filed report' : 'File the report'}
          </button>
          {/* Somebody did the walkies and got pulled onto another truck.
              Files what they counted, under their name, and leaves every
              line nobody has counted open for whoever finishes. Only
              offered when there is both something done and something
              left — otherwise it is just File. */}
          {uncounted.length > 0 && countedRows > 0 && (
            <button
              onClick={() => {
                if (diffs > 0 || shortfalls.length > 0) { setConfirming('save'); return }
                void submit(true)
              }}
              disabled={saving || nameMissing || (isOut && unnamedExtras > 0)}
              className="px-4 py-2.5 border border-amber-600 text-amber-700 hover:bg-chip-warn-bg text-[15px] font-semibold rounded-lg disabled:opacity-50"
            >
              {saving ? 'Saving…' : `Save what’s done (${countedRows} of ${onSheetIds.length})`}
            </button>
          )}
          <Link href="/reports/orders" className="text-[14px] text-lt-fg2 hover:text-lt-fg">
            Cancel
          </Link>
        </div>
      )}
    </div>
  )
}
