'use client'

/**
 * MakeReservationModal — the reservation desk's one-window intake
 * (Wes 2026-09-09, against Planyo's "Make reservation" button).
 *
 * Planyo's whole booking flow is one screen: pick the resource, pick
 * the dates, name the company and job, save. HQ could do every one of
 * those things but never in one place — the category came from
 * whatever row you happened to click on the gantt, and the Order was a
 * separate trip through /orders/new. This is that screen.
 *
 * ORDER-FIRST, and that ordering is load-bearing. The obvious build is
 * "create the hold, then create the order" — it double-books. A hold
 * created through POST /api/scheduling/holds lands as a rank-1
 * BookingItem with quantity N; adding the matching order line then
 * runs `syncHoldOnLineAdd`, which ACCUMULATES (`quantity + addedQty`)
 * and leaves the category reserved 2N. So this flow never posts a
 * hold. It creates the Order, POSTs the vehicle line, and lets the
 * line-items route mint the Booking + hold the way every other quoted
 * vehicle gets one ("a vehicle is held the moment it is quoted" —
 * holdOnQuoteSend, SET-not-accumulate, idempotent). One reservation,
 * priced by the client's own rate card, and no second write path to
 * keep in sync.
 *
 * That also means the hold arrives at whatever rank the paperwork
 * rules say (`reconcileHoldFirmness`) — this modal deliberately does
 * NOT firm it. A hold firmed by flipping holdRank is undone by the
 * next sweep; the staff override for a client who said yes on the
 * phone is the job page's "Client said yes" button, which is a
 * different decision than booking a truck.
 *
 * A CONTACT is required ONLY when the job has nobody on it, and that
 * is not paperwork for its own sake:
 * `holdOnQuoteSend` cannot create the Booking without a person on the
 * job or an affiliation on the company, and it fails NON-FATALLY. A
 * reservation taken for a brand-new client with nobody attached
 * therefore produced an order and NO hold at all — the truck reading
 * free on the board while a live order committed it (the Wild Goats
 * Creative failure, 2026-08-29). Posting the contact to the job first
 * closes that hole. A job that already has contacts satisfies the rule
 * as it stands, so the field collapses to a one-line confirmation and
 * asks for nothing (Wes 2026-09-09). The endpoint is find-or-create on
 * both the Person and the JobContact, so naming someone twice is a
 * no-op.
 *
 * Nothing here emails anybody. Creating an order + hold is internal
 * work; the client-facing sends live behind Send quote / Book it, and
 * adding a job contact deliberately sends no portal invite.
 */

import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Check, Loader2, X } from 'lucide-react'
import { CompanyPicker } from '@/components/orders/CompanyPicker'
import { holdRankLabel, MAX_HOLD_RANK } from '@/lib/scheduling/holdRanks'
import { JobResolverModal, type ResolvedJob } from '@/components/shared/JobResolverModal'

interface Category {
  id: string
  name: string
  slug: string
  code?: string | null
  totalUnits: number
  department: 'VEHICLES' | 'STAGES'
  dailyRate: number | null
}

/** A hold's co-tenants, as the line-items route reports them on a 409. */
interface Conflict {
  bookingNumber: string
  jobName: string | null
  startDate: string
  endDate: string
  quantity: number
}

/** One hold already in this category's window. */
interface StackEntry {
  bookingItemId: string
  holdRank: number
  quantity: number
  bookingNumber: string
  jobName: string | null
}

/** What the desk chose to do about a category at capacity. */
type QueueChoice = 'none' | 'second' | 'take-first'

interface Result {
  orderId: string
  orderNumber: string
  bookingNumber: string | null
  /** null when nothing was assigned — either not asked for, or no unit was free. */
  assigned: { unitName: string }[]
  assignNote: string | null
  /** Where this reservation landed in the queue, when it was stacked. */
  holdRank?: number
  demoted?: { bookingNumber: string; from: number; to: number }[]
}

/** One line of the submit progress list. */
type StepState = 'pending' | 'running' | 'done' | 'skipped' | 'failed'

const today = () => new Date().toISOString().slice(0, 10)

export function MakeReservationModal({
  defaultStart,
  defaultEnd,
  canBindUnit = true,
  onClose,
  onCreated,
}: {
  /** Pre-fill from the board's visible window; falls back to today. */
  defaultStart?: string
  defaultEnd?: string
  /** Whether this user may bind a specific unit (dispatch/assign gate).
   *  When false the "assign next available" option is not offered — the
   *  reservation still holds the category. */
  canBindUnit?: boolean
  onClose: () => void
  onCreated: () => void
}) {
  const [categories, setCategories] = useState<Category[]>([])
  const [categoryId, setCategoryId] = useState('')
  const [quantity, setQuantity] = useState(1)
  const [start, setStart] = useState(defaultStart || today())
  const [end, setEnd] = useState(defaultEnd || defaultStart || today())
  const [company, setCompany] = useState<{ id: string; name: string } | null>(null)
  const [job, setJob] = useState<{ id: string; jobCode: string; name: string } | null>(null)
  const [resolverOpen, setResolverOpen] = useState(false)
  const [assignNext, setAssignNext] = useState(true)
  const [notes, setNotes] = useState('')
  // The person this reservation is for. Only asked for when the job has
  // nobody — see the header. `null` = not looked up yet (or no job).
  const [contactFirst, setContactFirst] = useState('')
  const [contactLast, setContactLast] = useState('')
  const [contactEmail, setContactEmail] = useState('')
  const [jobContacts, setJobContacts] = useState<{ name: string; email: string; role: string }[] | null>(null)
  const [contactsLoading, setContactsLoading] = useState(false)

  // Inline "+ New company" — same 409 near-match discipline the hold
  // modal uses: the agent picks "use existing" or "create anyway",
  // never an auto-merge.
  const [creatingCompany, setCreatingCompany] = useState(false)
  const [newCompanyName, setNewCompanyName] = useState('')
  const [companyBusy, setCompanyBusy] = useState(false)
  const [companyError, setCompanyError] = useState<string | null>(null)
  const [companyNearMatch, setCompanyNearMatch] = useState<{ id: string; name: string; message: string } | null>(null)

  // Capacity for the chosen category+window, and who is already in the
  // queue for it. Both refresh whenever the type or the dates move.
  const [avail, setAvail] = useState<{ availableToHold: number; serviceableCount: number } | null>(null)
  const [stack, setStack] = useState<StackEntry[]>([])
  const [availLoading, setAvailLoading] = useState(false)
  const [queueChoice, setQueueChoice] = useState<QueueChoice>('none')

  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [conflicts, setConflicts] = useState<Conflict[] | null>(null)
  const [steps, setSteps] = useState<Record<string, StepState>>({})
  const [result, setResult] = useState<Result | null>(null)

  useEffect(() => {
    fetch('/api/scheduling/categories')
      .then((r) => r.json())
      .then((d) => {
        if (d.ok) setCategories(d.categories || [])
      })
      .catch(() => {})
  }, [])

  // Does this job already have somebody on it? Decides whether the
  // contact field is required or merely offered.
  useEffect(() => {
    if (!job) {
      setJobContacts(null)
      return
    }
    let cancelled = false
    setContactsLoading(true)
    fetch(`/api/jobs/${job.id}/contacts`)
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return
        setJobContacts(d?.ok ? d.contacts || [] : [])
      })
      .catch(() => {
        // Unknown, so fall back to ASKING. Better a redundant contact
        // than an order that holds nothing.
        if (!cancelled) setJobContacts([])
      })
      .finally(() => {
        if (!cancelled) setContactsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [job])

  const category = useMemo(
    () => categories.find((c) => c.id === categoryId) ?? null,
    [categories, categoryId],
  )

  // Preflight: is there anything left for these dates, and who is
  // holding it if not? This is what turns "Create reservation" into the
  // 2nd-Hold choice rather than a silent over-commit.
  useEffect(() => {
    if (!categoryId || !/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end) || end < start) {
      setAvail(null)
      setStack([])
      return
    }
    let cancelled = false
    setAvailLoading(true)
    Promise.all([
      fetch(`/api/scheduling/availability?categoryId=${categoryId}&start=${start}&end=${end}`).then((r) => r.json()),
      fetch(`/api/scheduling/stacked-holds?categoryId=${categoryId}&start=${start}&end=${end}`).then((r) => r.json()),
    ])
      .then(([a, st]) => {
        if (cancelled) return
        setAvail(
          typeof a?.availableToHold === 'number'
            ? { availableToHold: a.availableToHold, serviceableCount: a.serviceableCount ?? 0 }
            : null,
        )
        // `rows` — the stacked-holds route's key, already ordered rank
        // then oldest-first within a rank.
        setStack(Array.isArray(st?.rows) ? st.rows : [])
        setQueueChoice('none')
      })
      .catch(() => {
        if (!cancelled) {
          setAvail(null)
          setStack([])
        }
      })
      .finally(() => {
        if (!cancelled) setAvailLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [categoryId, start, end])

  const datesValid =
    /^\d{4}-\d{2}-\d{2}$/.test(start) && /^\d{4}-\d{2}-\d{2}$/.test(end) && end >= start

  /** Nothing left for these dates — the moment the queue matters. */
  const atCapacity = !!avail && avail.availableToHold < quantity
  const incumbents = stack.filter((h) => h.holdRank === 1)
  const deepest = stack.reduce((m, h) => Math.max(m, h.holdRank), 0)
  /** Where a "2nd Hold" would actually land (2, or 3 behind a 2nd). */
  const nextFreeRank = Math.max(2, deepest + 1)
  const stackFull = nextFreeRank > MAX_HOLD_RANK

  // First/last/email as THREE labelled fields. They used to be two
  // side-by-side boxes — "name" and "email" — which read as First and
  // Last, so a surname landed in the email box, failed the pattern, and
  // the only feedback was a greyed-out button (Wes 2026-09-09).
  const contactTyped =
    !!contactFirst.trim() && !!contactLast.trim() && /\S+@\S+\.\S+/.test(contactEmail.trim())
  /** The job already satisfies the Booking's person requirement. */
  const jobHasContact = (jobContacts?.length ?? 0) > 0
  const contactReady = jobHasContact || contactTyped

  /**
   * WHY the button is off, in the agent's words. A disabled primary CTA
   * that explains nothing is a dead end — Wes hit exactly that on
   * 2026-09-09, having typed a surname into what turned out to be the
   * email box. Never render the disabled state without this list.
   */
  const blockers: string[] = []
  if (!category) blockers.push('pick a vehicle type')
  if (!datesValid) blockers.push('check the dates')
  if (quantity < 1) blockers.push('how many?')
  if (!company) blockers.push('pick a company')
  if (!job) blockers.push('pick a job')
  if (!contactReady && !contactsLoading) {
    if (!contactFirst.trim() || !contactLast.trim()) blockers.push("the contact's first and last name")
    if (!/\S+@\S+\.\S+/.test(contactEmail.trim())) blockers.push("the contact's email")
  }
  if (atCapacity && queueChoice === 'none' && !stackFull) {
    blockers.push('choose 2nd Hold or take the 1st')
  }

  const canSubmit = blockers.length === 0 && !contactsLoading && !availLoading && !submitting

  function onJobResolved(r: ResolvedJob) {
    setJob({ id: r.id, jobCode: r.jobCode, name: r.name })
    // The Job is the root object: if its company differs from the one
    // picked here, follow the Job. An order whose company disagrees
    // with its job's is a data bug nobody looks for later.
    if (r.companyId && company?.id !== r.companyId) {
      setCompany({ id: r.companyId, name: r.companyName || '' })
    }
    setResolverOpen(false)
  }

  async function createCompany(allowNearMatch: boolean) {
    const name = newCompanyName.trim()
    if (!name) return
    setCompanyBusy(true)
    setCompanyError(null)
    if (!allowNearMatch) setCompanyNearMatch(null)
    try {
      const res = await fetch('/api/crm/companies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, allowNearMatch }),
      })
      const json = await res.json().catch(() => ({}))
      if (res.status === 409 && json?.existing) {
        setCompanyNearMatch({
          id: json.existing.id,
          name: json.existing.name,
          message: json.message || 'A company with a similar name already exists.',
        })
        return
      }
      if (!res.ok || !json?.id) {
        setCompanyError(json?.error || 'Could not create the company.')
        return
      }
      setCompany({ id: json.id, name: json.name })
      setCreatingCompany(false)
      setNewCompanyName('')
      setCompanyNearMatch(null)
    } finally {
      setCompanyBusy(false)
    }
  }

  /**
   * The write. Steps are reported individually because a partial
   * failure here is a real state the agent has to see: the Order can
   * exist while the line (and therefore the hold) does not.
   */
  async function submit(confirmConflict: boolean) {
    if (!category || !company || !job) return
    setSubmitting(true)
    setError(null)
    if (!confirmConflict) setConflicts(null)
    const mark = (k: string, v: StepState) => setSteps((s) => ({ ...s, [k]: v }))

    try {
      // 0 — the contact, onto the Job. This is what makes the hold
      // possible two steps later; a failure here is fatal to the flow
      // BY DESIGN, because continuing would produce the exact silent
      // no-hold order this step exists to prevent.
      if (jobHasContact && !contactTyped) {
        // Nothing to add — the job's existing contact is what the
        // Booking will attach to.
        mark('contact', 'skipped')
      } else {
      mark('contact', 'running')
      const cRes = await fetch(`/api/jobs/${job.id}/contacts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: contactEmail.trim(),
          firstName: contactFirst.trim(),
          lastName: contactLast.trim(),
          role: 'PRODUCER',
        }),
      })
      if (!cRes.ok) {
        const cj = await cRes.json().catch(() => ({}))
        mark('contact', 'failed')
        setError(
          `${cj?.error || `Could not attach the contact (${cRes.status}).`} ` +
            'Nothing was created — a reservation with no contact on the job cannot hold a unit.',
        )
        setSubmitting(false)
        return
      }
      mark('contact', 'done')
      }

      // 1 — the Order. Job-as-root: jobId is required and never created here.
      mark('order', 'running')
      const orderRes = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId: company.id,
          jobId: job.id,
          startDate: start,
          endDate: end,
          description: notes.trim() || null,
        }),
      })
      const order = await orderRes.json().catch(() => ({}))
      if (!orderRes.ok || !order?.id) {
        mark('order', 'failed')
        setError(order?.error || `Could not create the order (${orderRes.status}).`)
        setSubmitting(false)
        return
      }
      mark('order', 'done')

      // 2 — the vehicle line. This is what mints the Booking + hold.
      // The rate is the catalog list price; the route re-resolves it
      // against the client's rate card, so this is a display value,
      // not the price of record.
      mark('line', 'running')
      const lineBody = {
        type: 'VEHICLE',
        description: category.name,
        assetCategoryId: category.id,
        department: category.department,
        rateType: 'DAILY',
        rate: category.dailyRate ?? 0,
        quantity,
        pickupDate: start,
        returnDate: end,
        ...(confirmConflict ? { confirmConflict: true } : {}),
      }
      const lineRes = await fetch(`/api/orders/${order.id}/line-items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(lineBody),
      })
      const line = await lineRes.json().catch(() => ({}))

      // Capacity conflict — the route names the bookings this would
      // step on. Warn-with-override, never a hard block: at pickup the
      // truck goes out regardless of what the system thinks.
      if (lineRes.status === 409 && line?.requiresConfirmation && Array.isArray(line.conflicts)) {
        mark('line', 'pending')
        setConflicts(line.conflicts)
        setResult({
          orderId: order.id,
          orderNumber: order.orderNumber,
          bookingNumber: null,
          assigned: [],
          assignNote: null,
        })
        setSubmitting(false)
        return
      }
      if (!lineRes.ok) {
        mark('line', 'failed')
        setError(
          `${line?.error || `Could not add the ${category.name} line (${lineRes.status}).`} ` +
            `Order ${order.orderNumber} was created and is empty — open it to finish or delete it.`,
        )
        setSubmitting(false)
        return
      }
      mark('line', 'done')

      // 3 — find the hold the line just caused, so we can assign into it.
      mark('hold', 'running')
      const holdRes = await fetch(
        `/api/scheduling/order-hold?orderId=${order.id}&categoryId=${category.id}`,
      )
      const hold = await holdRes.json().catch(() => ({}))
      const bookingItemId: string | null = hold?.bookingItem?.id ?? null
      mark('hold', bookingItemId ? 'done' : 'failed')

      // 3b — the queue decision, when the desk made one. The hold the
      // line-items route minted carries an AUTOMATIC rank; this stamps
      // the human one over it and locks it so the firmness sweep leaves
      // it alone. Done before assignment so a 2nd Hold never grabs a
      // unit out from under the 1st.
      let placedRank: number | undefined
      let demoted: { bookingNumber: string; from: number; to: number }[] = []
      if (bookingItemId) {
        mark('rank', 'running')
        // 1st Hold unless the agent explicitly queued behind somebody
        // (Wes 2026-09-09: "ranking should always default to 1 and only
        // present other options when there is a conflict").
        //
        // Without this the reservation kept whatever rank
        // holdOnQuoteSend minted — SOFT, i.e. 2 — so an uncontested
        // booking on a free van came out labelled a 2nd Hold behind
        // nobody. The rank is LOCKED, which is the same principle as
        // the queue choices: a rank a human set is not the firmness
        // sweep's to move. The cost is that this hold no longer
        // self-demotes when paperwork lapses; the gaps still surface on
        // the job and in reconcile's `missing`.
        const wantRank = queueChoice === 'second' ? nextFreeRank : 1
        const rankRes = await fetch(`/api/scheduling/booking-items/${bookingItemId}/rank`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            rank: wantRank,
            demoteOthers: queueChoice === 'take-first',
            reason: notes.trim() || null,
          }),
        })
        const rankJson = await rankRes.json().catch(() => ({}))
        if (!rankRes.ok) {
          mark('rank', 'failed')
          setError(
            `${rankJson?.reason || rankJson?.error || `Could not place the hold in the queue (${rankRes.status}).`} ` +
              `Order ${order.orderNumber} exists and the units are held — open it to sort the queue out.`,
          )
          setSubmitting(false)
          return
        }
        placedRank = rankJson.holdRank
        demoted = rankJson.demoted || []
        mark('rank', 'done')
      }

      // 4 — optional: bind the next free unit(s).
      const assigned: { unitName: string }[] = []
      let assignNote: string | null = null
      // A queued hold gets NO unit. The whole point of a 2nd Hold is
      // that the truck is somebody else's until they release it;
      // assigning one here would double-book the asset for real.
      const queuedBehind = (placedRank ?? 1) > 1
      if (queuedBehind) {
        mark('assign', 'skipped')
        assignNote = `Queued as the ${holdRankLabel(placedRank!)} Hold — no unit is assigned until the hold ahead releases.`
      } else if (assignNext && canBindUnit && bookingItemId) {
        mark('assign', 'running')
        for (let i = 0; i < quantity; i++) {
          const availRes = await fetch(
            `/api/scheduling/booking-items/${bookingItemId}/available-units`,
          )
          const avail = await availRes.json().catch(() => ({}))
          // `candidates` — NOT `units`. The route returns the pooled
          // counts under `summary` and the pickable rows under
          // `candidates`, already sorted nicest-tier-then-unit-number.
          const units: { assetId: string; unitName: string; state: string }[] =
            avail?.candidates || []
          // "Next available" is the first FREE unit in the list the
          // server already sorted (nicest tier first, then unit number).
          // Buffer-state units are deliberately not auto-picked — they
          // need the human override, not a silent one.
          const next = units.find((u) => u.state === 'free')
          if (!next) {
            assignNote =
              i === 0
                ? 'No unit was free for those dates — the reservation holds the category and shows in the needs-a-unit lane.'
                : `Only ${assigned.length} of ${quantity} could be assigned — no other unit is free for those dates.`
            break
          }
          const assignRes = await fetch(
            `/api/scheduling/booking-items/${bookingItemId}/assign`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ assetId: next.assetId, orderId: order.id }),
            },
          )
          if (!assignRes.ok) {
            const aj = await assignRes.json().catch(() => ({}))
            assignNote = `${next.unitName} could not be assigned (${aj?.error || assignRes.status}). The reservation still holds the category.`
            break
          }
          assigned.push({ unitName: next.unitName })
        }
        mark('assign', assigned.length ? 'done' : 'failed')
      } else if (!assignNext) {
        mark('assign', 'skipped')
      } else if (!canBindUnit) {
        mark('assign', 'skipped')
        assignNote = 'Units are assigned by dispatch — the reservation holds the category.'
      }

      setResult({
        orderId: order.id,
        orderNumber: order.orderNumber,
        bookingNumber: hold?.booking?.bookingNumber ?? null,
        assigned,
        assignNote,
        holdRank: placedRank,
        demoted,
      })
      setConflicts(null)
      onCreated()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong creating the reservation.')
    } finally {
      setSubmitting(false)
    }
  }

  const stepRow = (key: string, label: string) => {
    const st = steps[key] ?? 'pending'
    return (
      <div key={key} className="flex items-center gap-2 text-[12px]">
        {st === 'running' ? (
          <Loader2 size={13} className="animate-spin text-lt-fg3" aria-hidden />
        ) : st === 'done' ? (
          <Check size={13} className="text-chip-good-fg" aria-hidden />
        ) : st === 'failed' ? (
          <AlertTriangle size={13} className="text-chip-bad-fg" aria-hidden />
        ) : (
          <span className="w-[13px] h-[13px] rounded-full border border-lt-hairline" />
        )}
        <span className={st === 'pending' ? 'text-lt-fg3' : 'text-lt-fg2'}>{label}</span>
        {st === 'skipped' && <span className="text-lt-fg3">· skipped</span>}
      </div>
    )
  }

  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center overflow-y-auto py-10 px-4">
        <div className="bg-lt-card w-full max-w-xl rounded-xl shadow-xl border border-lt-hairline">
          <div className="flex items-center justify-between px-5 py-3 border-b border-lt-hairline">
            <h2 className="text-sm font-bold text-lt-fg">Make a reservation</h2>
            <button
              onClick={onClose}
              className="text-lt-fg3 hover:text-lt-fg"
              aria-label="Close"
            >
              <X size={16} aria-hidden />
            </button>
          </div>

          {result && !conflicts ? (
            /* ── Done ─────────────────────────────────────────────── */
            <div className="px-5 py-4 space-y-3">
              <div className="flex items-center gap-2 text-[13px] font-semibold text-lt-fg">
                <Check size={15} className="text-chip-good-fg" aria-hidden />
                Reservation created
              </div>
              <div className="rounded-lg bg-lt-inner border border-lt-hairline px-3 py-2 text-[12px] text-lt-fg2 space-y-1">
                <div>
                  Order <span className="font-semibold text-lt-fg">{result.orderNumber}</span>
                  {result.bookingNumber && (
                    <> · reservation <span className="font-semibold text-lt-fg">{result.bookingNumber}</span></>
                  )}
                </div>
                <div>
                  {category?.name} × {quantity} · {start} – {end}
                </div>
                {result.holdRank != null && (
                  <div>
                    {result.holdRank > 1 ? 'Queued as the ' : 'Placed as the '}
                    <span className="font-semibold text-lt-fg">
                      {holdRankLabel(result.holdRank)} Hold
                    </span>
                  </div>
                )}
                {result.demoted && result.demoted.length > 0 && (
                  <div>
                    Demoted:{' '}
                    <span className="font-semibold text-lt-fg">
                      {result.demoted.map((d) => `${d.bookingNumber} → ${holdRankLabel(d.to)}`).join(', ')}
                    </span>
                  </div>
                )}
                {result.assigned.length > 0 && (
                  <div>
                    Assigned:{' '}
                    <span className="font-semibold text-lt-fg">
                      {result.assigned.map((a) => a.unitName).join(', ')}
                    </span>
                  </div>
                )}
              </div>
              {result.assignNote && (
                <div className="rounded-lg bg-chip-warn-bg text-chip-warn-fg px-3 py-2 text-[12px]">
                  {result.assignNote}
                </div>
              )}
              <div className="flex justify-end gap-2 pt-1">
                <button
                  onClick={onClose}
                  className="px-3 py-1.5 rounded-lg border border-lt-hairline text-[12px] font-semibold text-lt-fg2 hover:bg-lt-inner"
                >
                  Close
                </button>
                <a
                  href={`/orders/${result.orderId}`}
                  className="px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-[12px] font-semibold"
                >
                  Open the order
                </a>
              </div>
            </div>
          ) : (
            /* ── Form ─────────────────────────────────────────────── */
            <div className="px-5 py-4 space-y-4">
              {/* Vehicle type */}
              <div>
                <div className="flex gap-2 items-end">
                  <div className="flex-1">
                    <label
                      htmlFor="reservation-type"
                      className="block text-[11px] font-semibold text-lt-fg2 mb-1"
                    >
                      Vehicle type
                    </label>
                  <select
                    id="reservation-type"
                    value={categoryId}
                    onChange={(e) => setCategoryId(e.target.value)}
                    className="w-full border border-lt-hairline rounded-lg px-2 py-1.5 text-[13px] bg-lt-card text-lt-fg"
                  >
                    <option value="">Select a type…</option>
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} ({c.totalUnits})
                      </option>
                    ))}
                  </select>
                  </div>
                  <div className="shrink-0">
                    <label
                      htmlFor="reservation-qty"
                      className="block text-[11px] font-semibold text-lt-fg2 mb-1"
                    >
                      How many
                    </label>
                    <input
                      id="reservation-qty"
                      type="number"
                      min={1}
                      value={quantity}
                      onChange={(e) => setQuantity(Math.max(1, parseInt(e.target.value) || 1))}
                      className="w-20 border border-lt-hairline rounded-lg px-2 py-1.5 text-[13px] bg-lt-card text-lt-fg"
                    />
                  </div>
                </div>
                {category && !availLoading && avail && !atCapacity && (
                  <p className="mt-1 text-[11px] text-chip-good-fg">
                    {avail.availableToHold} of {avail.serviceableCount} available for these dates
                  </p>
                )}
                {category?.dailyRate != null && (
                  <p className="mt-1 text-[11px] text-lt-fg3">
                    ${category.dailyRate}/day list — the client&apos;s own rate card is applied when the line is priced.
                  </p>
                )}
              </div>

              {/* Dates */}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[11px] font-semibold text-lt-fg2 mb-1">Start</label>
                  <input
                    type="date"
                    value={start}
                    onChange={(e) => {
                      setStart(e.target.value)
                      if (end < e.target.value) setEnd(e.target.value)
                    }}
                    className="w-full border border-lt-hairline rounded-lg px-2 py-1.5 text-[13px] bg-lt-card text-lt-fg"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-lt-fg2 mb-1">End</label>
                  <input
                    type="date"
                    value={end}
                    min={start}
                    onChange={(e) => setEnd(e.target.value)}
                    className="w-full border border-lt-hairline rounded-lg px-2 py-1.5 text-[13px] bg-lt-card text-lt-fg"
                  />
                </div>
              </div>

              {/* Company */}
              <div>
                <label className="block text-[11px] font-semibold text-lt-fg2 mb-1">Company</label>
                {creatingCompany ? (
                  <div className="space-y-2">
                    <input
                      value={newCompanyName}
                      onChange={(e) => setNewCompanyName(e.target.value)}
                      placeholder="New company name"
                      className="w-full border border-lt-hairline rounded-lg px-2 py-1.5 text-[13px] bg-lt-card text-lt-fg"
                    />
                    {companyNearMatch && (
                      <div className="rounded-lg bg-chip-warn-bg text-chip-warn-fg px-3 py-2 text-[12px] space-y-2">
                        <div>{companyNearMatch.message}</div>
                        <div className="flex gap-2">
                          <button
                            onClick={() => {
                              setCompany({ id: companyNearMatch.id, name: companyNearMatch.name })
                              setCreatingCompany(false)
                              setCompanyNearMatch(null)
                              setNewCompanyName('')
                            }}
                            className="px-2 py-1 rounded bg-lt-card border border-lt-hairline text-[11px] font-semibold text-lt-fg"
                          >
                            Use {companyNearMatch.name}
                          </button>
                          <button
                            onClick={() => createCompany(true)}
                            disabled={companyBusy}
                            className="px-2 py-1 rounded bg-lt-card border border-lt-hairline text-[11px] font-semibold text-lt-fg"
                          >
                            Create anyway
                          </button>
                        </div>
                      </div>
                    )}
                    {companyError && (
                      <div className="text-[12px] text-chip-bad-fg">{companyError}</div>
                    )}
                    <div className="flex gap-2">
                      <button
                        onClick={() => createCompany(false)}
                        disabled={companyBusy || !newCompanyName.trim()}
                        className="px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white text-[12px] font-semibold"
                      >
                        {companyBusy ? 'Creating…' : 'Create company'}
                      </button>
                      <button
                        onClick={() => {
                          setCreatingCompany(false)
                          setCompanyNearMatch(null)
                          setCompanyError(null)
                        }}
                        className="px-3 py-1.5 rounded-lg border border-lt-hairline text-[12px] font-semibold text-lt-fg2"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-1">
                    <CompanyPicker
                      value={company?.id ?? null}
                      selectedName={company?.name}
                      onChange={(id: string | null, name?: string) =>
                        setCompany(id ? { id, name: name || '' } : null)
                      }
                    />
                    <button
                      onClick={() => setCreatingCompany(true)}
                      className="text-[11px] font-semibold text-lt-fg3 hover:text-lt-fg"
                    >
                      + New company
                    </button>
                  </div>
                )}
              </div>

              {/* Job */}
              <div>
                <label className="block text-[11px] font-semibold text-lt-fg2 mb-1">Job</label>
                {job ? (
                  <div className="flex items-center justify-between rounded-lg bg-lt-inner border border-lt-hairline px-3 py-2">
                    <div className="text-[12px] text-lt-fg">
                      <span className="font-semibold">{job.jobCode}</span> · {job.name}
                    </div>
                    <button
                      onClick={() => setResolverOpen(true)}
                      className="text-[11px] font-semibold text-lt-fg3 hover:text-lt-fg"
                    >
                      Change
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setResolverOpen(true)}
                    className="w-full text-left rounded-lg border border-dashed border-lt-hairline px-3 py-2 text-[12px] text-lt-fg3 hover:text-lt-fg hover:border-lt-fg3"
                  >
                    Pick an existing job, or create one…
                  </button>
                )}
              </div>

              {/* Contact — asked for ONLY when the job has nobody. */}
              <div>
                <label className="block text-[11px] font-semibold text-lt-fg2 mb-1">Contact</label>
                {job && contactsLoading && (
                  <div className="text-[12px] text-lt-fg3">Checking who&apos;s on this job…</div>
                )}
                {job && !contactsLoading && jobHasContact && (
                  <div className="rounded-lg bg-lt-inner border border-lt-hairline px-3 py-2 text-[12px] text-lt-fg2">
                    <span className="font-semibold text-lt-fg">{jobContacts![0].name}</span>
                    {jobContacts![0].email ? ` · ${jobContacts![0].email}` : ''}
                    <span className="text-lt-fg3">
                      {' '}· already on this job
                      {jobContacts!.length > 1 ? ` (+${jobContacts!.length - 1} more)` : ''}
                    </span>
                  </div>
                )}
                {(!job || (!contactsLoading && !jobHasContact)) && (
                <div className="space-y-2">
                  <div className="grid grid-cols-2 gap-2">
                    <label className="block">
                      <span className="block text-[10px] uppercase tracking-wide text-lt-fg3 mb-0.5">
                        First name
                      </span>
                      <input
                        value={contactFirst}
                        onChange={(e) => setContactFirst(e.target.value)}
                        className="w-full border border-lt-hairline rounded-lg px-2 py-1.5 text-[13px] bg-lt-card text-lt-fg"
                      />
                    </label>
                    <label className="block">
                      <span className="block text-[10px] uppercase tracking-wide text-lt-fg3 mb-0.5">
                        Last name
                      </span>
                      <input
                        value={contactLast}
                        onChange={(e) => setContactLast(e.target.value)}
                        className="w-full border border-lt-hairline rounded-lg px-2 py-1.5 text-[13px] bg-lt-card text-lt-fg"
                      />
                    </label>
                  </div>
                  <label className="block">
                    <span className="block text-[10px] uppercase tracking-wide text-lt-fg3 mb-0.5">
                      Email
                    </span>
                    <input
                      type="email"
                      value={contactEmail}
                      onChange={(e) => setContactEmail(e.target.value)}
                      placeholder="name@company.com"
                      className="w-full border border-lt-hairline rounded-lg px-2 py-1.5 text-[13px] bg-lt-card text-lt-fg"
                    />
                  </label>
                </div>
                )}
                {(!job || (!contactsLoading && !jobHasContact)) && (
                  <p className="mt-1 text-[11px] text-lt-fg3">
                    Who the reservation is for. Required — a job with nobody on it can&apos;t hold a
                    unit. Already known? The same name and email just re-links them.
                  </p>
                )}
              </div>

              {/* Notes */}
              <div>
                <label className="block text-[11px] font-semibold text-lt-fg2 mb-1">
                  Note <span className="font-normal text-lt-fg3">(optional)</span>
                </label>
                <input
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Anything the order should carry"
                  className="w-full border border-lt-hairline rounded-lg px-2 py-1.5 text-[13px] bg-lt-card text-lt-fg"
                />
              </div>

              {/* Assign */}
              {canBindUnit && (
                <label className="flex items-start gap-2 text-[12px] text-lt-fg2">
                  <input
                    type="checkbox"
                    checked={assignNext}
                    onChange={(e) => setAssignNext(e.target.checked)}
                    className="mt-0.5"
                  />
                  <span>
                    Assign the next available unit
                    <span className="block text-[11px] text-lt-fg3">
                      Takes the first free unit for these dates, nicest tier first. Units in the
                      turnaround buffer are left for a human to override.
                    </span>
                  </span>
                </label>
              )}

              {/* Zero availability — the 2nd Hold moment (Wes 2026-09-09).
                  A category at capacity with no replacement unit is a
                  queue decision, not an error, so the two real answers
                  are offered by name. Backups never consume capacity,
                  so a 2nd Hold costs the production ahead nothing. */}
              {atCapacity && (
                <div className="rounded-lg border border-chip-warn-fg/30 bg-chip-warn-bg px-3 py-2.5 space-y-2.5">
                  <div className="text-[12px] font-semibold text-chip-warn-fg">
                    No {category?.name ?? 'unit'} free {start === end ? `on ${start}` : `${start} – ${end}`}
                    {avail ? ` — 0 of ${avail.serviceableCount} available` : ''}
                  </div>
                  {incumbents.length > 0 && (
                    <div className="text-[11px] text-chip-warn-fg/90 space-y-0.5">
                      {stack.slice(0, 4).map((h) => (
                        <div key={h.bookingItemId}>
                          {holdRankLabel(h.holdRank)} Hold · {h.jobName || h.bookingNumber}
                          {h.quantity > 1 ? ` · ${h.quantity} units` : ''}
                        </div>
                      ))}
                    </div>
                  )}
                  {stackFull ? (
                    <div className="text-[11px] text-chip-warn-fg">
                      This category already has {MAX_HOLD_RANK} holds on those dates. Release one
                      that isn&apos;t live, or sub-rent the unit — holds go 1st, 2nd, 3rd.
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => setQueueChoice('second')}
                        className={`px-3 py-1.5 rounded-lg text-[12px] font-semibold border ${
                          queueChoice === 'second'
                            ? 'bg-lt-fg text-white border-lt-fg'
                            : 'bg-lt-card text-lt-fg border-lt-hairline hover:border-lt-fg3'
                        }`}
                      >
                        {holdRankLabel(nextFreeRank)} Hold
                      </button>
                      <button
                        type="button"
                        onClick={() => setQueueChoice('take-first')}
                        className={`px-3 py-1.5 rounded-lg text-[12px] font-semibold border ${
                          queueChoice === 'take-first'
                            ? 'bg-lt-fg text-white border-lt-fg'
                            : 'bg-lt-card text-lt-fg border-lt-hairline hover:border-lt-fg3'
                        }`}
                      >
                        Make 1st Hold and demote other
                      </button>
                    </div>
                  )}
                  {queueChoice === 'second' && (
                    <div className="text-[11px] text-chip-warn-fg">
                      Queues behind {incumbents.length === 1 ? 'them' : 'the holds above'}. No unit is
                      assigned until the hold ahead releases, and this costs them nothing — a
                      backup doesn&apos;t consume capacity.
                    </div>
                  )}
                  {queueChoice === 'take-first' && (
                    <div className="text-[11px] text-chip-warn-fg">
                      {incumbents.length > 0
                        ? `${incumbents.map((i) => i.jobName || i.bookingNumber).join(', ')} drops to ${holdRankLabel(2)} Hold.`
                        : 'Takes the front of the queue.'}{' '}
                      Recorded against your name on the reservation. Nobody is emailed.
                    </div>
                  )}
                </div>
              )}

              {/* Conflict override */}
              {conflicts && (
                <div className="rounded-lg bg-chip-warn-bg text-chip-warn-fg px-3 py-2 text-[12px] space-y-2">
                  <div className="font-semibold">
                    That would step on {conflicts.length} other reservation
                    {conflicts.length === 1 ? '' : 's'}:
                  </div>
                  <ul className="space-y-0.5">
                    {conflicts.map((c, i) => (
                      <li key={i}>
                        · {c.bookingNumber}
                        {c.jobName ? ` · ${c.jobName}` : ''} · {c.startDate}–{c.endDate} · qty{' '}
                        {c.quantity}
                      </li>
                    ))}
                  </ul>
                  <button
                    onClick={() => submit(true)}
                    disabled={submitting || (atCapacity && queueChoice === 'none')}
                    className="px-3 py-1.5 rounded-lg bg-lt-card border border-lt-hairline text-[12px] font-semibold text-lt-fg disabled:opacity-50"
                  >
                    {atCapacity && queueChoice === 'second'
                      ? `Reserve as ${holdRankLabel(nextFreeRank)} Hold`
                      : atCapacity && queueChoice === 'take-first'
                        ? 'Take the 1st Hold'
                        : 'Reserve anyway'}
                  </button>
                </div>
              )}

              {error && (
                <div className="rounded-lg bg-chip-bad-bg text-chip-bad-fg px-3 py-2 text-[12px]">
                  {error}
                </div>
              )}

              {submitting && (
                <div className="rounded-lg bg-lt-inner border border-lt-hairline px-3 py-2 space-y-1">
                  {stepRow('contact', 'Attaching the contact')}
                  {stepRow('order', 'Creating the order')}
                  {stepRow('line', `Adding ${category?.name ?? 'the vehicle'} × ${quantity}`)}
                  {stepRow('hold', 'Reserving the category')}
                  {stepRow(
                    'rank',
                    queueChoice === 'second'
                      ? `Queueing as the ${holdRankLabel(nextFreeRank)} Hold`
                      : 'Placing the 1st Hold',
                  )}
                  {stepRow('assign', 'Assigning a unit')}
                </div>
              )}

              {blockers.length > 0 && !submitting && (
                <div className="text-[11px] text-lt-fg3 text-right">
                  Still needed: {blockers.join(' · ')}
                </div>
              )}

              <div className="flex justify-end gap-2 pt-1 border-t border-lt-hairline">
                <button
                  onClick={onClose}
                  className="mt-3 px-3 py-1.5 rounded-lg border border-lt-hairline text-[12px] font-semibold text-lt-fg2 hover:bg-lt-inner"
                >
                  Cancel
                </button>
                <button
                  onClick={() => submit(false)}
                  disabled={!canSubmit}
                  className="mt-3 px-4 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 disabled:opacity-40 text-white text-[12px] font-semibold"
                >
                  {submitting
                    ? 'Working…'
                    : atCapacity && queueChoice === 'second'
                      ? `Create ${holdRankLabel(nextFreeRank)} Hold`
                      : atCapacity && queueChoice === 'take-first'
                        ? 'Create and demote other'
                        : 'Create reservation'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {resolverOpen && (
        <JobResolverModal
          context={{
            companyId: company?.id ?? null,
            companyName: company?.name ?? null,
            dates: datesValid ? { start, end } : null,
          }}
          onResolved={onJobResolved}
          onClose={() => setResolverOpen(false)}
        />
      )}
    </>
  )
}
