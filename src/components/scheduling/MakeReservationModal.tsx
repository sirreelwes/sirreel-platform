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
 * ONE ORDER, AS MANY VEHICLES AS THE SHOW NEEDS (Wes 2026-09-09:
 * "when adding multiple reservations, it's adding new orders for each.
 * It would be better to be able to simply create multiple reservations
 * in one window and all add to one order"). The window shipped taking a
 * single type + quantity, so a production wanting a cube, a cargo van
 * and a passenger van meant three passes and three draft orders on one
 * job — SR-JOB-0340 collected S260909-022 and -023 that way. The form
 * now carries a LIST of lines. They share the order's window, company,
 * job and contact, because that is what makes them one order.
 *
 * All the lines land on one Booking, too: holdOnQuoteSend keeps one
 * Booking per order and the envelope spans every held line, so three
 * types read as one reservation on the board rather than three that
 * happen to share a name.
 *
 * ORDER-FIRST, and that ordering is load-bearing. The obvious build is
 * "create the hold, then create the order" — it double-books. A hold
 * created through POST /api/scheduling/holds lands as a rank-1
 * BookingItem with quantity N; adding the matching order line then
 * runs `syncHoldOnLineAdd`, which ACCUMULATES (`quantity + addedQty`)
 * and leaves the category reserved 2N. So this flow never posts a
 * hold. It creates the Order, POSTs each vehicle line, and lets the
 * line-items route mint the Booking + holds the way every other quoted
 * vehicle gets one ("a vehicle is held the moment it is quoted" —
 * holdOnQuoteSend for the first line, which SETs, then
 * syncHoldOnLineAdd for the rest, which adds a category that isn't on
 * the booking yet). Lines are priced by the client's own rate card, and
 * there is no second write path to keep in sync.
 *
 * ONE LINE PER TYPE, for the same reason: posting two Cargo Van lines
 * in a row makes the second one's capacity check trip over the hold the
 * first one just took, and the desk gets a conflict against itself.
 * Two of a type is a quantity, not two lines.
 *
 * That also means the holds arrive at whatever rank the paperwork rules
 * say (`reconcileHoldFirmness`) — this modal deliberately does NOT firm
 * them. A hold firmed by flipping holdRank is undone by the next sweep;
 * the staff override for a client who said yes on the phone is the job
 * page's "Client said yes" button, which is a different decision than
 * booking a truck.
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
 * A SECOND PASS NEVER CREATES A SECOND ORDER. Anything that stops the
 * run mid-way — a capacity conflict on line 3, a failed assign — keeps
 * the order it already made and the lines it already wrote, and the
 * retry resumes from the first line that has not landed. (Before the
 * list existed, the conflict override re-ran the whole submit and left
 * the first, empty order stranded.)
 *
 * Nothing here emails anybody. Creating an order + holds is internal
 * work; the client-facing sends live behind Send quote / Book it, and
 * adding a job contact deliberately sends no portal invite.
 */

import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Check, Loader2, Plus, Trash2, X } from 'lucide-react'
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

/** One vehicle line on the reservation. */
interface Row {
  /** Stable across re-orders and removals — also the key the submit
   *  loop records progress against, so a retry can skip what landed. */
  key: string
  categoryId: string
  quantity: number
  queueChoice: QueueChoice
}

/** Capacity + queue for one category over the reservation's window. */
interface Preflight {
  loading: boolean
  avail: { availableToHold: number; serviceableCount: number } | null
  stack: StackEntry[]
}

/** What one line ended up as, once it landed. */
interface RowResult {
  key: string
  label: string
  bookingNumber: string | null
  holdRank?: number
  demoted?: { bookingNumber: string; from: number; to: number }[]
  assigned: string[]
  note: string | null
}

interface Result {
  orderId: string
  orderNumber: string
  rows: RowResult[]
}

/** One line of the submit progress list. */
type StepState = 'pending' | 'running' | 'done' | 'skipped' | 'failed'

const today = () => new Date().toISOString().slice(0, 10)

let rowSeq = 0
const newRow = (): Row => ({ key: `r${++rowSeq}`, categoryId: '', quantity: 1, queueChoice: 'none' })

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
  const [rows, setRows] = useState<Row[]>(() => [newRow()])
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

  // Capacity for each chosen category over the window, and who is
  // already in the queue for it. Keyed by CATEGORY, not by row: two
  // rows can never share a type (see the header), and the fetch should
  // not run twice for one answer.
  const [pre, setPre] = useState<Record<string, Preflight>>({})

  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** The line that tripped a capacity conflict, and who it steps on. */
  const [conflict, setConflict] = useState<{ rowKey: string; conflicts: Conflict[] } | null>(null)
  /** Lines the desk has explicitly overridden a conflict on. */
  const [confirmed, setConfirmed] = useState<Record<string, true>>({})
  /** The order this run created, kept so a retry appends to it. */
  const [createdOrder, setCreatedOrder] = useState<{ id: string; orderNumber: string } | null>(null)
  /** Lines that have already landed — a retry skips them. */
  const [landed, setLanded] = useState<Record<string, RowResult>>({})
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

  const catById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories])
  const rowCat = (r: Row) => catById.get(r.categoryId) ?? null

  const datesValid =
    /^\d{4}-\d{2}-\d{2}$/.test(start) && /^\d{4}-\d{2}-\d{2}$/.test(end) && end >= start

  // Preflight: is there anything left for these dates, and who is
  // holding it if not? This is what turns "Create reservation" into the
  // 2nd-Hold choice rather than a silent over-commit. Runs per distinct
  // category on the form; the dependency is the category LIST as a
  // string so adding a line refetches only what changed.
  const catKey = useMemo(
    () => [...new Set(rows.map((r) => r.categoryId).filter(Boolean))].sort().join(','),
    [rows],
  )
  useEffect(() => {
    const ids = catKey ? catKey.split(',') : []
    if (ids.length === 0 || !datesValid) {
      setPre({})
      return
    }
    let cancelled = false
    setPre((p) =>
      Object.fromEntries(
        ids.map((id) => [id, { avail: p[id]?.avail ?? null, stack: p[id]?.stack ?? [], loading: true }]),
      ),
    )
    Promise.all(
      ids.map(async (id) => {
        const [a, st] = await Promise.all([
          fetch(`/api/scheduling/availability?categoryId=${id}&start=${start}&end=${end}`).then((r) => r.json()),
          fetch(`/api/scheduling/stacked-holds?categoryId=${id}&start=${start}&end=${end}`).then((r) => r.json()),
        ])
        const entry: Preflight = {
          loading: false,
          avail:
            typeof a?.availableToHold === 'number'
              ? { availableToHold: a.availableToHold, serviceableCount: a.serviceableCount ?? 0 }
              : null,
          // `rows` — the stacked-holds route's key, already ordered rank
          // then oldest-first within a rank.
          stack: Array.isArray(st?.rows) ? st.rows : [],
        }
        return [id, entry] as const
      }),
    )
      .then((entries) => {
        if (cancelled) return
        setPre(Object.fromEntries(entries))
        // The window moved under the queue choices — they were answers
        // to a different question.
        setRows((rs) => rs.map((r) => ({ ...r, queueChoice: 'none' })))
      })
      .catch(() => {
        if (!cancelled) setPre({})
      })
    return () => {
      cancelled = true
    }
  }, [catKey, start, end, datesValid])

  const preflightLoading = Object.values(pre).some((p) => p.loading)

  /** Nothing left for these dates — the moment the queue matters. */
  function rowAtCapacity(r: Row): boolean {
    const p = pre[r.categoryId]
    return !!p?.avail && p.avail.availableToHold < r.quantity
  }
  /** The queue as it stands for one line's category. */
  function rowQueue(r: Row) {
    const stack = pre[r.categoryId]?.stack ?? []
    const incumbents = stack.filter((h) => h.holdRank === 1)
    const deepest = stack.reduce((m, h) => Math.max(m, h.holdRank), 0)
    /** Where a "2nd Hold" would actually land (2, or 3 behind a 2nd). */
    const nextFreeRank = Math.max(2, deepest + 1)
    return { stack, incumbents, nextFreeRank, stackFull: nextFreeRank > MAX_HOLD_RANK }
  }

  /** The lines that would actually be written. */
  const liveRows = rows.filter((r) => r.categoryId)
  const dupTypes = liveRows
    .map((r) => r.categoryId)
    .filter((id, i, all) => all.indexOf(id) !== i)

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
  if (liveRows.length === 0) blockers.push('pick a vehicle type')
  if (dupTypes.length > 0) blockers.push('one line per type — use the quantity')
  if (!datesValid) blockers.push('check the dates')
  if (liveRows.some((r) => r.quantity < 1)) blockers.push('how many?')
  if (!company) blockers.push('pick a company')
  if (!job) blockers.push('pick a job')
  if (!contactReady && !contactsLoading) {
    if (!contactFirst.trim() || !contactLast.trim()) blockers.push("the contact's first and last name")
    if (!/\S+@\S+\.\S+/.test(contactEmail.trim())) blockers.push("the contact's email")
  }
  if (
    liveRows.some(
      (r) => rowAtCapacity(r) && r.queueChoice === 'none' && !rowQueue(r).stackFull,
    )
  ) {
    blockers.push('choose 2nd Hold or take the 1st')
  }

  const canSubmit = blockers.length === 0 && !contactsLoading && !preflightLoading && !submitting

  const patchRow = (key: string, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)))

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
   * exist while some of its lines (and therefore their holds) do not.
   *
   * It RESUMES. The order it created and the lines that landed are
   * held in state, so the conflict override — and any second press —
   * appends to the same order instead of minting another one.
   */
  async function submit(confirmRowKey?: string) {
    if (!company || !job || liveRows.length === 0) return
    setSubmitting(true)
    setError(null)
    setConflict(null)
    const confirmedNow: Record<string, true> = confirmRowKey
      ? { ...confirmed, [confirmRowKey]: true }
      : confirmed
    if (confirmRowKey) setConfirmed(confirmedNow)
    const mark = (k: string, v: StepState) => setSteps((s) => ({ ...s, [k]: v }))
    const done: Record<string, RowResult> = { ...landed }

    try {
      // 0 — the contact, onto the Job. This is what makes the holds
      // possible two steps later; a failure here is fatal to the flow
      // BY DESIGN, because continuing would produce the exact silent
      // no-hold order this step exists to prevent. On a resumed run the
      // contact is already on the job.
      if (createdOrder || (jobHasContact && !contactTyped)) {
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

      // 1 — the Order, once. Job-as-root: jobId is required and never
      // created here. A resumed run reuses the one it already made.
      let order = createdOrder
      if (order) {
        mark('order', 'done')
      } else {
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
        const created = await orderRes.json().catch(() => ({}))
        if (!orderRes.ok || !created?.id) {
          mark('order', 'failed')
          setError(created?.error || `Could not create the order (${orderRes.status}).`)
          setSubmitting(false)
          return
        }
        order = { id: created.id, orderNumber: created.orderNumber }
        setCreatedOrder(order)
        mark('order', 'done')
      }

      // 2 — every line, in turn. Each one mints or extends the order's
      // single Booking; the first also creates it.
      for (const r of liveRows) {
        const stepKey = `row:${r.key}`
        if (done[r.key]) {
          mark(stepKey, 'done')
          continue
        }
        const category = rowCat(r)
        if (!category) continue
        const label = `${category.name} × ${r.quantity}`
        mark(stepKey, 'running')

        // The rate is the catalog list price; the route re-resolves it
        // against the client's rate card, so this is a display value,
        // not the price of record.
        const lineRes = await fetch(`/api/orders/${order.id}/line-items`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'VEHICLE',
            description: category.name,
            assetCategoryId: category.id,
            department: category.department,
            rateType: 'DAILY',
            rate: category.dailyRate ?? 0,
            quantity: r.quantity,
            pickupDate: start,
            returnDate: end,
            ...(confirmedNow[r.key] ? { confirmConflict: true } : {}),
          }),
        })
        const line = await lineRes.json().catch(() => ({}))

        // Capacity conflict — the route names the bookings this would
        // step on. Warn-with-override, never a hard block: at pickup the
        // truck goes out regardless of what the system thinks. The lines
        // already written stay written; answering the conflict resumes
        // this run from here.
        if (lineRes.status === 409 && line?.requiresConfirmation && Array.isArray(line.conflicts)) {
          mark(stepKey, 'pending')
          setConflict({ rowKey: r.key, conflicts: line.conflicts })
          setLanded(done)
          setSubmitting(false)
          return
        }
        if (!lineRes.ok) {
          mark(stepKey, 'failed')
          const n = Object.keys(done).length
          setError(
            `${line?.error || `Could not add the ${category.name} line (${lineRes.status}).`} ` +
              `Order ${order.orderNumber} exists with ${n} of ${liveRows.length} line${
                liveRows.length === 1 ? '' : 's'
              } on it — open it to finish, or delete it.`,
          )
          setLanded(done)
          setSubmitting(false)
          return
        }

        // 2b — find the hold this line just caused, so we can rank and
        // assign into it.
        const holdRes = await fetch(
          `/api/scheduling/order-hold?orderId=${order.id}&categoryId=${category.id}`,
        )
        const hold = await holdRes.json().catch(() => ({}))
        const bookingItemId: string | null = hold?.bookingItem?.id ?? null

        // 2c — the queue decision, when the desk made one. The hold the
        // line-items route minted carries an AUTOMATIC rank; this stamps
        // the human one over it and locks it so the firmness sweep leaves
        // it alone. Done before assignment so a 2nd Hold never grabs a
        // unit out from under the 1st.
        let placedRank: number | undefined
        let demoted: { bookingNumber: string; from: number; to: number }[] = []
        if (bookingItemId) {
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
          const wantRank = r.queueChoice === 'second' ? rowQueue(r).nextFreeRank : 1
          const rankRes = await fetch(`/api/scheduling/booking-items/${bookingItemId}/rank`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              rank: wantRank,
              demoteOthers: r.queueChoice === 'take-first',
              reason: notes.trim() || null,
            }),
          })
          const rankJson = await rankRes.json().catch(() => ({}))
          if (!rankRes.ok) {
            mark(stepKey, 'failed')
            setError(
              `${rankJson?.reason || rankJson?.error || `Could not place the ${category.name} hold in the queue (${rankRes.status}).`} ` +
                `Order ${order.orderNumber} exists and the units are held — open it to sort the queue out.`,
            )
            setLanded(done)
            setSubmitting(false)
            return
          }
          placedRank = rankJson.holdRank
          demoted = rankJson.demoted || []
        }

        // 2d — optional: bind the next free unit(s) for this line.
        const assigned: string[] = []
        let note: string | null = null
        // A queued hold gets NO unit. The whole point of a 2nd Hold is
        // that the truck is somebody else's until they release it;
        // assigning one here would double-book the asset for real.
        const queuedBehind = (placedRank ?? 1) > 1
        if (!bookingItemId) {
          note = `The ${category.name} line was added but its hold could not be read back — check the order.`
        } else if (queuedBehind) {
          note = `${category.name}: queued as the ${holdRankLabel(placedRank!)} Hold — no unit until the hold ahead releases.`
        } else if (assignNext && canBindUnit) {
          for (let i = 0; i < r.quantity; i++) {
            const availRes = await fetch(
              `/api/scheduling/booking-items/${bookingItemId}/available-units`,
            )
            const av = await availRes.json().catch(() => ({}))
            // `candidates` — NOT `units`. The route returns the pooled
            // counts under `summary` and the pickable rows under
            // `candidates`, already sorted nicest-tier-then-unit-number.
            const units: { assetId: string; unitName: string; state: string }[] = av?.candidates || []
            // "Next available" is the first FREE unit in the list the
            // server already sorted (nicest tier first, then unit number).
            // Buffer-state units are deliberately not auto-picked — they
            // need the human override, not a silent one.
            const next = units.find((u) => u.state === 'free')
            if (!next) {
              note =
                i === 0
                  ? `${category.name}: no unit was free for those dates — it holds the category and shows in the needs-a-unit lane.`
                  : `${category.name}: only ${assigned.length} of ${r.quantity} could be assigned — no other unit is free.`
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
              note = `${next.unitName} could not be assigned (${aj?.error || assignRes.status}). The reservation still holds the category.`
              break
            }
            assigned.push(next.unitName)
          }
        } else if (!canBindUnit) {
          note = 'Units are assigned by dispatch — the reservation holds the category.'
        }

        done[r.key] = {
          key: r.key,
          label,
          bookingNumber: hold?.booking?.bookingNumber ?? null,
          holdRank: placedRank,
          demoted,
          assigned,
          note,
        }
        setLanded({ ...done })
        mark(stepKey, 'done')
      }

      setResult({
        orderId: order.id,
        orderNumber: order.orderNumber,
        rows: liveRows.map((r) => done[r.key]).filter(Boolean),
      })
      setConflict(null)
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

  /** The 2nd-Hold moment, for one line's category. */
  const queueBlock = (r: Row) => {
    const category = rowCat(r)
    const { stack, incumbents, nextFreeRank, stackFull } = rowQueue(r)
    const p = pre[r.categoryId]
    return (
      <div className="rounded-lg border border-chip-warn-fg/30 bg-chip-warn-bg px-3 py-2.5 space-y-2.5">
        <div className="text-[12px] font-semibold text-chip-warn-fg">
          No {category?.name ?? 'unit'} free {start === end ? `on ${start}` : `${start} – ${end}`}
          {p?.avail ? ` — ${p.avail.availableToHold} of ${p.avail.serviceableCount} available` : ''}
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
            This category already has {MAX_HOLD_RANK} holds on those dates. Release one that
            isn&apos;t live, or sub-rent the unit — holds go 1st, 2nd, 3rd.
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => patchRow(r.key, { queueChoice: 'second' })}
              className={`px-3 py-1.5 rounded-lg text-[12px] font-semibold border ${
                r.queueChoice === 'second'
                  ? 'bg-lt-fg text-white border-lt-fg'
                  : 'bg-lt-card text-lt-fg border-lt-hairline hover:border-lt-fg3'
              }`}
            >
              {holdRankLabel(nextFreeRank)} Hold
            </button>
            <button
              type="button"
              onClick={() => patchRow(r.key, { queueChoice: 'take-first' })}
              className={`px-3 py-1.5 rounded-lg text-[12px] font-semibold border ${
                r.queueChoice === 'take-first'
                  ? 'bg-lt-fg text-white border-lt-fg'
                  : 'bg-lt-card text-lt-fg border-lt-hairline hover:border-lt-fg3'
              }`}
            >
              Make 1st Hold and demote other
            </button>
          </div>
        )}
        {r.queueChoice === 'second' && (
          <div className="text-[11px] text-chip-warn-fg">
            Queues behind {incumbents.length === 1 ? 'them' : 'the holds above'}. No unit is assigned
            until the hold ahead releases, and this costs them nothing — a backup doesn&apos;t
            consume capacity.
          </div>
        )}
        {r.queueChoice === 'take-first' && (
          <div className="text-[11px] text-chip-warn-fg">
            {incumbents.length > 0
              ? `${incumbents.map((i) => i.jobName || i.bookingNumber).join(', ')} drops to ${holdRankLabel(2)} Hold.`
              : 'Takes the front of the queue.'}{' '}
            Recorded against your name on the reservation. Nobody is emailed.
          </div>
        )}
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

          {result && !conflict ? (
            /* ── Done ─────────────────────────────────────────────── */
            <div className="px-5 py-4 space-y-3">
              <div className="flex items-center gap-2 text-[13px] font-semibold text-lt-fg">
                <Check size={15} className="text-chip-good-fg" aria-hidden />
                {result.rows.length === 1
                  ? 'Reservation created'
                  : `${result.rows.length} vehicles reserved on one order`}
              </div>
              <div className="rounded-lg bg-lt-inner border border-lt-hairline px-3 py-2 text-[12px] text-lt-fg2 space-y-1">
                <div>
                  Order <span className="font-semibold text-lt-fg">{result.orderNumber}</span>
                  {result.rows[0]?.bookingNumber && (
                    <> · reservation <span className="font-semibold text-lt-fg">{result.rows[0].bookingNumber}</span></>
                  )}
                  {' · '}
                  {start} – {end}
                </div>
                {result.rows.map((rr) => (
                  <div key={rr.key}>
                    <span className="font-semibold text-lt-fg">{rr.label}</span>
                    {rr.holdRank != null && rr.holdRank > 1 && (
                      <> · queued as the {holdRankLabel(rr.holdRank)} Hold</>
                    )}
                    {rr.assigned.length > 0 && (
                      <> · <span className="font-semibold text-lt-fg">{rr.assigned.join(', ')}</span></>
                    )}
                    {rr.demoted && rr.demoted.length > 0 && (
                      <>
                        {' '}· demoted{' '}
                        {rr.demoted.map((d) => `${d.bookingNumber} → ${holdRankLabel(d.to)}`).join(', ')}
                      </>
                    )}
                  </div>
                ))}
              </div>
              {result.rows.some((rr) => rr.note) && (
                <div className="rounded-lg bg-chip-warn-bg text-chip-warn-fg px-3 py-2 text-[12px] space-y-1">
                  {result.rows
                    .filter((rr) => rr.note)
                    .map((rr) => (
                      <div key={rr.key}>{rr.note}</div>
                    ))}
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
              {/* The lines. One per vehicle type; quantity carries the
                  count. They all land on this one order. */}
              <div className="space-y-2">
                <div className="flex items-end justify-between">
                  <label className="block text-[11px] font-semibold text-lt-fg2">
                    Vehicles on this reservation
                  </label>
                  {liveRows.length > 0 && (
                    <span className="text-[11px] text-lt-fg3">
                      {liveRows.reduce((n, r) => n + r.quantity, 0)} unit
                      {liveRows.reduce((n, r) => n + r.quantity, 0) === 1 ? '' : 's'} · one order
                    </span>
                  )}
                </div>

                {rows.map((r) => {
                  const category = rowCat(r)
                  const p = pre[r.categoryId]
                  const dup = !!r.categoryId && dupTypes.includes(r.categoryId)
                  const atCap = rowAtCapacity(r)
                  const written = !!landed[r.key]
                  return (
                    <div
                      key={r.key}
                      className={`rounded-lg border px-2.5 py-2 space-y-1.5 ${
                        written ? 'border-chip-good-fg/40 bg-chip-good-bg/40' : 'border-lt-hairline'
                      }`}
                    >
                      <div className="flex gap-2 items-end">
                        <div className="flex-1 min-w-0">
                          <label
                            htmlFor={`reservation-type-${r.key}`}
                            className="block text-[10px] uppercase tracking-wide text-lt-fg3 mb-0.5"
                          >
                            Vehicle type
                          </label>
                          <select
                            id={`reservation-type-${r.key}`}
                            value={r.categoryId}
                            disabled={written}
                            onChange={(e) => patchRow(r.key, { categoryId: e.target.value, queueChoice: 'none' })}
                            className="w-full border border-lt-hairline rounded-lg px-2 py-1.5 text-[13px] bg-lt-card text-lt-fg disabled:opacity-60"
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
                            htmlFor={`reservation-qty-${r.key}`}
                            className="block text-[10px] uppercase tracking-wide text-lt-fg3 mb-0.5"
                          >
                            How many
                          </label>
                          <input
                            id={`reservation-qty-${r.key}`}
                            type="number"
                            min={1}
                            value={r.quantity}
                            disabled={written}
                            onChange={(e) =>
                              patchRow(r.key, {
                                quantity: Math.max(1, parseInt(e.target.value) || 1),
                                queueChoice: 'none',
                              })
                            }
                            className="w-20 border border-lt-hairline rounded-lg px-2 py-1.5 text-[13px] bg-lt-card text-lt-fg disabled:opacity-60"
                          />
                        </div>
                        {rows.length > 1 && !written && (
                          <button
                            type="button"
                            onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}
                            title="Remove this vehicle"
                            aria-label="Remove this vehicle"
                            className="shrink-0 mb-1 p-1.5 rounded-lg border border-lt-hairline text-lt-fg3 hover:text-chip-bad-fg hover:border-chip-bad-fg/40"
                          >
                            <Trash2 size={13} aria-hidden />
                          </button>
                        )}
                      </div>

                      {written && (
                        <p className="text-[11px] text-chip-good-fg font-semibold">
                          Already on order {createdOrder?.orderNumber} — this line is written.
                        </p>
                      )}
                      {dup && !written && (
                        <p className="text-[11px] text-chip-bad-fg">
                          That type is already on this reservation — raise its quantity instead.
                        </p>
                      )}
                      {category && !dup && !written && p && !p.loading && p.avail && !atCap && (
                        <p className="text-[11px] text-chip-good-fg">
                          {p.avail.availableToHold} of {p.avail.serviceableCount} available for these
                          dates
                        </p>
                      )}
                      {category?.dailyRate != null && !written && (
                        <p className="text-[11px] text-lt-fg3">
                          ${category.dailyRate}/day list — the client&apos;s own rate card is applied
                          when the line is priced.
                        </p>
                      )}
                      {/* Zero availability — the 2nd Hold moment (Wes
                          2026-09-09). A category at capacity with no
                          replacement unit is a queue decision, not an
                          error, so the two real answers are offered by
                          name. Backups never consume capacity, so a 2nd
                          Hold costs the production ahead nothing. */}
                      {atCap && !written && queueBlock(r)}
                    </div>
                  )
                })}

                <button
                  type="button"
                  onClick={() => setRows((rs) => [...rs, newRow()])}
                  disabled={submitting}
                  className="inline-flex items-center gap-1 text-[11px] font-semibold text-lt-fg3 hover:text-lt-fg disabled:opacity-40"
                >
                  <Plus size={12} aria-hidden /> Add another vehicle
                </button>
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
              <p className="-mt-2 text-[11px] text-lt-fg3">
                One window for the whole order. A vehicle that needs different dates is its own
                reservation.
              </p>

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
                      Takes the first free unit for these dates, nicest tier first, for every line.
                      Units in the turnaround buffer are left for a human to override.
                    </span>
                  </span>
                </label>
              )}

              {/* Conflict override — for the one line that tripped it. */}
              {conflict && (
                <div className="rounded-lg bg-chip-warn-bg text-chip-warn-fg px-3 py-2 text-[12px] space-y-2">
                  <div className="font-semibold">
                    {rowCat(rows.find((r) => r.key === conflict.rowKey) ?? rows[0])?.name ?? 'That line'}{' '}
                    would step on {conflict.conflicts.length} other reservation
                    {conflict.conflicts.length === 1 ? '' : 's'}:
                  </div>
                  <ul className="space-y-0.5">
                    {conflict.conflicts.map((c, i) => (
                      <li key={i}>
                        · {c.bookingNumber}
                        {c.jobName ? ` · ${c.jobName}` : ''} · {c.startDate}–{c.endDate} · qty{' '}
                        {c.quantity}
                      </li>
                    ))}
                  </ul>
                  {createdOrder && (
                    <div className="text-[11px]">
                      Order {createdOrder.orderNumber} is already created — answering this adds the
                      rest of the lines to it.
                    </div>
                  )}
                  {(() => {
                    const r = rows.find((x) => x.key === conflict.rowKey)
                    const atCap = r ? rowAtCapacity(r) : false
                    return (
                      <button
                        onClick={() => submit(conflict.rowKey)}
                        disabled={submitting || (atCap && r?.queueChoice === 'none')}
                        className="px-3 py-1.5 rounded-lg bg-lt-card border border-lt-hairline text-[12px] font-semibold text-lt-fg disabled:opacity-50"
                      >
                        {atCap && r?.queueChoice === 'second'
                          ? `Reserve as ${holdRankLabel(rowQueue(r).nextFreeRank)} Hold`
                          : atCap && r?.queueChoice === 'take-first'
                            ? 'Take the 1st Hold'
                            : 'Reserve anyway'}
                      </button>
                    )
                  })()}
                </div>
              )}

              {error && (
                <div className="rounded-lg bg-chip-bad-bg text-chip-bad-fg px-3 py-2 text-[12px] space-y-2">
                  <div>{error}</div>
                  {createdOrder && (
                    <a
                      href={`/orders/${createdOrder.id}`}
                      className="inline-block px-2 py-1 rounded bg-lt-card border border-lt-hairline text-[11px] font-semibold text-lt-fg"
                    >
                      Open {createdOrder.orderNumber}
                    </a>
                  )}
                </div>
              )}

              {submitting && (
                <div className="rounded-lg bg-lt-inner border border-lt-hairline px-3 py-2 space-y-1">
                  {stepRow('contact', 'Attaching the contact')}
                  {stepRow('order', 'Creating the order')}
                  {liveRows.map((r) =>
                    stepRow(
                      `row:${r.key}`,
                      `Reserving ${rowCat(r)?.name ?? 'the vehicle'} × ${r.quantity}` +
                        (r.queueChoice === 'second'
                          ? ` as the ${holdRankLabel(rowQueue(r).nextFreeRank)} Hold`
                          : ''),
                    ),
                  )}
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
                  onClick={() => submit()}
                  disabled={!canSubmit}
                  className="mt-3 px-4 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 disabled:opacity-40 text-white text-[12px] font-semibold"
                >
                  {submitting
                    ? 'Working…'
                    : createdOrder
                      ? `Add the rest to ${createdOrder.orderNumber}`
                      : liveRows.length > 1
                        ? `Create ${liveRows.length} reservations on one order`
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
