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
import type { ReportDraft, DraftLine } from '@/lib/orders/checkReports'
import { classifyCheckLine, describeCheckChange } from '@/lib/orders/checkLineChange'

type Row = DraftLine & { open: boolean }
type Extra = { key: string; description: string; actualQty: number; note: string }

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
      // correction shows what was said rather than hiding it.
      open: l.actualQty !== l.expectedQty || !!l.substituteFor || !!l.note,
    })),
  )
  const [extras, setExtras] = useState<Extra[]>(() =>
    draft.extras.map((e, i) => ({
      key: `prior-${i}`,
      description: e.description,
      actualQty: e.actualQty,
      note: e.note ?? '',
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
    changedOrder: boolean
    changes: string[]
    /** Whether the corrected quote went back to the client, and why not. */
    resend: { sent: true; to: string; cc: string[] } | { sent: false; reason: string } | null
    /** What filing this sheet settled in the yard. */
    gear: { pickListAdvanced: boolean; jobReturned: boolean } | null
    /** The sheet covered only part of the order. */
    partial: boolean
    offSheet: number
  } | null>(null)

  const patch = (id: string, next: Partial<Row>) =>
    setRows((prev) => prev.map((r) => (r.orderLineItemId === id ? { ...r, ...next } : r)))

  /**
   * Every difference on the sheet, described the way the order, the audit
   * row and the client's re-sent quote will describe it — same functions
   * the server runs, so the confirm step cannot promise one thing and
   * file another.
   */
  const changeList = useMemo(() => {
    const out: Array<{ key: string; text: string; added: boolean }> = []
    for (const r of rows) {
      // A line left off this pull says nothing about itself — it is not
      // a change, it is a line that has not happened yet.
      if (!r.onSheet) continue
      const change = classifyCheckLine(r)
      if (change === 'NONE') continue
      out.push({ key: r.orderLineItemId, text: describeCheckChange(r, change), added: false })
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
      })
    }
    return out
  }, [rows, extras])
  const diffs = changeList.length

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
            actualQty: hit.actualQty,
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
        changes: data.changes ?? [],
        resend: data.resend ?? null,
        gear: data.gear ?? null,
        partial: !!data.partial,
        offSheet: data.offSheet ?? 0,
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
                The order has been updated and {draft.agentName || 'the agent'} has been flagged to
                review what changed.
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
            <p className="mt-3 text-[14px] text-pill-quoted-fg">
              {done.offSheet} line{done.offSheet === 1 ? '' : 's'} weren&rsquo;t on this sheet — the
              order is unchanged there, and the job stays open on the board until they
              {isOut ? ' go out' : ' come back'}.
            </p>
          )}
          {done.gear?.jobReturned && (
            <p className="mt-3 text-[14px] text-chip-good-fg">
              Everything on this job is back — it&rsquo;s marked returned.
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
              <>
                That was a <b>partial</b> {isOut ? 'pull' : 'count'} — the lines below marked
                &ldquo;{isOut ? 'stays on the shelf' : 'still out'}&rdquo; are what is left. Print
                those, then put them back and count them here; filing again keeps the counts already
                on record.
              </>
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

      <div className="border border-lt-hairline bg-lt-card rounded-xl overflow-hidden mb-4">
        <div className="px-3 py-2 bg-lt-inner border-b border-lt-hairline flex items-center justify-between">
          <span className="text-[12px] uppercase tracking-wide text-lt-fg2 font-semibold">
            {isOut ? 'What actually went out' : 'What actually came back'}
          </span>
          <span className="text-[12px] text-lt-fg3">
            {offSheet.length
              ? `${onSheetIds.length} of ${rows.length} lines on this pull`
              : `${rows.length} lines · pre-filled from the order`}
          </span>
        </div>

        {rows.length === 0 && (
          <p className="px-3 py-6 text-center text-[15px] text-lt-fg3">This order has no line items.</p>
        )}

        {rows.map((r) => {
          const differs =
            r.onSheet && (r.actualQty !== r.expectedQty || !!(r.substituteFor ?? '').trim())
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
              className={`px-3 py-2.5 border-b border-lt-hairline last:border-b-0 ${differs ? 'bg-chip-warn-bg' : ''}`}
            >
              <div className="flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <div className="text-lt-fg text-[16px] font-medium truncate">{r.description}</div>
                  <div className="text-lt-fg2 text-[13px] truncate">
                    {r.qualifier && <span>{r.qualifier} · </span>}
                    ordered {r.expectedQty}
                    {r.lane && <span className="text-lt-fg3"> · {r.lane.toLowerCase()}</span>}
                  </div>
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
                    onChange={(e) => patch(r.orderLineItemId, { actualQty: Math.max(0, Number(e.target.value) || 0) })}
                    className={`w-20 text-center bg-lt-inner border rounded-lg px-2 py-1.5 text-[16px] text-lt-fg ${
                      differs ? 'border-amber-500' : 'border-lt-hairline'
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
            Not on the order
          </span>
          <span className="text-[12px] text-lt-fg3 ml-2">
            Flagged to the agent to price — nothing is added to the order here.
          </span>
        </div>
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
        <p className="mb-3 text-[14px] text-pill-quoted-fg border border-pill-quoted-fg/25 bg-pill-quoted-bg rounded-lg px-3 py-2">
          <b>Partial {isOut ? 'pull' : 'return'}.</b> {offSheet.length} line
          {offSheet.length === 1 ? ' is' : 's are'}{' '}
          {isOut ? 'not on this sheet' : 'still out'} — {isOut ? 'they stay' : 'nothing is'} on the
          order untouched, and this job stays open on the yard board until the rest{' '}
          {isOut ? 'goes out' : 'comes back'}. Re-open this screen for the next{' '}
          {isOut ? 'pull' : 'count'} and it picks up where this one stopped.
        </p>
      )}

      {/* Say what Submit will do before it does it. */}
      {diffs > 0 && !confirming && (
        <p className="mb-3 text-[14px] text-chip-warn-fg border border-chip-warn-fg/30 bg-chip-warn-bg rounded-lg px-3 py-2 flex items-start gap-2">
          <AlertTriangle size={15} aria-hidden className="flex-none mt-0.5" />
          <span>
            {diffs} line{diffs === 1 ? '' : 's'} differ from the order.
            {isOut
              ? ` Filing this updates the order and flags ${draft.agentName || 'the agent'} to review it.` +
                (draft.preBooked
                  ? ' The client is emailed the corrected quote automatically, copying the office.'
                  : '')
              : ' A check-in is recorded and flagged, but never changes what was rented — the agent decides what a shortfall costs.'}
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
              <>
                Filing this changes what {draft.company} is billed for and flags{' '}
                {draft.agentName || 'the agent'} to review it.
                {draft.preBooked
                  ? ' The corrected quote is emailed to the client automatically, copying the office.'
                  : ''}
              </>
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
              // Nothing differs → nothing to read back. One tap, as before.
              if (diffs > 0) { setConfirming(true); return }
              void submit()
            }}
            disabled={saving}
            className="px-4 py-2.5 bg-amber-600 hover:bg-chip-warn-bg0 text-white text-[15px] font-semibold rounded-lg disabled:opacity-50"
          >
            {saving
              ? 'Filing…'
              : diffs > 0
                ? `Review ${diffs} change${diffs === 1 ? '' : 's'} and file`
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
