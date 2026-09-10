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
 * WHICH TRUCK, not just which type (Wes 2026-09-10). Most
 * reservations don't care — "a cargo van" is the whole request, and
 * "assign the next available unit" answers it. But a production that
 * asked for the van they had last week, or the cube with the lift
 * gate, had no way to say so here: the desk created the order, closed
 * this window, found the hold on the board and re-assigned it. Each
 * line now carries an optional list of NAMED units, offered from the
 * same per-window availability this form already fetches for its
 * capacity read. Naming fewer units than the quantity is legal — the
 * named ones are bound and "next available" covers the remainder.
 *
 * A named unit is ALSO the human override the turnaround buffer asks
 * for, so a buffer unit may be picked here (`bufferOverride`) while
 * "next available" still refuses to take one on its own. A unit
 * already booked over the window is not offered at all — that is a
 * queue decision, and the queue lives above.
 *
 * PRE-LOADED FROM AN INBOUND REQUEST (Wes 2026-09-10: "we need to add
 * the workflow of starting with making a reservation and quote
 * following if vehicles are on the request"). Capture & Quote builds
 * the quote first and lets the hold fall out of it at the end. On a
 * web-form request that already names trucks and dates, that is
 * backwards — the truck is the scarce thing and the money is the easy
 * part. `prefill` arrives from the New inbound card carrying the
 * request's vehicles, window, company, contact and notes; the desk
 * confirms the queue, picks the job, and the order it creates is where
 * the quote gets written.
 *
 * The request's NON-vehicle lines ride along onto the same order. They
 * can't be held and they aren't what this window is for, but the
 * client asked for them, and an order that silently drops half a
 * request is worse than one that carries lines the desk has to price.
 *
 * The inquiry is closed CONVERTED on the way out, the same two ways
 * Capture & Quote closes it — convertedJobId for a job created here,
 * convertedOrderId when the reservation went onto a job that already
 * existed. Non-fatal: an order with holds and a still-open inquiry is
 * a duplicate-work risk, not a data loss.
 *
 * READ THE REQUEST BEFORE YOU HOLD (Wes 2026-09-10: "we need to be able
 * to open a drawer to read the email here to get our eyes on it as a
 * safeguard"). The summary line above the form is parsed — it shows the
 * trucks and the window and nothing else, so a delivery address, a phone
 * number, a role, or a question the client typed into Notes ("do you
 * offer overnight parking for the truck?") never reaches the eye of the
 * person about to commit a unit. The panel opens InquirySourceDrawer —
 * the same read-only slide-over the new-quote review step uses, over the
 * form, closing back onto unsaved state. It is not a triage surface:
 * capture / dismiss / attach-to-job stay on the inbound card and the
 * inquiry page. These requests are WEB_FORM and carry no email row, so
 * what it renders is the submission as captured; the drawer falls back to
 * it on its own and the wording says "request", not "email".
 *
 * Nothing here emails anybody. Creating an order + holds is internal
 * work; the client-facing sends live behind Send quote / Book it, and
 * adding a job contact deliberately sends no portal invite.
 */

import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Check, Loader2, Mail, Plus, Trash2, X } from 'lucide-react'
import { CompanyPicker } from '@/components/orders/CompanyPicker'
import { InquirySourceDrawer } from '@/components/inquiries/InquirySourceDrawer'
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
  /** Units reserved over the API's trailing demand window (see
   *  /api/scheduling/categories). Drives the order of the type picker. */
  recentDemand?: number
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
  /** Units the agent named, by asset id. Empty = let "next available"
   *  decide. Never longer than `quantity`; trimmed when it shrinks. */
  unitIds: string[]
  /** This line came off an inbound request. An unresolved one BLOCKS
   *  the submit: liveRows quietly skips a row with no type, which on a
   *  hand-built form is forgiving and on a client's request is losing
   *  half of what they asked for. */
  fromRequest?: boolean
}

/** One unit of a category, with its state over the reservation window. */
interface UnitOption {
  assetId: string
  unitName: string
  tier: AssetTier
  state: 'free' | 'buffer' | 'booked'
}

/** Capacity + queue for one category over the reservation's window. */
interface Preflight {
  loading: boolean
  avail: { availableToHold: number; serviceableCount: number } | null
  stack: StackEntry[]
  /** Every serviceable unit of the category over the window, nicest
   *  tier first — the source for the "which unit" picker. */
  units: UnitOption[]
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
  /** How many of the request's non-vehicle lines made it onto the
   *  order, and what went wrong for any that didn't. */
  supplies?: { added: number; total: number; note: string | null }
}

/** One line of the submit progress list. */
type StepState = 'pending' | 'running' | 'done' | 'skipped' | 'failed'

const today = () => new Date().toISOString().slice(0, 10)

type AssetTier = 'PREMIUM' | 'STANDARD' | 'ECONOMY'
/** Same order the assignment picker uses — nicest tier first. */
const TIER_ORDER: Record<AssetTier, number> = { PREMIUM: 0, STANDARD: 1, ECONOMY: 2 }

let rowSeq = 0
const newRow = (): Row => ({
  key: `r${++rowSeq}`,
  categoryId: '',
  quantity: 1,
  queueChoice: 'none',
  unitIds: [],
})

/** A non-vehicle line from the same inbound request. */
export interface PrefillSupply {
  inventoryItemId: string
  name: string
  quantity: number
  /** LineItemType off the catalog row — EQUIPMENT, EXPENDABLE, … */
  type: string
  flat: boolean
  department: string | null
  rate: number
  pickupDate: string | null
  returnDate: string | null
}

/** Everything an inbound request hands the desk. See the header. */
export interface ReservationPrefill {
  /** The inquiry this came from — closed CONVERTED once it lands. */
  inquiryId: string
  vehicles: { fleetCategoryId: string | null; name: string; quantity: number }[]
  supplies: PrefillSupply[]
  start: string | null
  end: string | null
  company: { id: string; name: string } | null
  companyName: string | null
  jobName: string | null
  contact: { firstName: string; lastName: string; email: string } | null
  notes: string | null
}

export function MakeReservationModal({
  defaultStart,
  defaultEnd,
  canBindUnit = true,
  prefill,
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
  /** Opens the window already loaded from an inbound request. */
  prefill?: ReservationPrefill
  onClose: () => void
  onCreated: () => void
}) {
  const [categories, setCategories] = useState<Category[]>([])
  // One row per requested vehicle when the window opened from an
  // inbound request; a type the catalog can't fleet-link comes through
  // as an EMPTY row, which the blockers then insist the desk fills in.
  // Dropping it would lose the ask silently.
  const [rows, setRows] = useState<Row[]>(() =>
    prefill && prefill.vehicles.length > 0
      ? prefill.vehicles.map((v) => ({
          ...newRow(),
          categoryId: v.fleetCategoryId ?? '',
          quantity: v.quantity,
          fromRequest: true,
        }))
      : [newRow()],
  )
  const [start, setStart] = useState(prefill?.start || defaultStart || today())
  const [end, setEnd] = useState(
    prefill?.end || prefill?.start || defaultEnd || defaultStart || today(),
  )
  const [company, setCompany] = useState<{ id: string; name: string } | null>(
    prefill?.company ?? null,
  )
  const [job, setJob] = useState<{ id: string; jobCode: string; name: string } | null>(null)
  /** Did the agent CREATE the job, or attach to one that existed? The
   *  inquiry closes against a different column for each. */
  const [jobCreated, setJobCreated] = useState(false)
  const [resolverOpen, setResolverOpen] = useState(false)
  /** The read-the-request drawer — see the header. */
  const [sourceOpen, setSourceOpen] = useState(false)
  const [assignNext, setAssignNext] = useState(true)
  /** Which lines have the unit picker open. A line that has named a
   *  unit is open regardless — the picks have to stay visible. */
  const [openPickers, setOpenPickers] = useState<Record<string, boolean>>({})
  const [notes, setNotes] = useState(prefill?.notes ?? '')
  // The person this reservation is for. Only asked for when the job has
  // nobody — see the header. `null` = not looked up yet (or no job).
  const [contactFirst, setContactFirst] = useState(prefill?.contact?.firstName ?? '')
  const [contactLast, setContactLast] = useState(prefill?.contact?.lastName ?? '')
  const [contactEmail, setContactEmail] = useState(prefill?.contact?.email ?? '')
  const [jobContacts, setJobContacts] = useState<{ name: string; email: string; role: string }[] | null>(null)
  const [contactsLoading, setContactsLoading] = useState(false)

  // Inline "+ New company" — same 409 near-match discipline the hold
  // modal uses: the agent picks "use existing" or "create anyway",
  // never an auto-merge.
  const [creatingCompany, setCreatingCompany] = useState(false)
  // A request that named a company with no row of its own opens the
  // inline create with the client's own words already typed.
  const [newCompanyName, setNewCompanyName] = useState(
    prefill?.company ? '' : (prefill?.companyName ?? ''),
  )
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
  /** The request's non-vehicle lines, once written. A retry must not
   *  post them twice — the order would carry the gear in duplicate. */
  const [suppliesLanded, setSuppliesLanded] = useState(false)
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

  // The type picker leads with what the yard actually rents (Wes
  // 2026-09-10). Alphabetical put "2 Unit Restroom Trailer" above the
  // cargo vans and SuperCubes that are most of the book, so every
  // reservation started with a scroll. Busiest first, ties A–Z; the
  // never-booked tail keeps its own group so a rare type is still
  // findable instead of buried mid-list.
  const [busyCats, quietCats] = useMemo(() => {
    const byDemand = [...categories].sort(
      (a, b) => (b.recentDemand ?? 0) - (a.recentDemand ?? 0) || a.name.localeCompare(b.name),
    )
    return [
      byDemand.filter((c) => (c.recentDemand ?? 0) > 0),
      byDemand.filter((c) => (c.recentDemand ?? 0) === 0),
    ]
  }, [categories])
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
        ids.map((id) => [
          id,
          { avail: p[id]?.avail ?? null, stack: p[id]?.stack ?? [], units: p[id]?.units ?? [], loading: true },
        ]),
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
          // The availability read already names every serviceable unit
          // and its state for the window, so the picker costs no extra
          // request. Out-of-service units are absent by construction —
          // the engine leaves them out — which is what we want here.
          units: (Array.isArray(a?.units) ? (a.units as UnitOption[]) : []).slice().sort(
            (u, v) =>
              TIER_ORDER[u.tier] - TIER_ORDER[v.tier] ||
              u.unitName.localeCompare(v.unitName, undefined, { numeric: true }),
          ),
        }
        return [id, entry] as const
      }),
    )
      .then((entries) => {
        if (cancelled) return
        setPre(Object.fromEntries(entries))
        // The window moved under the queue choices AND the named units —
        // both were answers to a different question, and a unit that was
        // free last week may not be free now.
        setRows((rs) => rs.map((r) => ({ ...r, queueChoice: 'none', unitIds: [] })))
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
  if (rows.some((r) => r.fromRequest && !r.categoryId)) {
    blockers.push('name a fleet type for every vehicle on the request, or remove the line')
  }
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

  /** Name a unit, or take the name back. Capped at the line's quantity
   *  — the cap is what stops "pick a specific van" from quietly
   *  becoming "pick four", since the assign route would refuse the
   *  extras anyway and the desk would only find out mid-write. */
  const toggleUnit = (r: Row, assetId: string) =>
    patchRow(r.key, {
      unitIds: r.unitIds.includes(assetId)
        ? r.unitIds.filter((id) => id !== assetId)
        : r.unitIds.length >= r.quantity
          ? r.unitIds
          : [...r.unitIds, assetId],
    })

  function onJobResolved(r: ResolvedJob) {
    setJob({ id: r.id, jobCode: r.jobCode, name: r.name })
    setJobCreated(r.created)
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
        } else if (canBindUnit && (assignNext || r.unitIds.length > 0)) {
          // The units the agent NAMED go on first, in the order they
          // were picked. A named unit is a deliberate human choice, so
          // it carries the buffer override the "next available" pass
          // below deliberately withholds.
          const picked = r.unitIds.slice(0, r.quantity)
          for (const assetId of picked) {
            const u = pre[category.id]?.units.find((x) => x.assetId === assetId)
            const assignRes = await fetch(
              `/api/scheduling/booking-items/${bookingItemId}/assign`,
              {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  assetId,
                  orderId: order.id,
                  ...(u?.state === 'buffer' ? { bufferOverride: true } : {}),
                }),
              },
            )
            if (!assignRes.ok) {
              const aj = await assignRes.json().catch(() => ({}))
              note = `${u?.unitName ?? 'That unit'} could not be assigned (${aj?.reason || aj?.error || assignRes.status}). The reservation still holds the category.`
              break
            }
            assigned.push(u?.unitName ?? 'unit')
          }

          // Whatever the names didn't cover — the whole line when none
          // were named — falls to "next available", if it's ticked.
          if (!note && assignNext) {
            for (let i = assigned.length; i < r.quantity; i++) {
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
                  assigned.length === 0
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
                note = `${next.unitName} could not be assigned (${aj?.reason || aj?.error || assignRes.status}). The reservation still holds the category.`
                break
              }
              assigned.push(next.unitName)
            }
          } else if (!note && assigned.length < r.quantity) {
            // Named some, but "next available" is off — say so rather
            // than leaving a half-covered hold looking finished.
            note = `${category.name}: ${assigned.length} of ${r.quantity} named — the rest hold the category with no unit yet.`
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

      // 3 — the rest of the request. Gear, expendables, whatever else
      // was in the client's cart: not reservable, not what this window
      // is for, but asked for. A failure here is reported, never fatal
      // — the trucks are held and the order exists either way.
      let supplySummary: Result['supplies']
      const wanted = prefill?.supplies ?? []
      if (wanted.length > 0) {
        if (suppliesLanded) {
          mark('supplies', 'skipped')
        } else {
          mark('supplies', 'running')
          let added = 0
          let supplyNote: string | null = null
          for (const sup of wanted) {
            const res = await fetch(`/api/orders/${order.id}/line-items`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                // The snapshot's own type is InventoryItem.type, which
                // IS a LineItemType — pass it through so an expendable
                // doesn't land as equipment.
                type: sup.type,
                description: sup.name,
                inventoryItemId: sup.inventoryItemId,
                ...(sup.department ? { department: sup.department } : {}),
                // EXPENDABLE bills flat (qty × rate) — a consumable has
                // no rental days. Everything else is daily over the
                // order's window.
                rateType: sup.flat ? 'FLAT' : 'DAILY',
                rate: sup.rate,
                quantity: sup.quantity,
                ...(sup.flat ? {} : { pickupDate: sup.pickupDate ?? start, returnDate: sup.returnDate ?? end }),
              }),
            })
            if (!res.ok) {
              const sj = await res.json().catch(() => ({}))
              supplyNote = `${sup.name} could not be added (${sj?.reason || sj?.error || res.status}) — add it on the order.`
              break
            }
            added++
          }
          if (added > 0) setSuppliesLanded(true)
          supplySummary = { added, total: wanted.length, note: supplyNote }
          mark('supplies', supplyNote ? 'failed' : 'done')
        }
      }

      // 4 — close the inquiry, the same two ways Capture & Quote does.
      // Non-fatal: a still-open inquiry over a live order is duplicate
      // work waiting to happen, not lost data.
      if (prefill?.inquiryId) {
        try {
          await fetch(`/api/inquiries/${encodeURIComponent(prefill.inquiryId)}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(
              jobCreated
                ? { status: 'CONVERTED', convertedJobId: job.id }
                : { status: 'CONVERTED', convertedOrderId: order.id },
            ),
          })
        } catch {
          // Non-fatal — see above.
        }
      }

      setResult({
        orderId: order.id,
        orderNumber: order.orderNumber,
        rows: liveRows.map((r) => done[r.key]).filter(Boolean),
        supplies: supplySummary,
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

  /**
   * WHICH UNIT, for one line (Wes 2026-09-10). Closed by default —
   * "next available" is the right answer for most reservations and an
   * always-open grid of unit chips would bury the rest of the form.
   * Open, it is the same list the assignment picker shows: every
   * serviceable unit for the window, nicest tier first, each labelled
   * with what it is doing on those dates.
   */
  const unitPicker = (r: Row) => {
    const p = pre[r.categoryId]
    if (!p || p.loading) {
      return <p className="text-[11px] text-lt-fg3">Checking which units are free…</p>
    }
    const units = p.units
    if (units.length === 0) return null
    const chosen = r.unitIds
    const open = chosen.length > 0 || !!openPickers[r.key]

    if (!open) {
      return (
        <div className="flex items-center gap-2 text-[11px]">
          <span className="text-lt-fg3">
            Unit: {assignNext ? 'next available' : 'assigned later'}
          </span>
          <button
            type="button"
            onClick={() => setOpenPickers((o) => ({ ...o, [r.key]: true }))}
            className="font-semibold text-lt-fg2 hover:text-lt-fg underline underline-offset-2"
          >
            Pick {r.quantity > 1 ? 'specific units' : 'a specific unit'}
          </button>
        </div>
      )
    }

    return (
      <div className="rounded-lg border border-lt-hairline bg-lt-inner px-2.5 py-2 space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[10px] uppercase tracking-wide text-lt-fg3">
            Which {r.quantity > 1 ? 'units' : 'unit'}
          </span>
          <button
            type="button"
            onClick={() => {
              setOpenPickers((o) => ({ ...o, [r.key]: false }))
              patchRow(r.key, { unitIds: [] })
            }}
            className="text-[11px] font-semibold text-lt-fg3 hover:text-lt-fg"
          >
            Any unit
          </button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {units.map((u) => {
            const picked = chosen.includes(u.assetId)
            const full = !picked && chosen.length >= r.quantity
            const disabled = u.state === 'booked' || full
            return (
              <button
                key={u.assetId}
                type="button"
                disabled={disabled}
                onClick={() => toggleUnit(r, u.assetId)}
                aria-pressed={picked}
                title={
                  u.state === 'booked'
                    ? 'Booked over these dates — the queue above is the way in'
                    : full
                      ? `Only ${r.quantity} needed — unpick one, or raise the quantity`
                      : u.state === 'buffer'
                        ? 'In the turnaround buffer for these dates — picking it is the override'
                        : undefined
                }
                className={`px-2 py-1 rounded-lg text-[12px] font-semibold border ${
                  picked
                    ? 'bg-lt-fg text-white border-lt-fg'
                    : u.state === 'booked'
                      ? 'bg-lt-card text-lt-fg3 border-lt-hairline line-through cursor-not-allowed'
                      : full
                        ? 'bg-lt-card text-lt-fg3 border-lt-hairline cursor-not-allowed'
                        : u.state === 'buffer'
                          ? 'bg-chip-warn-bg text-chip-warn-fg border-chip-warn-fg/30 hover:border-chip-warn-fg/60'
                          : 'bg-lt-card text-lt-fg border-lt-hairline hover:border-lt-fg3'
                }`}
              >
                {u.unitName}
                {u.state === 'buffer' && (
                  <span className="ml-1 font-normal opacity-80">turnaround</span>
                )}
                {u.state === 'booked' && (
                  <span className="ml-1 font-normal no-underline opacity-80">booked</span>
                )}
              </button>
            )
          })}
        </div>
        <p className="text-[11px] text-lt-fg3">
          {chosen.length === 0
            ? assignNext
              ? 'Nothing named — the next free unit is taken.'
              : 'Nothing named — the reservation holds the category only.'
            : chosen.length < r.quantity
              ? `${chosen.length} of ${r.quantity} named${
                  assignNext ? ' — the rest take the next free unit' : ' — the rest hold the category only'
                }.`
              : `Bound to ${chosen.length === 1 ? 'this unit' : 'these units'}.`}
        </p>
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
              onClick={() => patchRow(r.key, { queueChoice: 'second', unitIds: [] })}
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
            <h2 className="text-sm font-bold text-lt-fg">
              {prefill ? 'Reserve the request' : 'Make a reservation'}
            </h2>
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
              {result.supplies && (
                <div className="text-[12px] text-lt-fg2">
                  {result.supplies.added} of {result.supplies.total} other requested line
                  {result.supplies.total === 1 ? '' : 's'} added to the order.
                </div>
              )}
              {prefill && (
                <div className="text-[11px] text-lt-fg3">
                  The inquiry is closed — the trucks are held, and the quote is written on{' '}
                  {result.orderNumber}. Nobody has been emailed.
                </div>
              )}
              {(result.supplies?.note || result.rows.some((rr) => rr.note)) && (
                <div className="rounded-lg bg-chip-warn-bg text-chip-warn-fg px-3 py-2 text-[12px] space-y-1">
                  {result.rows
                    .filter((rr) => rr.note)
                    .map((rr) => (
                      <div key={rr.key}>{rr.note}</div>
                    ))}
                  {result.supplies?.note && <div>{result.supplies.note}</div>}
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
                  {prefill ? 'Price the quote →' : 'Open the order'}
                </a>
              </div>
            </div>
          ) : (
            /* ── Form ─────────────────────────────────────────────── */
            <div className="px-5 py-4 space-y-4">
              {/* Opened from an inbound request: say what was asked for,
                  in the client's terms, so the desk can see at a glance
                  whether the form below still matches it. */}
              {prefill && (
                <div className="rounded-lg border border-lt-hairline bg-lt-inner px-3 py-2 text-[12px] text-lt-fg2 space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-[10px] uppercase tracking-wide text-lt-fg3">
                      From the request
                    </div>
                    <button
                      type="button"
                      onClick={() => setSourceOpen(true)}
                      className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-700 hover:text-amber-600 underline underline-offset-2"
                    >
                      <Mail className="w-3 h-3" />
                      Read the request
                    </button>
                  </div>
                  <div>
                    {prefill.vehicles
                      .map((v) => `${v.quantity}× ${v.name}`)
                      .join(' · ')}
                    {prefill.start && (
                      <>
                        {' · '}
                        {prefill.start === prefill.end
                          ? prefill.start
                          : `${prefill.start} – ${prefill.end}`}
                      </>
                    )}
                  </div>
                  {prefill.supplies.length > 0 && (
                    <div className="text-[11px] text-lt-fg3">
                      Plus {prefill.supplies.length} non-vehicle line
                      {prefill.supplies.length === 1 ? '' : 's'} — added to the same order, priced on
                      the quote.
                    </div>
                  )}
                  {prefill.vehicles.some((v) => !v.fleetCategoryId) && (
                    <div className="rounded bg-chip-warn-bg text-chip-warn-fg px-2 py-1 text-[11px]">
                      No fleet type is linked to{' '}
                      {prefill.vehicles
                        .filter((v) => !v.fleetCategoryId)
                        .map((v) => v.name)
                        .join(', ')}{' '}
                      — pick what it should hold below, or drop the line and quote it as a
                      sub-rental.
                    </div>
                  )}
                </div>
              )}

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
                            onChange={(e) =>
                              patchRow(r.key, {
                                categoryId: e.target.value,
                                queueChoice: 'none',
                                unitIds: [],
                              })
                            }
                            className="w-full border border-lt-hairline rounded-lg px-2 py-1.5 text-[13px] bg-lt-card text-lt-fg disabled:opacity-60"
                          >
                            <option value="">Select a type…</option>
                            {quietCats.length === 0 ? (
                              busyCats.map((c) => (
                                <option key={c.id} value={c.id}>
                                  {c.name} ({c.totalUnits})
                                </option>
                              ))
                            ) : (
                              <>
                                {busyCats.length > 0 && (
                                  <optgroup label="Most booked">
                                    {busyCats.map((c) => (
                                      <option key={c.id} value={c.id}>
                                        {c.name} ({c.totalUnits})
                                      </option>
                                    ))}
                                  </optgroup>
                                )}
                                <optgroup label={busyCats.length > 0 ? 'Rarely booked' : 'All types'}>
                                  {quietCats.map((c) => (
                                    <option key={c.id} value={c.id}>
                                      {c.name} ({c.totalUnits})
                                    </option>
                                  ))}
                                </optgroup>
                              </>
                            )}
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
                            onChange={(e) => {
                              const q = Math.max(1, parseInt(e.target.value) || 1)
                              // Dropping the quantity drops the named
                              // units past it — the assign route would
                              // refuse them anyway, mid-write.
                              setRows((rs) =>
                                rs.map((x) =>
                                  x.key === r.key
                                    ? { ...x, quantity: q, queueChoice: 'none', unitIds: x.unitIds.slice(0, q) }
                                    : x,
                                ),
                              )
                            }}
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

                      {r.fromRequest && !r.categoryId && !written && (
                        <p className="text-[11px] text-chip-warn-fg">
                          On the request, with no fleet type behind it. Pick what holds it, or
                          remove the line and quote it as a sub-rental.
                        </p>
                      )}
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
                      {/* Which truck, not just which type. Hidden for a
                          queued hold: a 2nd Hold gets no unit at all, so
                          naming one would be a promise the write can't
                          keep. */}
                      {canBindUnit && category && !dup && !written && r.queueChoice !== 'second' &&
                        unitPicker(r)}
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
                      Takes the first free unit for these dates, nicest tier first, for every line
                      you didn&apos;t name a unit on. Units in the turnaround buffer are left for a
                      human to override — pick one by name above to do that.
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
                  {(prefill?.supplies.length ?? 0) > 0 &&
                    stepRow(
                      'supplies',
                      `Adding ${prefill!.supplies.length} more line${
                        prefill!.supplies.length === 1 ? '' : 's'
                      } from the request`,
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
            companyName: company?.name ?? prefill?.companyName ?? null,
            dates: datesValid ? { start, end } : null,
            // The request already named the production and who is
            // asking — the resolver ranks on both, so withholding them
            // would make it re-ask what the client already typed.
            jobNameHint: prefill?.jobName ?? null,
            contactName: prefill?.contact
              ? `${prefill.contact.firstName} ${prefill.contact.lastName}`
              : null,
            contactEmail: prefill?.contact?.email ?? null,
          }}
          onResolved={onJobResolved}
          onClose={() => setResolverOpen(false)}
        />
      )}

      {/* Rendered AFTER the modal's own overlay so it paints above it —
          both are fixed at z-50 and DOM order breaks the tie. */}
      <InquirySourceDrawer
        inquiryId={sourceOpen && prefill ? prefill.inquiryId : null}
        title={prefill?.jobName ?? prefill?.companyName ?? null}
        onClose={() => setSourceOpen(false)}
      />
    </>
  )
}
