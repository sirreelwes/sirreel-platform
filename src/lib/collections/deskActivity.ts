import { prisma } from '@/lib/prisma'
import { openArTotal } from '@/lib/collections/collectible'
import { pacificDayRange, pacificToday } from '@/lib/collections/eodReport'

/**
 * The collections desk, live.
 *
 * Wes, 2026-09-14: *"I'd love to see, in real time, what kind of collections
 * numbers are coming in and what kind of outreach she is doing."*
 *
 * Until now the only answer to that was the END-OF-DAY report — four figures,
 * once, at 6pm, assembled by the person being asked about. Everything
 * underneath it was already in HQ with a name and a timestamp on it; nothing
 * read it back.
 *
 * ── Two halves, and only one of them is money ──────────────────────────────
 *
 * MONEY IN is provable. Every card charge on the desk writes an
 * `RwCollectionCharge` with `chargedById`; every non-card collection writes
 * `JobFinalInvoice.collectedAt/collectedById`; HQ-native invoices write a
 * `Payment` with `recordedById`. Three tables, three ways money arrives, all
 * attributed.
 *
 * OUTREACH is counted, not judged. Ana's mailbox is already ingested by the
 * Gmail Pub/Sub watcher (see watchedInboxes.ts), so an email she sends is a
 * row here within seconds of her sending it. That makes "how many, to whom,
 * about what" answerable — and stops there. Subject and recipient are shown;
 * the body is not. A manager needs to know the chase is happening, not to
 * read the correspondence.
 *
 * ── What this deliberately does NOT do ────────────────────────────────────
 *
 * It does not score anyone. Emails sent is an ACTIVITY count and a bad
 * performance metric — twelve one-line chases is not better work than three
 * calls that cleared $40k, and a view that ranked them would quietly teach
 * the desk to send more email. Dollars collected and open AR are the outcome
 * numbers; the activity columns sit beside them as evidence of effort, not as
 * a leaderboard.
 *
 * Phone calls are invisible here — HQ never sees them — so an empty hour is
 * not proof of an idle one. The page says so rather than letting the absence
 * read as a finding.
 *
 * ── Why three windows and not a date picker ───────────────────────────────
 *
 * Today answers "what is coming in right now", 7 days answers "is this week
 * normal", 30 days gives the operator table enough rows to mean anything. All
 * three come from ONE 30-day fetch bucketed in memory: the volumes are tiny
 * (10 charges and 179 emails in the 30 days to 2026-09-14) and three windows
 * × eight queries would have been twenty-four round trips for the same
 * answer.
 */

/**
 * The mailboxes collections actually works out of.
 *
 * Getting this list right was most of the work. The obvious answer —
 * ana@sirreel.com — is the wrong one: of the 70 messages her personal mailbox
 * sent in the 30 days to 2026-09-14, exactly ONE went to a client. The
 * collections correspondence goes out as billing@ (892 messages, 747 of them
 * client-facing in the same window) and payments@, both signed by hand.
 *
 * A desk view built on ana@ would have reported a single email a month and
 * read as a desk doing nothing. Point it at the mailbox where the work
 * happens, not at the mailbox named after the person.
 *
 * `owner` is who a mailbox's mail can honestly be attributed to. billing@ and
 * payments@ send under "SirReel Billing" / "SirReel Accounting" with no
 * per-person display name, so an individual cannot be read off the header —
 * they count toward the DESK, and the per-person table leaves them out rather
 * than guessing. Give a shared mailbox an owner only if it genuinely has one.
 */
export interface DeskMailbox {
  address: string
  label: string
  /** Lowercase address of the one person who sends from here, if any. */
  owner: string | null
}

export const DESK_MAILBOXES: readonly DeskMailbox[] = [
  { address: 'billing@sirreel.com', label: 'Billing', owner: null },
  { address: 'payments@sirreel.com', label: 'Accounting', owner: null },
  { address: 'ana@sirreel.com', label: 'Ana (direct)', owner: 'ana@sirreel.com' },
]

const DESK_ADDRESSES: readonly string[] = DESK_MAILBOXES.map((m) => m.address)

const WINDOW_DAYS = 30

export interface MoneyBucket {
  amount: number
  count: number
}

export interface DeskMoney {
  /** Cards taken on the collections desk (RwCollectionCharge). */
  card: MoneyBucket
  /** Wire / ACH / Zelle / check marked collected on a queued final invoice. */
  bank: MoneyBucket
  /** Payments against HQ-native invoices. */
  hq: MoneyBucket
  total: number
}

export interface MailboxCount {
  address: string
  label: string
  sent: number
}

export interface DeskOutreach {
  /** Client-facing emails sent from any desk mailbox. */
  emailsSent: number
  /** That same figure split by the mailbox it went out from. */
  byMailbox: MailboxCount[]
  /** Distinct recipient addresses across those emails. */
  recipients: number
  /** Client mail that arrived in a desk mailbox. Context, not credit. */
  emailsIn: number
  /** Final invoices sent to a client from HQ. */
  invoicesEmailed: number
  /** Paid-marks, triage calls, review notes, remittance logs. */
  deskDecisions: number
  /** Clients who answered the invoice email's card-or-bank question. */
  clientAnswers: number
}

export interface DeskWindow {
  key: 'today' | 'week' | 'month'
  label: string
  since: string
  money: DeskMoney
  outreach: DeskOutreach
}

export interface OperatorStat {
  key: string
  name: string
  charged: MoneyBucket
  collected: MoneyBucket
  deskDecisions: number
  emailsSent: number
}

export type DeskEventKind =
  | 'CHARGE'
  | 'REVERSAL'
  | 'COLLECTED'
  | 'PAYMENT'
  | 'EMAIL'
  | 'INVOICE_SENT'
  | 'PAID_MARK'
  | 'TRIAGE'
  | 'NOTE'
  | 'REMITTANCE'
  | 'CLIENT_ANSWER'

export interface DeskEvent {
  at: string
  kind: DeskEventKind
  who: string | null
  title: string
  detail: string | null
  amount: number | null
}

export interface InboxHealth {
  address: string
  /** Last successful Gmail watch renewal — the feed is only as live as this. */
  watchedAt: string | null
  stale: boolean
}

export interface DeskActivity {
  generatedAt: string
  openAr: { total: number; count: number }
  windows: DeskWindow[]
  operators: OperatorStat[]
  feed: DeskEvent[]
  inboxes: InboxHealth[]
}

const money = (v: unknown): number => Math.round(Number(v ?? 0) * 100) / 100
const emptyBucket = (): MoneyBucket => ({ amount: 0, count: 0 })

function add(b: MoneyBucket, amount: number) {
  b.amount = money(b.amount + amount)
  b.count += 1
}

/** The bare address out of a `Display Name <addr@host>` From header. */
function bareAddress(header: string): string {
  const m = header.match(/<([^>]+)>/)
  return (m ? m[1] : header).toLowerCase().trim()
}

/**
 * Is this email OUTREACH, or just office traffic?
 *
 * Measured on the 30 days to 2026-09-14, Ana's mailbox sent 179 outbound
 * messages to 9 distinct addresses — because most of them were internal
 * threads with Wes, counted once per reply. Reported as "179 emails sent"
 * that is a flattering, useless number: it says the desk is busy without
 * saying anyone was chased.
 *
 * A message counts here only when at least one recipient is outside
 * sirreel.com. Internal mail is real work, but it is not collections
 * outreach, and it does not appear in the feed either.
 */
function isClientFacing(toAddresses: string[]): boolean {
  return toAddresses.some((a) => !a.toLowerCase().trim().endsWith('@sirreel.com'))
}

/**
 * Gmail's watch subscription expires after 7 days; a lapsed renewal means the
 * outreach half of this page silently stops updating while the money half
 * keeps going. Surfaced rather than assumed — a quiet feed should never be
 * readable as a quiet desk.
 */
const WATCH_TTL_MS = 7 * 86_400_000

export async function buildDeskActivity(now: Date = new Date()): Promise<DeskActivity> {
  const since = new Date(now.getTime() - WINDOW_DAYS * 86_400_000)
  const weekStart = new Date(now.getTime() - 7 * 86_400_000)
  const todayStart = pacificDayRange(pacificToday(now)).start

  const mailboxFilter = DESK_ADDRESSES.map((a) => ({
    fromAddress: { contains: a, mode: 'insensitive' as const },
  }))

  const [
    charges,
    reversals,
    finals,
    payments,
    paidMarks,
    triages,
    reviews,
    outbound,
    inboundCounts,
    accounts,
    openAr,
    users,
  ] = await Promise.all([
    prisma.rwCollectionCharge.findMany({
      where: { chargedAt: { gte: since } },
      select: {
        chargedAt: true, amount: true, status: true, reversedAt: true, chargedById: true,
        customerName: true, invoiceNumber: true, cardLast4: true,
      },
      orderBy: { chargedAt: 'desc' },
    }),
    prisma.rwCollectionReversal.findMany({
      where: { createdAt: { gte: since } },
      select: { createdAt: true, amount: true, kind: true, reason: true, createdById: true },
    }),
    prisma.jobFinalInvoice.findMany({
      where: {
        OR: [
          { collectedAt: { gte: since } },
          { emailedAt: { gte: since } },
          { remittanceAt: { gte: since } },
          { clientAnsweredAt: { gte: since } },
        ],
      },
      select: {
        amount: true, invoiceNumber: true,
        collectedAt: true, collectedVia: true, collectedById: true,
        emailedAt: true, emailedTo: true,
        remittanceAt: true, remittanceVia: true, remittanceById: true,
        clientAnswer: true, clientAnsweredAt: true,
        job: { select: { name: true, jobCode: true } },
      },
    }),
    prisma.payment.findMany({
      where: { receivedAt: { gte: since }, voidedAt: null, NOT: { status: 'FAILED' } },
      select: {
        receivedAt: true, amount: true, method: true, recordedById: true,
        invoice: { select: { invoiceNumber: true } },
      },
    }),
    prisma.rwInvoicePaidMark.findMany({
      where: { markedAt: { gte: since } },
      select: { markedAt: true, markedById: true, note: true, rwInvoiceId: true },
    }),
    prisma.rwInvoiceTriage.findMany({
      where: { decidedAt: { gte: since } },
      select: {
        decidedAt: true, decidedById: true, decision: true, note: true,
        customerName: true, invoiceNumber: true, amount: true,
      },
    }),
    prisma.rwInvoiceReview.findMany({
      where: { OR: [{ noteAt: { gte: since } }, { dismissedAt: { gte: since } }] },
      select: {
        noteAt: true, noteBy: true, note: true,
        dismissedAt: true, dismissedBy: true, dismissedReason: true, rwInvoiceId: true,
      },
    }),
    prisma.emailMessage.findMany({
      // duplicateOfId: the SAME Gmail message lands once per watched inbox it
      // touches, and the ingest links the copies. Without this every email to
      // another SirReel address counted twice — visible as each internal
      // thread appearing in the feed in pairs.
      where: {
        direction: 'outbound',
        sentAt: { gte: since },
        duplicateOfId: null,
        OR: mailboxFilter,
      },
      select: { sentAt: true, fromAddress: true, toAddresses: true, subject: true },
      orderBy: { sentAt: 'desc' },
    }),
    prisma.emailMessage.groupBy({
      by: ['emailAccountId'],
      where: { direction: 'inbound', sentAt: { gte: since } },
      _count: true,
    }),
    prisma.emailAccount.findMany({
      where: { emailAddress: { in: [...DESK_ADDRESSES] } },
      select: { id: true, emailAddress: true, lastWatchedAt: true },
    }),
    openArTotal(),
    prisma.user.findMany({ select: { id: true, name: true, email: true } }),
  ])

  // ── Name resolution ──────────────────────────────────────────────────
  // Most tables carry a user id; RwInvoiceReview carries a free-text
  // `noteBy` (an address, historically). Both resolve through one map so a
  // review note and a charge attribute to the same person, spelled the same.
  const byId = new Map(users.map((u) => [u.id, u.name]))
  const byEmail = new Map(users.map((u) => [u.email.toLowerCase(), u.name]))
  const nameOf = (id: string | null | undefined): string | null => (id ? byId.get(id) ?? null : null)
  const nameOfLoose = (v: string | null | undefined): string | null => {
    if (!v) return null
    return byId.get(v) ?? byEmail.get(v.toLowerCase()) ?? v
  }
  /**
   * The same person, spelled two ways, must not become two rows. Free-text
   * `noteBy` holds a name or an address depending on when it was written;
   * resolving it back to a user id is what keeps "Wes Bailey" from appearing
   * twice in the operator table — once keyed by id, once by name.
   */
  const byName = new Map(users.map((u) => [u.name.toLowerCase(), u.id]))
  const idOfLoose = (v: string | null | undefined): string | null => {
    if (!v) return null
    if (byId.has(v)) return v
    const u = users.find((x) => x.email.toLowerCase() === v.toLowerCase())
    return u?.id ?? byName.get(v.toLowerCase()) ?? null
  }

  // Everything below reads `clientMail`, not `outbound` — see isClientFacing.
  const clientMail = outbound.filter((m) => isClientFacing(m.toAddresses))

  const mailboxOf = (fromHeader: string): DeskMailbox | null => {
    const addr = bareAddress(fromHeader)
    return DESK_MAILBOXES.find((m) => m.address === addr) ?? null
  }

  const deskAccountIds = new Set(accounts.map((a) => a.id))
  const emailsIn30d = inboundCounts
    .filter((c) => deskAccountIds.has(c.emailAccountId))
    .reduce((n, c) => n + c._count, 0)

  // ── Windows ──────────────────────────────────────────────────────────
  const cuts: { key: DeskWindow['key']; label: string; from: Date }[] = [
    { key: 'today', label: 'Today', from: todayStart },
    { key: 'week', label: 'Last 7 days', from: weekStart },
    { key: 'month', label: 'Last 30 days', from: since },
  ]

  const windows: DeskWindow[] = cuts.map(({ key, label, from }) => {
    const inWin = (d: Date | null | undefined) => !!d && d >= from
    const card = emptyBucket()
    const bank = emptyBucket()
    const hq = emptyBucket()

    for (const c of charges) {
      // A reversed charge is money that came back; it never counts as collected.
      if (c.status !== 'APPROVED' || c.reversedAt || !inWin(c.chargedAt)) continue
      add(card, money(c.amount))
    }
    for (const f of finals) {
      // CARD collections are stamped by the charge route and already counted
      // above — counting them here too would double every card payment.
      if (!inWin(f.collectedAt) || f.collectedVia === 'CARD') continue
      add(bank, money(f.amount))
    }
    for (const p of payments) {
      if (!inWin(p.receivedAt)) continue
      add(hq, money(p.amount))
    }

    const sentInWin = clientMail.filter((m) => inWin(m.sentAt))
    const recipients = new Set<string>()
    for (const m of sentInWin) for (const to of m.toAddresses) recipients.add(to.toLowerCase())

    const deskDecisions =
      paidMarks.filter((m) => inWin(m.markedAt)).length +
      triages.filter((t) => inWin(t.decidedAt)).length +
      reviews.filter((r) => inWin(r.noteAt)).length +
      reviews.filter((r) => inWin(r.dismissedAt)).length +
      finals.filter((f) => inWin(f.remittanceAt)).length

    return {
      key,
      label,
      since: from.toISOString(),
      money: {
        card,
        bank,
        hq,
        total: money(card.amount + bank.amount + hq.amount),
      },
      outreach: {
        emailsSent: sentInWin.length,
        byMailbox: DESK_MAILBOXES.map((box) => ({
          address: box.address,
          label: box.label,
          sent: sentInWin.filter((m) => bareAddress(m.fromAddress) === box.address).length,
        })).filter((b) => b.sent > 0),
        recipients: recipients.size,
        // Inbound is a 30-day figure from a grouped count; the shorter
        // windows would need the rows themselves, and "mail that came back"
        // is context rather than a headline.
        emailsIn: key === 'month' ? emailsIn30d : 0,
        invoicesEmailed: finals.filter((f) => inWin(f.emailedAt)).length,
        deskDecisions,
        clientAnswers: finals.filter((f) => inWin(f.clientAnsweredAt)).length,
      },
    }
  })

  // ── Operators (30 days) ──────────────────────────────────────────────
  const ops = new Map<string, OperatorStat>()
  const op = (key: string | null, name: string | null): OperatorStat => {
    const k = key ?? name ?? 'unattributed'
    let row = ops.get(k)
    if (!row) {
      row = {
        key: k,
        name: name ?? 'Unattributed',
        charged: emptyBucket(),
        collected: emptyBucket(),
        deskDecisions: 0,
        emailsSent: 0,
      }
      ops.set(k, row)
    }
    return row
  }

  for (const c of charges) {
    if (c.status !== 'APPROVED' || c.reversedAt) continue
    add(op(c.chargedById, nameOf(c.chargedById)).charged, money(c.amount))
  }
  for (const f of finals) {
    if (f.collectedAt && f.collectedVia !== 'CARD') {
      add(op(f.collectedById, nameOf(f.collectedById)).collected, money(f.amount))
    }
    if (f.remittanceAt) op(f.remittanceById, nameOf(f.remittanceById)).deskDecisions += 1
  }
  for (const p of payments) add(op(p.recordedById, nameOf(p.recordedById)).collected, money(p.amount))
  for (const m of paidMarks) op(m.markedById, nameOf(m.markedById)).deskDecisions += 1
  for (const t of triages) op(t.decidedById, nameOf(t.decidedById)).deskDecisions += 1
  for (const r of reviews) {
    if (r.noteAt) op(idOfLoose(r.noteBy), nameOfLoose(r.noteBy)).deskDecisions += 1
    if (r.dismissedAt) op(idOfLoose(r.dismissedBy), nameOfLoose(r.dismissedBy)).deskDecisions += 1
  }
  for (const m of clientMail) {
    // Shared mailboxes carry no person on the envelope. Counting "SirReel
    // Billing" as a colleague's output would be a guess dressed as a
    // measurement — the desk total covers it instead.
    const owner = mailboxOf(m.fromAddress)?.owner
    if (!owner) continue
    const user = users.find((u) => u.email.toLowerCase() === owner)
    if (!user) continue
    op(user.id, user.name).emailsSent += 1
  }

  const operators = [...ops.values()].sort(
    (a, b) => b.charged.amount + b.collected.amount - (a.charged.amount + a.collected.amount),
  )

  // ── Feed ─────────────────────────────────────────────────────────────
  const feed: DeskEvent[] = []
  const push = (e: DeskEvent) => feed.push(e)

  for (const c of charges) {
    push({
      at: c.chargedAt.toISOString(),
      kind: 'CHARGE',
      who: nameOf(c.chargedById),
      title: `Card charged — ${c.customerName ?? 'client'}`,
      detail: [c.invoiceNumber, c.cardLast4 ? `••${c.cardLast4}` : null, c.reversedAt ? 'REVERSED' : null]
        .filter(Boolean)
        .join(' · ') || null,
      amount: money(c.amount),
    })
  }
  for (const r of reversals) {
    push({
      at: r.createdAt.toISOString(),
      kind: 'REVERSAL',
      who: nameOf(r.createdById),
      title: `Charge ${r.kind.toLowerCase()}`,
      detail: r.reason ?? null,
      amount: money(r.amount),
    })
  }
  for (const f of finals) {
    const label = f.job?.name ?? f.invoiceNumber ?? 'invoice'
    if (f.collectedAt && f.collectedVia !== 'CARD') {
      push({
        at: f.collectedAt.toISOString(),
        kind: 'COLLECTED',
        who: nameOf(f.collectedById),
        title: `Collected by ${f.collectedVia?.toLowerCase() ?? 'bank'} — ${label}`,
        detail: f.invoiceNumber,
        amount: money(f.amount),
      })
    }
    if (f.emailedAt) {
      push({
        at: f.emailedAt.toISOString(),
        kind: 'INVOICE_SENT',
        who: null,
        title: `Final invoice emailed — ${label}`,
        detail: f.emailedTo,
        amount: money(f.amount),
      })
    }
    if (f.remittanceAt) {
      push({
        at: f.remittanceAt.toISOString(),
        kind: 'REMITTANCE',
        who: nameOf(f.remittanceById),
        title: `Remittance logged — ${label}`,
        detail: f.remittanceVia ? `client says ${f.remittanceVia.toLowerCase()}` : null,
        amount: money(f.amount),
      })
    }
    if (f.clientAnsweredAt) {
      push({
        at: f.clientAnsweredAt.toISOString(),
        kind: 'CLIENT_ANSWER',
        who: null,
        title: `Client chose ${f.clientAnswer === 'CARD' ? 'card' : 'ACH / check'} — ${label}`,
        detail: null,
        amount: money(f.amount),
      })
    }
  }
  for (const p of payments) {
    push({
      at: p.receivedAt.toISOString(),
      kind: 'PAYMENT',
      who: nameOf(p.recordedById),
      title: `Payment recorded — ${p.invoice?.invoiceNumber ?? 'HQ invoice'}`,
      detail: p.method,
      amount: money(p.amount),
    })
  }
  for (const m of paidMarks) {
    push({
      at: m.markedAt.toISOString(),
      kind: 'PAID_MARK',
      who: nameOf(m.markedById),
      title: 'Marked paid in RentalWorks',
      detail: m.note ?? null,
      amount: null,
    })
  }
  for (const t of triages) {
    push({
      at: t.decidedAt.toISOString(),
      kind: 'TRIAGE',
      who: nameOf(t.decidedById),
      title: `Aging call: ${t.decision.replace(/_/g, ' ').toLowerCase()} — ${t.customerName ?? 'client'}`,
      detail: [t.invoiceNumber, t.note].filter(Boolean).join(' · ') || null,
      amount: money(t.amount) || null,
    })
  }
  for (const r of reviews) {
    if (r.noteAt) {
      push({
        at: r.noteAt.toISOString(),
        kind: 'NOTE',
        who: nameOfLoose(r.noteBy),
        title: 'Note on an open invoice',
        detail: r.note ?? null,
        amount: null,
      })
    }
    if (r.dismissedAt) {
      push({
        at: r.dismissedAt.toISOString(),
        kind: 'NOTE',
        who: nameOfLoose(r.dismissedBy),
        title: 'Cleared an invoice flag',
        detail: r.dismissedReason ?? null,
        amount: null,
      })
    }
  }
  for (const m of clientMail) {
    push({
      at: m.sentAt.toISOString(),
      kind: 'EMAIL',
      who: mailboxOf(m.fromAddress)?.label ?? bareAddress(m.fromAddress),
      // Subject and recipient only. The body stays in the mailbox — see the
      // header of this file.
      title: m.subject || '(no subject)',
      detail: m.toAddresses.join(', ') || null,
      amount: null,
    })
  }

  feed.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))

  return {
    generatedAt: now.toISOString(),
    openAr,
    windows,
    operators,
    feed: feed.slice(0, 200),
    inboxes: accounts.map((a) => ({
      address: a.emailAddress,
      watchedAt: a.lastWatchedAt?.toISOString() ?? null,
      stale: !a.lastWatchedAt || now.getTime() - a.lastWatchedAt.getTime() > WATCH_TTL_MS,
    })),
  }
}
