'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { RwConnectionCard } from '@/components/collections/RwConnectionCard'
import { EodReportPanel } from '@/components/collections/EodReportPanel'

/**
 * Collections workspace — pick a RentalWorks invoice, attach its PDF, confirm
 * the amount, take the card.
 *
 * Two card sources, deliberately side by side:
 *   - an authorization already on file (portal CC-auth step) — nothing is
 *     re-keyed, and the charge endpoint resolves the token server-side
 *   - the CardSecure iframe, for a card read out on a phone call
 *
 * The browser never holds a stored card token. Saved authorizations are
 * chosen by id; only the iframe path produces a token here, and that token is
 * minted by CardConnect, not by us.
 *
 * The 3% surcharge shown is indicative. The server recomputes it from the base
 * amount and charges base + surcharge — the number here can't influence what
 * the client is billed.
 */

interface Authorization {
  id: string
  /** Which table the card lives in — the charge route needs it to resolve the
   *  token, and must never guess (both tables use uuids). */
  origin: 'company' | 'paperwork'
  cardholderName: string | null
  cardType: string | null
  last4: string | null
  expiry: string | null
  expired: boolean
  /** Wallet cards only — the client's own name for it ("AmEx — gear"). */
  label: string | null
  isDefault: boolean
  validated: boolean
  authorizedAt: string | null
  paymentPreference: string
  /** WHOSE card this is. The picker groups on it; without it the list is a
   *  flat pile of every client's cards. */
  companyId: string | null
  companyName: string | null
  jobId: string | null
  jobName: string | null
  jobCode: string | null
  orderNumber: string | null
  rentalAgreement: { status: string; signedAt: string | null; signedDocumentUrl: string | null } | null
}

interface RwInvoice {
  rwInvoiceId: string
  invoiceNumber: string | null
  customerName: string | null
  /** Set when the row came from an HQ final invoice, which knows its Company.
   *  A raw RentalWorks row has only the customer NAME. */
  companyId?: string | null
  dealName: string | null
  orderNumber: string | null
  invoiceDate: string | null
  dueDate: string | null
  status: string | null
  invoiceTotal: number
  remainingTotal: number
  alreadyCharged: { count: number; total: number; last: string | null }
  /** Set when someone already recorded this as paid in HQ. Only ever appears
   *  in SEARCH results — the collectible list excludes them. */
  paidMarkedAt?: string | null
  paidMarkNote?: string | null
  /** Waiting on an insurance carrier, not the client (aging-review flag). */
  insurance?: { claimNumber: string | null } | null
}

interface FinalInvoice {
  id: string
  /** The HQ Job this invoice was finalized from — contacts, paperwork and
   *  history all live there, so the row links instead of repeating them. */
  jobId: string | null
  rwInvoiceId: string | null
  invoiceNumber: string | null
  amount: number
  pdfUrl: string | null
  note: string | null
  jobName: string | null
  jobCode: string | null
  companyId: string | null
  companyName: string | null
  alreadyCharged: number
  uploadedAt: string
  /** Payment-options email state — null emailedAt means the client has NOT
   *  been told how to pay, which is the first thing Ana needs to see. */
  emailedAt: string | null
  emailedTo: string | null
  /** First inbound email from the emailed address after the send. Conservative
   *  by design — an AP colleague replying from another address won't show. */
  repliedAt: string | null
  replySubject: string | null
  status: string
  collectedAt: string | null
  collectedVia: string | null
  collectedBy: string | null
  /** The client says they have SENT the money — logged before it lands, so an
   *  ACH in flight stops reading like a client who has gone quiet. Not
   *  collected: the row stays in the queue until the money is actually in. */
  remittanceAt: string | null
  remittanceVia: string | null
  remittanceRef: string | null
  remittanceNote: string | null
  remittanceBy: string | null
  /** The document the client sent — advice, wire confirmation, screenshot. */
  remittanceProofUrl: string | null
  remittanceProofKey: string | null
  remittanceProofName: string | null
  /** RW mirror balance for the linked invoice — 0 on a READY row means the
   *  money likely already landed at the bank. */
  rwRemaining: number | null
  ageDays: number
  /** Client payment behavior — observed days-to-pay ramps from 2026-08-18;
   *  open exposure is live from the mirror. */
  client: {
    avgDaysToPay: number | null
    observedPayments: number
    openTotal: number
    openCount: number
    oldestOpenDays: number | null
  } | null
}

interface CollectionsStats {
  rwOpenTotal: number
  rwOpenCount: number
  rwInsuranceTotal: number
  rwInsuranceCount: number
  rwAging: { d30: number; d60: number; d90: number; over: number }
  rwSyncedAt: string | null
  queueCount: number
  queueTotal: number
  queueOldestDays: number
  queueEmailed: number
  /** Open >60d rows with no triage ruling — the aging review's workload. */
  agingUndecided?: number
  collectedMonthCount: number
  collectedMonthTotal: number
  avgDaysToCollect: number | null
  operators: Array<{
    name: string
    chargesAttempted: number
    chargesApproved: number
    chargedTotal: number
    invoicesCollected: number
    collectedTotal: number
  }>
}

interface ChargeRow {
  id: string
  invoiceNumber: string | null
  customerName: string | null
  gatewayTotal: number
  cardLast4: string | null
  status: string
  authCode: string | null
  retref: string | null
  chargedAt: string
  /** Every reversal against this charge. A partially refunded charge has
   *  more than one, which single reversal_* fields cannot express. */
  reversals?: Array<{
    id: string
    kind: string
    retref: string | null
    amount: number
    reason: string | null
    createdAt: string
  }>
  /** Sum of the above — how much of the charge has come back. */
  reversedTotal?: number
}

/**
 * How old the RentalWorks mirror is.
 *
 * Turns amber past a day and red past two, because the sync is nightly: a
 * gap that large means it stopped running, and the balances on screen are
 * no longer what the client owes. Silence was the actual failure mode — the
 * sync stopped for 15 days and nothing on this page said so.
 */
function SyncAge({ iso }: { iso: string | null }) {
  if (!iso) return <span className="text-[11px] text-red-700">Balances never synced</span>
  const ageMs = Date.now() - new Date(iso).getTime()
  const hours = Math.floor(ageMs / 3_600_000)
  const stale = hours >= 48
  const aging = hours >= 24
  const label =
    hours < 1 ? 'just now' : hours < 24 ? `${hours}h ago` : `${Math.floor(hours / 24)}d ago`
  return (
    <span
      className={`text-[11px] ${stale ? 'text-red-700 font-semibold' : aging ? 'text-amber-700' : 'text-zinc-600'}`}
      title={new Date(iso).toLocaleString()}
    >
      Balances as of {label}
      {stale ? ' — sync is behind' : ''}
    </span>
  )
}

const money = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD' })

/**
 * Age of an open invoice, for the quiet per-row marker. Current (≤30d) stays
 * muted — being current is not a warning — and the palette matches the
 * aging bar in the Outstanding tile so one legend serves both.
 */
function invoiceAge(
  due: string | null,
  inv: string | null,
): { days: number; cls: string; bucket: string } | null {
  const basis = due ?? inv
  if (!basis) return null
  const days = Math.floor((Date.now() - new Date(basis).getTime()) / 86_400_000)
  const cls =
    days > 90 ? 'text-red-700' : days > 60 ? 'text-orange-700' : days > 30 ? 'text-amber-700' : 'text-zinc-600'
  const bucket = days > 90 ? '90+ days' : days > 60 ? '61–90 days' : days > 30 ? '31–60 days' : 'Current (≤30d)'
  return { days, cls, bucket }
}

/**
 * A comparable key for a client name. Case and punctuation are noise —
 * "Chad Powers, LLC" and "Chad Powers LLC" are one client — but nothing
 * cleverer is attempted: a name this does NOT match simply lands in the
 * picker's "other clients" group, which is the side that fails safe.
 */
function companyKey(name: string | null | undefined): string {
  return (name ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')
}

/** One line for a card in the picker: who, what, and anything worrying. */
function cardOptionLabel(a: Authorization): string {
  const bits = [
    a.label || a.cardholderName || 'Unnamed',
    `${a.cardType || 'card'} ****${a.last4 ?? '????'}`,
  ]
  if (a.isDefault) bits.push('default')
  if (a.expired) bits.push('EXPIRED')
  if (a.jobName) bits.push(a.jobName)
  return bits.join(' · ')
}

export function CollectionsWorkspace({ operatorName }: { operatorName: string }) {
  const [auths, setAuths] = useState<Authorization[]>([])
  const [invoices, setInvoices] = useState<RwInvoice[]>([])
  const [finals, setFinals] = useState<FinalInvoice[]>([])
  const [collectedRows, setCollectedRows] = useState<FinalInvoice[]>([])
  const [stats, setStats] = useState<CollectionsStats | null>(null)
  /** id of the row whose Mark-collected method picker is open */
  const [collectPicker, setCollectPicker] = useState<string | null>(null)
  const [collecting, setCollecting] = useState(false)
  /** id of the row whose proof-of-remittance form is open, and its reference */
  const [remitPicker, setRemitPicker] = useState<string | null>(null)
  const [remitRef, setRemitRef] = useState('')
  const [remitting, setRemitting] = useState(false)
  /** The uploaded proof waiting to be logged with the method. */
  const [remitProof, setRemitProof] = useState<
    { url: string; key: string; name: string } | null
  >(null)
  const [remitUploading, setRemitUploading] = useState(false)
  const [finalPick, setFinalPick] = useState<FinalInvoice | null>(null)
  const [charges, setCharges] = useState<ChargeRow[]>([])
  const [reversing, setReversing] = useState<string | null>(null)
  const [q, setQ] = useState('')
  // Age of the RentalWorks mirror. Shown because these balances are a nightly
  // snapshot, not live — an operator quoting a number to a client needs to
  // know how old it is.
  const [syncedAt, setSyncedAt] = useState<string | null>(null)
  const [invoice, setInvoice] = useState<RwInvoice | null>(null)
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [pdf, setPdf] = useState<{ pdfUrl: string; pdfKey: string; name: string } | null>(null)
  const [uploading, setUploading] = useState(false)

  const [source, setSource] = useState<'saved' | 'new'>('new')
  const [savedId, setSavedId] = useState('')
  // Ticked only to charge a card that is on file for a DIFFERENT client than
  // the invoice. Resets on every card change — an acknowledgement has to be
  // about the card in front of the operator, not one chosen two clicks ago.
  const [crossClientOk, setCrossClientOk] = useState(false)
  const [iframeUrl, setIframeUrl] = useState<string | null>(null)
  const [cardToken, setCardToken] = useState<string | null>(null)
  // Bumped after a successful charge to REMOUNT the tokenizer iframe.
  // Clearing cardToken alone left the old card still displayed inside the
  // iframe with no token behind it — the operator saw a filled-in card and
  // a dead Charge button, with no way to re-tokenize but retyping it.
  const [cardFormKey, setCardFormKey] = useState(0)
  // Our own expiry, kept out of the iframe — see the config route.
  const [expMonth, setExpMonth] = useState('')
  const [expYear, setExpYear] = useState('')
  const [cardholderName, setCardholderName] = useState('')
  // Cardholder billing ZIP. The gateway decides surcharge eligibility from it
  // and waives the fee where state law prohibits surcharging, so a keyed card
  // must carry one. A card on file already has it from the authorization.
  const [cardPostal, setCardPostal] = useState('')
  // Operator-supplied. The brand cannot be recovered after the fact: the
  // CardSecure token carries the last four but not the BIN, and the gateway's
  // auth response has no brand field. Without this, keyed charges recorded a
  // null card type — leaving a disputed payment with nothing identifying the
  // card beyond its last four.
  const [cardBrand, setCardBrand] = useState('')

  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null)
  const [err, setErr] = useState<string | null>(null)
  // Two-click charge: first click ARMS (button re-labels with amount +
  // last4 and asks to be clicked again), second click fires. Any change to
  // what would be charged disarms. Deliberately not window.confirm — a
  // native dialog invites a reflexive OK; a re-labeled button makes the
  // operator read the amount.
  const [confirming, setConfirming] = useState(false)

  // A card chosen for one invoice must not survive into the next. Switching
  // invoices used to leave the previous client's card selected and armed —
  // exactly the wrong-card charge the grouping below exists to prevent.
  useEffect(() => {
    setSavedId('')
    setCrossClientOk(false)
    setConfirming(false)
  }, [invoice?.rwInvoiceId])

  // Outcome toast. `result` used to render only inside the charge panel's
  // invoice-selected branch, so Mark collected / Send options / reversals —
  // all fired from the queue with no invoice picked — reported NOWHERE.
  useEffect(() => {
    if (!result) return
    const t = setTimeout(() => setResult(null), 6000)
    return () => clearTimeout(t)
  }, [result])

  // ── data ────────────────────────────────────────────────────────
  useEffect(() => {
    fetch('/api/collections/authorizations')
      .then((r) => r.json())
      .then((d) => d.ok && setAuths(d.authorizations ?? []))
      .catch(() => {})
  }, [])

  const loadFinals = useCallback(() => {
    fetch('/api/collections/final-invoices')
      .then((r) => r.json())
      .then((d) => {
        if (!d.ok) return
        setFinals(d.finalInvoices ?? [])
        setCollectedRows(d.collected ?? [])
        setStats(d.stats ?? null)
      })
      .catch(() => {})
  }, [])

  // Record money that arrived OUTSIDE HQ — wire, ACH push, Zelle, check.
  // Card collections stamp themselves in the charge route; this action is for
  // everything the bank sees before we do.
  const markCollected = useCallback(
    async (fv: FinalInvoice, via: string) => {
      if (collecting) return
      // One tap here is permanent — there is no un-collect route, and the
      // 409 guard means it can't even be repeated. Same confirm idiom as
      // the resend guard below.
      if (
        !window.confirm(
          `Mark ${fv.invoiceNumber || fv.jobName || 'this invoice'} (${money(fv.amount)}) collected via ${via}?\n\nThis removes it from the queue.`,
        )
      ) {
        return
      }
      setCollecting(true)
      try {
        const r = await fetch(`/api/collections/final-invoices/${fv.id}/collect`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ via }),
        })
        const d = await r.json()
        if (d.ok) {
          setResult({ ok: true, message: `${fv.invoiceNumber || fv.jobName || 'Invoice'} marked collected via ${via.toLowerCase()}.` })
          setCollectPicker(null)
          loadFinals()
        } else {
          setResult({ ok: false, message: d.error || 'Could not mark collected.' })
        }
      } catch {
        setResult({ ok: false, message: 'Could not mark collected — network error.' })
      } finally {
        setCollecting(false)
      }
    },
    [collecting, loadFinals],
  )

  // Proof of remittance — the client has told us the money is on its way and
  // sent something to prove it. Recorded BEFORE it lands: an ACH takes days,
  // and in that gap this row is indistinguishable from a client who never
  // replied (Ana, 2026-09-04). Deliberately does not collect the invoice —
  // the money still has to arrive.
  // The proof document itself. Uploaded first, logged with the method — the
  // same two-step the charge panel uses for an invoice PDF, and it means a
  // failed upload never leaves a half-written remittance behind.
  const uploadRemittanceProof = useCallback(async (file: File) => {
    setRemitUploading(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('kind', 'remittance')
      const r = await fetch('/api/collections/upload', { method: 'POST', body: fd })
      const d = await r.json()
      if (d.ok) setRemitProof({ url: d.url ?? d.pdfUrl, key: d.key ?? d.pdfKey, name: d.name ?? file.name })
      else setResult({ ok: false, message: d.error || 'Upload failed.' })
    } catch {
      setResult({ ok: false, message: 'Upload failed — network error.' })
    } finally {
      setRemitUploading(false)
    }
  }, [])

  const logRemittance = useCallback(
    async (
      fv: FinalInvoice,
      via: string,
      ref: string,
      proof: { url: string; key: string; name: string } | null,
    ) => {
      if (remitting) return
      setRemitting(true)
      try {
        const r = await fetch(`/api/collections/final-invoices/${fv.id}/remittance`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            via,
            ref: ref.trim() || undefined,
            // A POST replaces the record wholesale, so an existing file has to
            // be sent back to survive a re-log. The form seeds it for exactly
            // that reason.
            proofUrl: proof?.url,
            proofKey: proof?.key,
            proofName: proof?.name,
          }),
        })
        const d = await r.json()
        if (d.ok) {
          setResult({
            ok: true,
            message: `Proof of remittance logged (${via.toLowerCase()})${
              proof ? ` with ${proof.name}` : ''
            } — still in the queue until the money lands.`,
          })
          setRemitPicker(null)
          setRemitRef('')
          setRemitProof(null)
          loadFinals()
        } else {
          setResult({ ok: false, message: d.error || 'Could not log the remittance.' })
        }
      } catch {
        setResult({ ok: false, message: 'Could not log the remittance — network error.' })
      } finally {
        setRemitting(false)
      }
    },
    [remitting, loadFinals],
  )

  // Reversible: "we sent it Tuesday" is sometimes wrong, and a proof flag
  // that cannot be taken back leaves the queue quietly lying.
  const clearRemittance = useCallback(
    async (fv: FinalInvoice) => {
      if (remitting) return
      if (!window.confirm('Remove the proof of remittance on this invoice?')) return
      setRemitting(true)
      try {
        const r = await fetch(`/api/collections/final-invoices/${fv.id}/remittance`, {
          method: 'DELETE',
        })
        const d = await r.json()
        if (d.ok) {
          setResult({ ok: true, message: 'Proof of remittance removed.' })
          loadFinals()
        } else {
          setResult({ ok: false, message: d.error || 'Could not remove it.' })
        }
      } catch {
        setResult({ ok: false, message: 'Could not remove it — network error.' })
      } finally {
        setRemitting(false)
      }
    },
    [remitting, loadFinals],
  )

  // Payment-options (re)send for a queued final invoice. Same code path as
  // the automatic send on upload — a resend is a fresh copy, not a replay.
  const [sendingOptions, setSendingOptions] = useState<string | null>(null)
  const sendPaymentOptions = useCallback(
    async (fv: FinalInvoice) => {
      if (sendingOptions) return
      if (
        fv.emailedAt &&
        !window.confirm(
          `Payment options were already emailed to ${fv.emailedTo}.\n\nSend again?`,
        )
      ) {
        return
      }
      setSendingOptions(fv.id)
      try {
        const r = await fetch(`/api/collections/final-invoices/${fv.id}/send`, { method: 'POST' })
        const d = await r.json()
        if (d.ok) {
          setResult({ ok: true, message: `Payment options emailed to ${d.to}.` })
          loadFinals()
        } else {
          setResult({ ok: false, message: d.error || 'Send failed.' })
        }
      } catch {
        setResult({ ok: false, message: 'Send failed — network error.' })
      } finally {
        setSendingOptions(null)
      }
    },
    [sendingOptions, loadFinals],
  )

  useEffect(() => {
    loadFinals()
  }, [loadFinals])

  const loadCharges = useCallback(() => {
    fetch('/api/collections/charges')
      .then((r) => r.json())
      .then((d) => d.ok && setCharges(d.charges ?? []))
      .catch(() => {})
  }, [])

  useEffect(() => {
    loadCharges()
  }, [loadCharges])

  const loadInvoices = useCallback((query: string) => {
    fetch(`/api/collections/rw-invoices?q=${encodeURIComponent(query)}`)
      .then((r) => r.json())
      .then((d) => {
        if (!d.ok) return
        setInvoices(d.invoices ?? [])
        setSyncedAt(d.syncedAt ?? null)
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    loadInvoices('')
  }, [loadInvoices])

  // CardSecure iframe — same contract as the client portal's pay panel.
  useEffect(() => {
    if (source !== 'new' || iframeUrl) return
    fetch('/api/cardpointe/config')
      .then((r) => r.json())
      .then((d) => (d.iframeUrl ? setIframeUrl(d.iframeUrl) : setErr(d.error || 'Card entry unavailable')))
      .catch(() => setErr('Card entry unavailable'))
  }, [source, iframeUrl])

  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (typeof e.data !== 'string' || !e.data.startsWith('{')) return
      try {
        // CardSecure posts the token in TWO shapes depending on version:
        //   {"message":"<token>"}                     ← message IS the token
        //   {"message":{"token":"…","validationError":…}}
        // Both parsers here only ever handled the object form, so on an
        // account serving the string form no token was captured, the Charge
        // button never enabled, and the portal's pay panel had the same
        // silent failure. Accept either.
        const raw = JSON.parse(e.data) as
          | { message?: string | { token?: string; validationError?: string } }
          | null
        const inner = raw?.message
        const token =
          typeof inner === 'string' ? inner : typeof inner?.token === 'string' ? inner.token : ''
        const validationError =
          typeof inner === 'object' && typeof inner?.validationError === 'string'
            ? inner.validationError
            : ''
        if (token) {
          setCardToken(token)
          setErr(null)
        } else if (validationError) {
          setCardToken(null)
          setErr(validationError)
        }
      } catch {
        /* not ours */
      }
    }
    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
  }, [])

  // ── derived ─────────────────────────────────────────────────────
  const base = Number(amount)
  const validAmount = Number.isFinite(base) && base > 0
  // Display estimate only — the CEILING of what the processor may add. The
  // gateway applies the real fee and waives it entirely for ineligible
  // cardholders, so these two numbers must never be presented as the amount
  // the card WILL be charged.
  const surcharge = validAmount ? Math.round(base * 0.03 * 100) / 100 : 0
  const total = validAmount ? Math.round((base + surcharge) * 100) / 100 : 0
  // MMYY, assembled from our own selects.
  const cardExpiry = expMonth && expYear ? `${expMonth}${expYear}` : ''
  // A keyed card needs a billing ZIP: once surcharging is enabled the gateway
  // requires one on every card-not-present auth to judge eligibility.
  // Brand is REQUIRED on a keyed charge, not optional. An optional field here
  // gets skipped on a busy call, which is how keyed charges ended up with no
  // card type at all — and the one moment it matters is a dispute, months
  // later, when nobody remembers. It is a single tap while the operator is
  // already holding the card.
  const selectedAuth = auths.find((a) => a.id === savedId) ?? null

  // ── whose cards are these? ──────────────────────────────────────
  // The picker used to be one flat list of every card in the platform, with
  // no client on it — Ana, 2026-09-04: "none of them are for the company I'm
  // charging out for." Cards for the selected invoice's client come first;
  // everything else is a separate group you have to mean to reach.
  //
  // Matching prefers the Company id (exact, available on HQ final invoices)
  // and falls back to the name, since a raw RentalWorks invoice carries only
  // a customer name. Punctuation and case are ignored; nothing else is
  // guessed — a near-miss lands in "other clients", which is the safe side.
  const targetCompanyId = invoice?.companyId ?? null
  const targetCompanyName = invoice?.customerName ?? null
  const targetKey = companyKey(targetCompanyName)
  const knowsClient = !!targetCompanyId || !!targetKey
  const cardIsForClient = (a: Authorization) => {
    if (!knowsClient) return false
    if (targetCompanyId && a.companyId) return a.companyId === targetCompanyId
    return !!targetKey && companyKey(a.companyName) === targetKey
  }
  const clientAuths = auths.filter(cardIsForClient)
  const otherAuths = auths.filter((a) => !cardIsForClient(a))
  // A card whose client we KNOW differs from the invoice's. An unattributed
  // card (no company on file at all) is not flagged — that is ignorance, not
  // a mismatch, and crying wolf on it would train the warning away.
  const crossClient =
    !!selectedAuth && knowsClient && !!selectedAuth.companyId && !cardIsForClient(selectedAuth)

  const cardReady =
    source === 'saved'
      ? !!savedId && (!crossClient || crossClientOk)
      : !!cardToken &&
        cardExpiry.length === 4 &&
        cardPostal.trim().length >= 5 &&
        !!cardBrand
  const canCharge = !!invoice && validAmount && cardReady && !busy

  async function uploadPdf(file: File) {
    setUploading(true)
    setErr(null)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const r = await fetch('/api/collections/upload', { method: 'POST', body: fd })
      const d = await r.json()
      if (d.ok) setPdf({ pdfUrl: d.pdfUrl, pdfKey: d.pdfKey, name: file.name })
      else setErr(d.error || 'Upload failed')
    } catch {
      setErr('Upload failed')
    } finally {
      setUploading(false)
    }
  }

  async function charge() {
    if (!invoice || !canCharge) return
    setBusy(true)
    setResult(null)
    setErr(null)
    try {
      const r = await fetch('/api/collections/charge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          finalInvoiceId: finalPick?.id,
          rwInvoiceId: invoice.rwInvoiceId,
          invoiceNumber: invoice.invoiceNumber,
          customerName: invoice.customerName,
          amount: base,
          savedCardId: source === 'saved' ? savedId : undefined,
          savedCardOrigin: source === 'saved' ? selectedAuth?.origin : undefined,
          // The server refuses a cross-client card without this; the checkbox
          // above is the only thing that sets it.
          confirmCrossClientCard: source === 'saved' && crossClient ? crossClientOk : undefined,
          cardToken: source === 'new' ? cardToken : undefined,
          expiry: source === 'new' ? cardExpiry : undefined,
          cardholderName: cardholderName || undefined,
          postal: source === 'new' ? cardPostal || undefined : undefined,
          cardType: source === 'new' ? cardBrand || undefined : undefined,
          pdfUrl: pdf?.pdfUrl,
          pdfKey: pdf?.pdfKey,
          note: note || undefined,
        }),
      })
      const d = await r.json()
      setResult({ ok: !!d.ok, message: d.message || d.error || 'Unknown response' })
      if (d.ok) {
        setCardToken(null)
        setExpMonth('')
        setExpYear('')
        // Clear the cardholder's OWN details too. These persisted after a
        // charge, so the next card keyed on this screen inherited the previous
        // cardholder's name and billing ZIP — and the ZIP is what the gateway
        // uses to decide surcharge eligibility, so a stale one silently
        // applies the wrong state's rules to a different person's card.
        setCardholderName('')
        setCardPostal('')
        setCardBrand('')
        setCardFormKey((k) => k + 1)
        // The saved-card selection too — leaving it armed after a successful
        // charge is how the same card gets run twice.
        setSavedId('')
        setCrossClientOk(false)
        setAmount('')
        setFinalPick(null)
        loadInvoices(q)
        loadFinals()
        loadCharges()
      }
    } catch {
      setResult({ ok: false, message: 'Request failed — nothing was charged.' })
    } finally {
      setBusy(false)
    }
  }

  async function reverse(c: ChargeRow) {
    const remaining = Math.round((c.gatewayTotal - (c.reversedTotal ?? 0)) * 100) / 100
    // Amount FIRST, because it changes what the gateway can do: a partial can
    // only ever be a refund, and a refund needs the charge to have settled.
    // Asking for a reason first and then discovering the amount is impossible
    // wastes the operator's time on a live call.
    const amountRaw = window.prompt(
      `Reverse how much of the ${money(remaining)} remaining on ····${c.cardLast4 ?? '????'}?\n\n` +
        `Leave blank for the full ${money(remaining)}.\n` +
        'A partial amount can only be REFUNDED, which requires the charge to ' +
        'have settled (9:30pm ET). A full reversal can also be voided before then.',
      '',
    )
    if (amountRaw === null) return
    const trimmed = amountRaw.trim()
    let amount: number | undefined
    if (trimmed) {
      amount = Number(trimmed.replace(/[^0-9.]/g, ''))
      if (!Number.isFinite(amount) || amount <= 0) {
        setResult({ ok: false, message: 'Enter a valid amount, or leave it blank for the full reversal.' })
        return
      }
      if (amount > remaining) {
        setResult({ ok: false, message: `Only ${money(remaining)} remains on that charge.` })
        return
      }
    }

    const label = amount != null && amount < remaining ? `${money(amount)} of ${money(remaining)}` : money(remaining)
    const reason = window.prompt(
      `Reverse ${label} charged to ····${c.cardLast4 ?? '????'}?\n\n` +
        'Enter a reason (required, min 4 characters):',
    )
    if (!reason || reason.trim().length < 4) return
    setReversing(c.id)
    try {
      const r = await fetch(`/api/collections/charges/${c.id}/reverse`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: reason.trim(), amount }),
      })
      const d = await r.json()
      setResult({ ok: !!d.ok, message: d.message || d.error || 'Unknown response' })
      loadCharges()
    } catch {
      setResult({ ok: false, message: 'Reversal request failed.' })
    } finally {
      setReversing(null)
    }
  }

  // Disarm the two-click charge whenever anything it would charge changes.
  useEffect(() => {
    setConfirming(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [amount, source, savedId, cardToken, invoice?.rwInvoiceId])

  const label = 'text-[11px] font-semibold uppercase tracking-wider text-zinc-600 mb-1.5 block'
  const input =
    'w-full bg-white border border-zinc-300 rounded-lg px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-500 outline-none focus:border-amber-600'

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      {/* Outcome toast — job-detail idiom. Red-bordered on failure. */}
      {result && (
        <div
          className={`fixed bottom-5 left-1/2 -translate-x-1/2 z-50 border text-[15px] px-4 py-2 rounded-lg shadow-xl ${
            result.ok
              ? 'bg-zinc-100 border-zinc-300 text-zinc-900'
              : 'bg-white border-red-300 text-red-700'
          }`}
        >
          {result.message}
        </div>
      )}
      {/* Is the mirror this page reads still being fed? Collections works off
          the RentalWorks mirror, so a dead token is a collections problem —
          it used to surface only as an invoice list that stopped growing. */}
      <RwConnectionCard />

      {/* The evening report. Sits above the heading with the connection meter
          because both are "state of the desk" rather than a working list. */}
      <EodReportPanel />

      {/* Dark text — this heading sits on the LIGHT dashboard shell, not in
          a card. It rendered text-zinc-900 for months: an invisible title. */}
      <div className="flex items-baseline justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-900">Collections</h1>
          <p className="text-sm text-zinc-600 mt-1">
            Everything owed and everything collected — charge a card, send payment options, mark
            money received.{' '}
            <span className="text-zinc-600">Actions are recorded as {operatorName}.</span>
          </p>
        </div>
        {/* Wes 2026-09-01: the how-to belongs where the work is, not only
            in the nav. Sits beside the title rather than in the body so
            it is findable on the first visit and ignorable on the
            hundredth. */}
        <Link
          href="/guides/collecting"
          className="flex-none inline-flex items-center gap-1.5 rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-[13px] font-semibold text-zinc-700 transition-colors hover:border-zinc-400 hover:text-zinc-900"
        >
          How to collect
          <span aria-hidden="true">→</span>
        </Link>
      </div>

      {/* ── tracker stats — stamped rows only, no vibes ─────────────── */}
      {stats && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 mb-6">
          <div className="bg-gradient-to-b from-white to-zinc-50 border border-zinc-200 rounded-2xl p-4 transition-colors duration-200 hover:border-zinc-400">
            {/* The REAL receivable — every open RW invoice not marked paid,
                same definition as the browse list below. The agent queue is
                the second line: it is the worked subset, not the total. */}
            <div className="text-[11px] font-semibold uppercase tracking-wider text-zinc-600 mb-1">Outstanding (RW)</div>
            <div className="text-xl font-bold text-amber-700">{money(stats.rwOpenTotal)}</div>
            {/* Aging at a glance: one slim bar, dollars-proportional. Hover
                any segment for the amount. Same palette as the row markers. */}
            {stats.rwAging && stats.rwOpenTotal > 0 && (
              <div className="flex h-1.5 rounded-full overflow-hidden mt-1.5 mb-0.5 bg-zinc-100">
                {(
                  [
                    ['≤30d', stats.rwAging.d30, 'bg-zinc-400'],
                    ['31–60d', stats.rwAging.d60, 'bg-amber-500'],
                    ['61–90d', stats.rwAging.d90, 'bg-orange-500'],
                    ['90d+', stats.rwAging.over, 'bg-red-500'],
                  ] as const
                ).map(([label, amt, cls]) =>
                  amt > 0 ? (
                    <div
                      key={label}
                      className={cls}
                      style={{ width: `${Math.max(2, (amt / stats.rwOpenTotal) * 100)}%` }}
                      title={`${label}: ${money(amt)}`}
                    />
                  ) : null,
                )}
              </div>
            )}
            <div className="text-xs text-zinc-600 mt-0.5 flex items-baseline gap-1.5 flex-wrap">
              <span>{stats.rwOpenCount} open invoice{stats.rwOpenCount === 1 ? '' : 's'} ·</span>
              <SyncAge iso={stats.rwSyncedAt} />
            </div>
            {stats.rwInsuranceCount > 0 && (
              <div className="text-xs text-violet-700 mt-0.5">
                {money(stats.rwInsuranceTotal)} awaiting insurance ({stats.rwInsuranceCount}) ·{' '}
                {money(stats.rwOpenTotal - stats.rwInsuranceTotal)} on clients
              </div>
            )}
            {/* Queue-status lines used to stack here too — they describe the
                queue, not the receivable, and live on the queue card now. */}
            {(stats.agingUndecided ?? 0) > 0 ? (
              <span className="mt-1 flex flex-wrap items-center gap-x-3">
                <a href="/collections/aging-review" className="text-xs text-amber-700 hover:text-amber-800 font-semibold">
                  Aging review · {stats.agingUndecided} undecided →
                </a>
                {/* The evidence desk: email trail + what it appears to say. */}
                <a href="/collections/rw-review" className="text-xs text-zinc-600 hover:text-zinc-900 font-semibold">
                  Read the emails →
                </a>
              </span>
            ) : (
              <a href="/collections/aging-review" className="text-xs text-zinc-600 hover:text-zinc-700 mt-1 inline-block">
                Aging review →
              </a>
            )}
          </div>
          <div className="bg-gradient-to-b from-white to-zinc-50 border border-zinc-200 rounded-2xl p-4 transition-colors duration-200 hover:border-zinc-400">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-zinc-600 mb-1">Collected this month</div>
            <div className="text-xl font-bold text-emerald-700">{money(stats.collectedMonthTotal)}</div>
            <div className="text-xs text-zinc-600 mt-0.5">
              {stats.collectedMonthCount} invoice{stats.collectedMonthCount === 1 ? '' : 's'}
            </div>
          </div>
          <div className="bg-gradient-to-b from-white to-zinc-50 border border-zinc-200 rounded-2xl p-4 transition-colors duration-200 hover:border-zinc-400">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-zinc-600 mb-1">Avg days to collect</div>
            <div className="text-xl font-bold text-zinc-900">{stats.avgDaysToCollect ?? '—'}</div>
            <div className="text-xs text-zinc-600 mt-0.5">upload → money in, last 60 days</div>
          </div>
          <div className="bg-gradient-to-b from-white to-zinc-50 border border-zinc-200 rounded-2xl p-4 transition-colors duration-200 hover:border-zinc-400">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-zinc-600 mb-1">This week</div>
            {stats.operators.length === 0 ? (
              <div className="text-sm text-zinc-600 mt-1">No collections activity yet.</div>
            ) : (
              stats.operators.map((op) => (
                <div key={op.name} className="text-xs text-zinc-700 mt-0.5">
                  <span className="font-semibold text-zinc-900">{op.name}</span>
                  {' — '}{op.invoicesCollected} collected ({money(op.collectedTotal)})
                  {op.chargesAttempted > 0 && `, ${op.chargesApproved}/${op.chargesAttempted} charges approved`}
                </div>
              ))
            )}
          </div>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[1.1fr_1fr] items-start">
        {/* ── invoices ─────────────────────────────────────────── */}
        <div className="space-y-6">
        {/* Ready to collect — finalized by an agent on the job page. This is
            the queue Ana works; the RW browse below is the fallback for
            anything finalized outside HQ. */}
        <div className="bg-gradient-to-b from-white to-zinc-50 border border-zinc-200 rounded-2xl p-4 transition-colors duration-200 hover:border-zinc-400">
          <div className="flex items-center justify-between gap-3 mb-1 flex-wrap">
            <h2 className="text-[15px] font-semibold text-zinc-900 flex items-center gap-2.5 before:content-[''] before:w-1 before:h-4 before:rounded-full before:bg-amber-500/80">Ready to collect</h2>
            {/* The queue's own status, worst first — moved off the
                Outstanding tile, which is about the receivable. */}
            {stats && stats.queueCount > 0 && (
              <span className="flex items-center gap-2 text-[11px]">
                <span className="text-zinc-600">
                  {stats.queueCount} · {money(stats.queueTotal)}
                </span>
                {stats.queueCount > stats.queueEmailed && (
                  <span className="font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border border-orange-300 text-orange-700">
                    Unsent {stats.queueCount - stats.queueEmailed}
                  </span>
                )}
                {stats.queueOldestDays >= 7 && (
                  <span className={`font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border ${
                    stats.queueOldestDays >= 14 ? 'border-red-300 text-red-700' : 'border-amber-300 text-amber-700'
                  }`}>
                    Oldest {stats.queueOldestDays}d
                  </span>
                )}
              </span>
            )}
          </div>
          <p className="text-xs text-zinc-600 mb-3">
            Final amounts agreed with the client and sent over from the job page.
          </p>
          {finals.length === 0 ? (
            <p className="text-sm text-zinc-600 py-3">
              Nothing queued. Agents send invoices here with{' '}
              <b className="text-zinc-700">Upload final invoice</b> on the job page.
            </p>
          ) : (
            <div className="divide-y divide-zinc-200 max-h-[260px] overflow-y-auto">
              {finals.map((fv) => (
                <div
                  key={fv.id}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key !== 'Enter' && e.key !== ' ') return
                    if (e.target !== e.currentTarget) return // let inner buttons act
                    e.preventDefault()
                    ;(e.currentTarget as HTMLElement).click()
                  }}
                  onClick={() => {
                    setFinalPick(fv)
                    setAmount(String(fv.amount))
                    setInvoice({
                      rwInvoiceId: fv.rwInvoiceId || `final:${fv.id}`,
                      invoiceNumber: fv.invoiceNumber,
                      customerName: fv.companyName,
                      companyId: fv.companyId,
                      dealName: fv.jobName,
                      orderNumber: null,
                      invoiceDate: null,
                      dueDate: null,
                      status: 'FINAL',
                      invoiceTotal: fv.amount,
                      remainingTotal: fv.amount,
                      alreadyCharged: { count: 0, total: fv.alreadyCharged, last: null },
                    })
                  }}
                  className={`w-full text-left py-2.5 px-2 rounded transition-colors cursor-pointer focus:outline-none focus-visible:ring-1 focus-visible:ring-amber-500 ${
                    finalPick?.id === fv.id ? 'bg-amber-600/20' : 'hover:bg-zinc-100'
                  }`}
                >
                  <div className="flex justify-between gap-3">
                    {fv.jobId ? (
                      <a
                        href={`/jobs/${fv.jobId}`}
                        onClick={(e) => e.stopPropagation()}
                        className="text-sm font-semibold text-zinc-900 hover:text-amber-800"
                        title="Open the job — contacts, paperwork, history"
                      >
                        {fv.jobName || fv.invoiceNumber || 'Final invoice'}
                      </a>
                    ) : (
                      <span className="text-sm font-semibold text-zinc-900">
                        {fv.jobName || fv.invoiceNumber || 'Final invoice'}
                      </span>
                    )}
                    <span className="text-sm text-amber-700 font-semibold">
                      {money(fv.amount)}
                    </span>
                  </div>
                  <div className="text-xs text-zinc-600 mt-0.5">
                    {fv.companyName || '—'}
                    {fv.invoiceNumber ? ` · ${fv.invoiceNumber}` : ''}
                    {' · '}
                    {fv.pdfUrl ? (
                      <a
                        href={fv.pdfUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="text-amber-700 hover:text-amber-800"
                      >
                        PDF
                      </a>
                    ) : (
                      'no PDF'
                    )}
                  </div>
                  {fv.note && <div className="text-xs text-zinc-600 mt-0.5">{fv.note}</div>}
                  {fv.alreadyCharged > 0 && (
                    <div className="text-xs text-amber-500/90 mt-1">
                      {money(fv.alreadyCharged)} already collected against this invoice
                    </div>
                  )}
                  {/* Money may already be in: the RW mirror shows a zero
                      balance on the linked invoice. Ana confirms and marks it
                      rather than chasing a client who already paid. */}
                  {fv.rwRemaining === 0 && (
                    <div className="text-xs text-emerald-700 mt-1 font-semibold">
                      RentalWorks shows this invoice PAID — confirm and mark collected
                    </div>
                  )}
                  {/* The row's story: age → emailed → replied. Unsent is the
                      loud case — the client has the number but no how-to-pay. */}
                  <div className="flex items-center flex-wrap gap-x-3 gap-y-1 mt-1">
                    <span className={`text-xs ${fv.ageDays >= 14 ? 'text-red-700 font-semibold' : fv.ageDays >= 7 ? 'text-amber-700' : 'text-zinc-600'}`}>
                      {fv.ageDays === 0 ? 'today' : `${fv.ageDays}d in queue`}
                    </span>
                    {fv.emailedAt ? (
                      <span className="text-xs text-emerald-500/90">emailed {fv.emailedTo}</span>
                    ) : (
                      <span className="text-xs text-orange-700 font-semibold">NOT emailed</span>
                    )}
                    {fv.repliedAt && (
                      <span
                        className="text-xs text-sky-700"
                        title={fv.replySubject ?? undefined}
                      >
                        ↩ replied {new Date(fv.repliedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                      </span>
                    )}
                    {/* The client says it is sent. Loud enough to stop a
                        second chase, quiet enough not to read as collected —
                        the money is still not in. */}
                    {fv.remittanceAt && (
                      <span
                        className="text-xs text-emerald-700 font-semibold"
                        title={
                          [
                            fv.remittanceNote,
                            fv.remittanceBy ? `logged by ${fv.remittanceBy}` : null,
                          ]
                            .filter(Boolean)
                            .join(' · ') || undefined
                        }
                      >
                        proof of remittance ·{' '}
                        {(fv.remittanceVia ?? 'sent').toLowerCase()}
                        {fv.remittanceRef ? ` · ${fv.remittanceRef}` : ''} ·{' '}
                        {new Date(fv.remittanceAt).toLocaleDateString('en-US', {
                          month: 'short',
                          day: 'numeric',
                        })}
                      </span>
                    )}
                    {fv.remittanceAt && fv.remittanceProofUrl && (
                      <a
                        href={fv.remittanceProofUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="text-xs text-amber-700 hover:text-amber-800 underline max-w-[200px] truncate"
                        title={fv.remittanceProofName ?? 'Open the remittance proof'}
                      >
                        {fv.remittanceProofName || 'proof document'}
                      </a>
                    )}
                    {/* Payment-behavior chip. Latency shows once observed
                        (n=sample size); until then, current exposure. */}
                    {fv.client && fv.client.avgDaysToPay !== null && (
                      <span
                        className={`text-xs ${fv.client.avgDaysToPay >= 45 ? 'text-red-700' : fv.client.avgDaysToPay >= 30 ? 'text-amber-700' : 'text-zinc-600'}`}
                        title={`${fv.client.observedPayments} observed payment(s)`}
                      >
                        client avg {fv.client.avgDaysToPay}d to pay
                      </span>
                    )}
                    {fv.client && fv.client.avgDaysToPay === null && fv.client.openCount > 1 && (
                      <span className="text-xs text-zinc-600">
                        client: {fv.client.openCount} open ({money(fv.client.openTotal)})
                        {fv.client.oldestOpenDays !== null && fv.client.oldestOpenDays > 30
                          ? ` · oldest ${fv.client.oldestOpenDays}d`
                          : ''}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 mt-1.5">
                    {/* Real <button>s — the row wrapper is a div now, so
                        these are keyboard-reachable AND valid HTML (the old
                        markup nested role="button" spans inside a button). */}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        void sendPaymentOptions(fv)
                      }}
                      className="text-xs px-2 py-0.5 rounded border border-zinc-300 text-zinc-700 hover:bg-zinc-100 shrink-0"
                    >
                      {sendingOptions === fv.id ? 'Sending…' : fv.emailedAt ? 'Resend options' : 'Send options'}
                    </button>
                    {/* Proof of remittance. Sits beside Mark collected on
                        purpose: they are the two halves of an ACH — the
                        client's claim, then the money. */}
                    {remitPicker === fv.id ? (
                      <span
                        className="flex items-center gap-1 flex-wrap"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <input
                          className="text-[11px] px-1.5 py-0.5 rounded border border-zinc-300 bg-white text-zinc-800 w-32"
                          placeholder="ref / trace #"
                          value={remitRef}
                          onChange={(e) => setRemitRef(e.target.value)}
                          aria-label="Remittance reference"
                        />
                        {/* The advice itself. Whatever their AP department
                            could export — a PDF or a screenshot. */}
                        {remitProof ? (
                          <span className="text-[11px] text-emerald-700 max-w-[160px] truncate">
                            {remitProof.name}
                            <button
                              type="button"
                              onClick={() => setRemitProof(null)}
                              className="ml-1 text-zinc-500 hover:text-zinc-700"
                              title="Remove the attached file"
                            >
                              ✕
                            </button>
                          </span>
                        ) : (
                          <label className="text-[11px] px-1.5 py-0.5 rounded border border-zinc-300 text-zinc-700 hover:bg-zinc-100 cursor-pointer">
                            {remitUploading ? 'Uploading…' : '+ file'}
                            <input
                              type="file"
                              accept="application/pdf,image/*"
                              className="hidden"
                              onChange={(e) =>
                                e.target.files?.[0] &&
                                void uploadRemittanceProof(e.target.files[0])
                              }
                            />
                          </label>
                        )}
                        {['ACH', 'WIRE', 'ZELLE', 'CHECK', 'OTHER'].map((via) => (
                          <button
                            key={via}
                            type="button"
                            disabled={remitUploading}
                            onClick={() => void logRemittance(fv, via, remitRef, remitProof)}
                            className="text-[11px] px-1.5 py-0.5 rounded bg-sky-50 border border-sky-300 text-sky-800 hover:bg-sky-100 disabled:opacity-50"
                          >
                            {remitting ? '…' : via}
                          </button>
                        ))}
                        <button
                          type="button"
                          onClick={() => {
                            setRemitPicker(null)
                            setRemitRef('')
                            setRemitProof(null)
                          }}
                          className="text-[11px] px-1.5 py-0.5 text-zinc-600 hover:text-zinc-700"
                        >
                          ✕
                        </button>
                      </span>
                    ) : fv.remittanceAt ? (
                      <>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation()
                            // Seeded from what is already logged, so re-saving
                            // to add the file doesn't drop the reference — or
                            // the file, which a POST would otherwise replace.
                            setRemitPicker(fv.id)
                            setRemitRef(fv.remittanceRef ?? '')
                            setRemitProof(
                              fv.remittanceProofUrl
                                ? {
                                    url: fv.remittanceProofUrl,
                                    key: fv.remittanceProofKey ?? '',
                                    name: fv.remittanceProofName ?? 'proof',
                                  }
                                : null,
                            )
                          }}
                          className="text-xs px-2 py-0.5 rounded border border-sky-200 text-sky-800 hover:bg-sky-50 shrink-0"
                          title={
                            fv.remittanceProofUrl
                              ? 'Change the logged remittance or its file'
                              : 'Attach the advice the client sent, or fix the details'
                          }
                        >
                          {fv.remittanceProofUrl ? 'Edit proof' : 'Attach file'}
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation()
                            void clearRemittance(fv)
                          }}
                          className="text-xs px-2 py-0.5 rounded border border-zinc-300 text-zinc-600 hover:bg-zinc-100 shrink-0"
                          title="Remove the proof of remittance — it was wrong, or it never arrived"
                        >
                          Clear proof
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          setRemitPicker(fv.id)
                          setRemitRef('')
                          setRemitProof(null)
                        }}
                        className="text-xs px-2 py-0.5 rounded border border-sky-200 text-sky-800 hover:bg-sky-50 shrink-0"
                        title="The client sent proof they have paid — an ACH advice, a wire confirmation, a check number. Records the claim; the money still has to land."
                      >
                        Proof of remittance
                      </button>
                    )}
                    {collectPicker === fv.id ? (
                      <span className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                        {['WIRE', 'ACH', 'ZELLE', 'CHECK', 'OTHER'].map((via) => (
                          <button
                            key={via}
                            type="button"
                            onClick={() => void markCollected(fv, via)}
                            // The method the client's own remittance named is
                            // ringed, so the two records agree by default
                            // rather than by memory.
                            className={`text-[11px] px-1.5 py-0.5 rounded bg-emerald-50 border text-emerald-700 hover:bg-emerald-100 ${
                              fv.remittanceVia === via
                                ? 'border-emerald-600 ring-1 ring-emerald-500 font-semibold'
                                : 'border-emerald-300'
                            }`}
                            title={
                              fv.remittanceVia === via
                                ? 'What the client’s remittance said'
                                : undefined
                            }
                          >
                            {collecting ? '…' : via}
                          </button>
                        ))}
                        <button
                          type="button"
                          onClick={() => setCollectPicker(null)}
                          className="text-[11px] px-1.5 py-0.5 text-zinc-600 hover:text-zinc-700"
                        >
                         
                        </button>
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          setCollectPicker(fv.id)
                        }}
                        className="text-xs px-2 py-0.5 rounded border border-emerald-200 text-emerald-700 hover:bg-emerald-50 shrink-0"
                        title="Record a payment that arrived at the bank — wire, ACH, Zelle, or check. Card charges record themselves."
                      >
                        Mark collected
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Collected — the other half of tracking. When, how, by whom, so
            "did that wire ever land" is answered here, not in the bank app. */}
        <div className="bg-gradient-to-b from-white to-zinc-50 border border-zinc-200 rounded-2xl p-4 transition-colors duration-200 hover:border-zinc-400">
          <div className="flex items-baseline justify-between gap-3 mb-3">
            <h2 className="text-[15px] font-semibold text-zinc-900 flex items-center gap-2.5 before:content-[''] before:w-1 before:h-4 before:rounded-full before:bg-amber-500/80">All RentalWorks invoices</h2>
            <SyncAge iso={syncedAt} />
          </div>
          <input
            className={input}
            placeholder="Search invoice #, customer, order, production… (blank = all with a balance)"
            value={q}
            onChange={(e) => {
              setQ(e.target.value)
              loadInvoices(e.target.value)
            }}
          />
          <div className="mt-3 max-h-[320px] overflow-y-auto divide-y divide-zinc-200">
            {invoices.length === 0 && (
              <div className="py-6 text-sm text-zinc-600 text-center">No invoices found.</div>
            )}
            {invoices.map((i, idx) => {
              const a = invoiceAge(i.dueDate, i.invoiceDate)
              // Divider when the aging bucket changes — only meaningful on the
              // default list, which the server sorts oldest-first. Search is
              // newest-first, so buckets would interleave into noise.
              const prev = idx > 0 ? invoiceAge(invoices[idx - 1].dueDate, invoices[idx - 1].invoiceDate) : null
              const showDivider = !q.trim() && a && (!prev || prev.bucket !== a.bucket)
              return (
              <div key={i.rwInvoiceId}>
                {showDivider && (
                  <div className={`flex items-center gap-2 pt-2 pb-1 px-2 text-[10px] font-bold uppercase tracking-wider ${a.cls}`}>
                    <span>{a.bucket}</span>
                    <span className="flex-1 h-px bg-zinc-100" />
                  </div>
                )}
                <button
                  onClick={() => {
                    setInvoice(i)
                    setAmount(i.remainingTotal > 0 ? String(i.remainingTotal) : '')
                  }}
                  className={`w-full text-left py-2.5 px-2 rounded transition-colors ${
                    invoice?.rwInvoiceId === i.rwInvoiceId ? 'bg-amber-600/15' : 'hover:bg-zinc-100'
                  }`}
                >
                <div className="flex justify-between gap-3">
                  <span className="text-sm font-semibold text-zinc-900">
                    {i.invoiceNumber || '(no number)'}
                    {i.invoiceNumber && (
                      <a
                        href={`/api/rentalworks/invoices/${i.rwInvoiceId}/pdf`}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="ml-2 text-xs font-normal text-amber-700 hover:text-amber-800"
                      >
                        PDF
                      </a>
                    )}
                  </span>
                  <span className="text-sm text-amber-700 font-semibold">
                    {money(i.remainingTotal)} due
                  </span>
                </div>
                {/* Partial payments change the phone call — same phrasing the
                    aging review uses. */}
                {i.invoiceTotal > i.remainingTotal && (
                  <div className="text-xs text-zinc-600 mt-0.5">
                    {money(i.invoiceTotal - i.remainingTotal)} of {money(i.invoiceTotal)} received
                  </div>
                )}
                <div className="flex justify-between gap-3 text-xs mt-0.5">
                  <span className="text-zinc-600 truncate">
                    {i.customerName || '—'}
                    {i.dealName ? ` · ${i.dealName}` : ''}
                    {i.status ? ` · ${i.status}` : ''}
                    {i.insurance && (
                      <span
                        className="ml-1.5 text-[10px] font-bold uppercase tracking-wider px-1 py-px rounded bg-violet-50 border border-violet-300 text-violet-700"
                        title={i.insurance.claimNumber ? `Carrier claim ${i.insurance.claimNumber}` : 'Awaiting insurance carrier'}
                      >
                        INS
                      </span>
                    )}
                  </span>
                  {a && a.days > 0 && (
                    <span
                      className={`shrink-0 ${a.cls}`}
                      title={`${a.days} days past ${i.dueDate ? 'due date' : 'invoice date'}`}
                    >
                      {a.days}d
                    </span>
                  )}
                </div>
                {/* Only reachable via an explicit search — the collectible
                    list filters these out. Flagged loudly because chasing an
                    invoice a colleague already settled is the specific
                    embarrassment this prevents. */}
                {i.paidMarkedAt && (
                  <div className="text-xs text-emerald-700 mt-1">
                    Already marked paid in HQ on{' '}
                    {new Date(i.paidMarkedAt).toLocaleDateString()}
                    {i.paidMarkNote ? ` · ${i.paidMarkNote}` : ''} — RentalWorks has not caught up
                  </div>
                )}
                {i.alreadyCharged.count > 0 && (
                  <div className="text-xs text-amber-500/90 mt-1">
                    {i.alreadyCharged.count} charge{i.alreadyCharged.count === 1 ? '' : 's'} already
                    taken here totalling {money(i.alreadyCharged.total)}
                  </div>
                )}
                </button>
              </div>
            )})}
          </div>
        </div>

        {/* Recent charges + reversal. Without this the history was
            write-only: a mis-keyed amount had no path back short of a
            database query, which is not a thing Ana can do mid-call. */}
        <div className="bg-gradient-to-b from-white to-zinc-50 border border-zinc-200 rounded-2xl p-4 transition-colors duration-200 hover:border-zinc-400">
          <h2 className="text-[15px] font-semibold text-zinc-900 flex items-center gap-2.5 before:content-[''] before:w-1 before:h-4 before:rounded-full before:bg-zinc-500/80 mb-1">Recent charges</h2>
          <p className="text-xs text-zinc-600 mb-3">
            Void if it hasn&rsquo;t settled yet, refund if it has — the gateway decides which.
          </p>
          {charges.length === 0 ? (
            <p className="text-sm text-zinc-600 py-2">Nothing charged yet.</p>
          ) : (
            <div className="divide-y divide-zinc-200 max-h-[280px] overflow-y-auto">
              {charges.map((c) => (
                <div key={c.id} className="py-2.5 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    {/* A declined charge is NOT money moved — the amount
                        drops to muted and the status becomes a red badge
                        instead of blending into the reference line. */}
                    <div className={`text-sm font-semibold ${c.status === 'APPROVED' ? 'text-zinc-900' : 'text-zinc-600'}`}>
                      {money(c.gatewayTotal)}
                      <span className="text-zinc-600 font-normal">
                        {' '}
                        ····{c.cardLast4 ?? '????'}
                      </span>
                      {c.status !== 'APPROVED' && (
                        <span className="ml-2 text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-red-50 border border-red-300 text-red-700 align-middle">
                          {c.status}
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-zinc-600 mt-0.5 truncate">
                      {c.customerName || c.invoiceNumber || '—'} ·{' '}
                      {new Date(c.chargedAt).toLocaleString()}
                    </div>
                    <div className="text-xs text-zinc-600 mt-0.5">
                      {c.status === 'APPROVED' ? 'approved' : null}
                      {c.status === 'APPROVED' && (c.authCode || c.retref) ? ' · ' : ''}
                      {c.authCode ? `auth ${c.authCode}` : ''}
                      {c.authCode && c.retref ? ' · ' : ''}
                      {c.retref ? `ref ${c.retref}` : ''}
                    </div>
                    {/* Every reversal, not just the last — a partially
                        refunded charge has more than one, and showing only
                        the most recent misstates how much came back. */}
                    {(c.reversals ?? []).map((v) => (
                      <div key={v.id} className="text-xs text-amber-700 mt-0.5">
                        {v.kind === 'VOID' ? 'Voided' : 'Refunded'} {money(v.amount)}
                        {v.retref ? ` · ref ${v.retref}` : ''}
                        {v.reason ? ` · ${v.reason}` : ''}
                      </div>
                    ))}
                    {(c.reversedTotal ?? 0) > 0 &&
                      (c.reversedTotal ?? 0) < c.gatewayTotal && (
                        <div className="text-xs text-zinc-600 mt-0.5">
                          {money(c.gatewayTotal - (c.reversedTotal ?? 0))} still on the card
                        </div>
                      )}
                  </div>
                  {/* Available while ANY of the charge is unreversed, so a
                      partial refund can be followed by another. */}
                  {c.status === 'APPROVED' && (c.reversedTotal ?? 0) < c.gatewayTotal && (
                    <button
                      onClick={() => reverse(c)}
                      disabled={reversing === c.id}
                      className="flex-none rounded-lg border border-zinc-300 hover:border-red-500 hover:text-red-600 text-zinc-700 px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-40"
                    >
                      {reversing === c.id ? 'Reversing…' : 'Void / Refund'}
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {collectedRows.length > 0 && (
          <div className="bg-gradient-to-b from-white to-zinc-50 border border-zinc-200 rounded-2xl p-4 transition-colors duration-200 hover:border-zinc-400">
            <div className="flex items-center justify-between mb-1">
              <h2 className="text-[15px] font-semibold text-zinc-900 flex items-center gap-2.5 before:content-[''] before:w-1 before:h-4 before:rounded-full before:bg-emerald-500/80">Collected</h2>
              <span className="text-[12px] text-zinc-600">last 60 days · newest first</span>
            </div>
            <div className="divide-y divide-zinc-200 max-h-[220px] overflow-y-auto">
              {collectedRows.map((cv) => (
                <div key={cv.id} className="py-2.5 px-2">
                  <div className="flex justify-between gap-3">
                    <span className="text-sm font-semibold text-zinc-900">
                      {cv.jobName || cv.invoiceNumber || 'Final invoice'}
                    </span>
                    <span className="text-sm text-emerald-700 font-semibold">{money(cv.amount)}</span>
                  </div>
                  <div className="text-xs text-zinc-600 mt-0.5">
                    {cv.companyName || '—'}
                    {cv.invoiceNumber ? ` · ${cv.invoiceNumber}` : ''}
                  </div>
                  <div className="text-xs text-zinc-600 mt-0.5">
                    {cv.collectedVia ? cv.collectedVia.toLowerCase() : 'collected'}
                    {cv.collectedAt &&
                      ` · ${new Date(cv.collectedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`}
                    {cv.collectedBy && ` · by ${cv.collectedBy}`}
                    {cv.collectedAt &&
                      ` · ${Math.max(0, Math.round((new Date(cv.collectedAt).getTime() - new Date(cv.uploadedAt).getTime()) / 86_400_000))}d to collect`}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        </div>

        {/* ── charge ───────────────────────────────────────────── */}
        {/* Sticky: the left column is four cards tall, and the amount +
            Charge button must stay in view while picking from a long list —
            that is also what keeps the overcharge warnings visible. */}
        <div className="bg-gradient-to-b from-white to-zinc-50 border border-zinc-200 rounded-2xl p-4 transition-colors duration-200 hover:border-zinc-400 space-y-4 lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto">
          <h2 className="text-[15px] font-semibold text-zinc-900 flex items-center gap-2.5 before:content-[''] before:w-1 before:h-4 before:rounded-full before:bg-amber-500/80">Attach, confirm, charge</h2>

          {!invoice ? (
            <p className="text-sm text-zinc-600 py-8 text-center">
              Pick an invoice on the left to begin.
            </p>
          ) : (
            <>
              <div className="bg-zinc-50 rounded-lg px-3 py-2.5 text-sm">
                <div className="font-semibold text-zinc-900">
                  {invoice.invoiceNumber || '(no number)'}
                </div>
                <div className="text-xs text-zinc-600 mt-0.5">
                  {invoice.customerName || '—'} · balance {money(invoice.remainingTotal)}
                </div>
                {/* The queue and browse rows flag prior charges, but THIS box
                    is what the operator reads while charging. */}
                {invoice.alreadyCharged.total > 0 && (
                  <div className="text-xs text-amber-700 mt-1">
                    {money(invoice.alreadyCharged.total)} already charged against this invoice here.
                  </div>
                )}
              </div>

              <div>
                <label className={label}>RentalWorks invoice PDF</label>
                <input
                  type="file"
                  accept="application/pdf"
                  onChange={(e) => e.target.files?.[0] && uploadPdf(e.target.files[0])}
                  className="block w-full text-sm text-zinc-700 file:mr-3 file:rounded-lg file:border-0 file:bg-zinc-100 file:px-3 file:py-1.5 file:text-sm file:text-zinc-800 hover:file:bg-zinc-200"
                />
                {uploading && <p className="text-xs text-zinc-600 mt-1">Uploading…</p>}
                {pdf && <p className="text-xs text-green-700 mt-1">Attached: {pdf.name}</p>}
              </div>

              <div>
                <label className={label}>Amount to apply to the invoice</label>
                <input
                  className={input}
                  inputMode="decimal"
                  placeholder="0.00"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
                {validAmount && invoice.remainingTotal > 0 && base > invoice.remainingTotal && (
                  <p className="mt-1.5 text-xs text-red-700">
                    {money(base)} is more than the {money(invoice.remainingTotal)} balance on this
                    invoice.
                  </p>
                )}
                {validAmount && (
                  <div className="mt-2 text-xs bg-zinc-50 rounded-lg px-3 py-2 space-y-0.5">
                    <div className="flex justify-between text-zinc-700">
                      <span>Applied to invoice</span>
                      <span>{money(base)}</span>
                    </div>
                    {/* An ESTIMATE, and labelled as one. The processor applies
                        the fee and waives it for debit, prepaid, and states
                        that prohibit surcharging — so this panel cannot know
                        the figure in advance. It previously stated a flat 3%
                        and a definite total, which after the switch to
                        gateway-applied surcharging was a promise the charge
                        would not necessarily keep. */}
                    <div className="flex justify-between text-zinc-600">
                      <span>Card processing fee (up to 3%)</span>
                      <span>{money(surcharge)}</span>
                    </div>
                    <div className="flex justify-between text-zinc-900 font-bold border-t border-zinc-300 pt-1 mt-1">
                      <span>Card will be charged</span>
                      <span>
                        {money(base)}–{money(total)}
                      </span>
                    </div>
                    <p className="text-[11px] text-zinc-600 pt-1">
                      The processor calculates the fee and waives it where
                      surcharging isn&rsquo;t allowed. The exact amount is
                      confirmed after the charge.
                    </p>
                  </div>
                )}
              </div>

              <div>
                <label className={label}>Card</label>
                <div className="flex gap-2 mb-2">
                  {(['saved', 'new'] as const).map((s) => (
                    <button
                      key={s}
                      onClick={() => setSource(s)}
                      className={`flex-1 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                        source === s
                          ? 'bg-amber-600 text-zinc-900'
                          : 'bg-zinc-100 text-zinc-700 hover:bg-zinc-200'
                      }`}
                    >
                      {s === 'saved'
                        ? knowsClient
                          ? `On file (${clientAuths.length})`
                          : `On file (${auths.length})`
                        : 'Key a card'}
                    </button>
                  ))}
                </div>

                {source === 'saved' ? (
                  auths.length === 0 ? (
                    <p className="text-xs text-zinc-600 bg-zinc-50 rounded-lg px-3 py-2.5 leading-relaxed">
                      No cards on file yet. This fills as clients save a card in the portal, and as
                      staff key one from a signed authorization on the client&rsquo;s CRM page —
                      historical authorizations live in Cognito and can&rsquo;t be charged from
                      here. Use <b className="text-zinc-700">Key a card</b> in the meantime.
                    </p>
                  ) : (
                    <>
                      <select
                        className={input}
                        value={savedId}
                        onChange={(e) => {
                          setSavedId(e.target.value)
                          // A fresh card needs a fresh acknowledgement.
                          setCrossClientOk(false)
                        }}
                      >
                        <option value="">Select a card…</option>
                        {knowsClient ? (
                          <>
                            <optgroup
                              label={
                                clientAuths.length > 0
                                  ? `On file for ${targetCompanyName || 'this client'}`
                                  : `Nothing on file for ${targetCompanyName || 'this client'}`
                              }
                            >
                              {clientAuths.map((a) => (
                                <option key={`${a.origin}:${a.id}`} value={a.id}>
                                  {cardOptionLabel(a)}
                                </option>
                              ))}
                            </optgroup>
                            {otherAuths.length > 0 && (
                              <optgroup label={`Other clients (${otherAuths.length})`}>
                                {otherAuths.map((a) => (
                                  <option key={`${a.origin}:${a.id}`} value={a.id}>
                                    {a.companyName ? `${a.companyName} — ` : ''}
                                    {cardOptionLabel(a)}
                                  </option>
                                ))}
                              </optgroup>
                            )}
                          </>
                        ) : (
                          auths.map((a) => (
                            <option key={`${a.origin}:${a.id}`} value={a.id}>
                              {a.companyName ? `${a.companyName} — ` : ''}
                              {cardOptionLabel(a)}
                            </option>
                          ))
                        )}
                      </select>
                      {knowsClient && clientAuths.length === 0 && (
                        <p className="mt-2 text-xs text-zinc-600 bg-zinc-50 rounded-lg px-3 py-2">
                          No card on file for {targetCompanyName || 'this client'}. Key the card
                          instead, or add one on their client page so it is here next time.
                        </p>
                      )}
                      {crossClient && (
                        <div className="mt-2 rounded-lg border border-red-300 bg-red-50 px-3 py-2.5 text-xs text-red-900">
                          <p className="font-semibold">
                            This card is on file for {selectedAuth?.companyName}, not{' '}
                            {targetCompanyName || 'this client'}.
                          </p>
                          <label className="mt-2 flex items-start gap-2">
                            <input
                              type="checkbox"
                              className="mt-0.5"
                              checked={crossClientOk}
                              onChange={(e) => {
                                setCrossClientOk(e.target.checked)
                                setConfirming(false)
                              }}
                            />
                            <span>
                              Charge {selectedAuth?.companyName}&rsquo;s card for this invoice
                              anyway — they are paying on this client&rsquo;s behalf.
                            </span>
                          </label>
                        </div>
                      )}
                      {selectedAuth && (
                        <div className="mt-2 text-xs bg-zinc-50 rounded-lg px-3 py-2 space-y-1">
                          {selectedAuth.authorizedAt && (
                            <div className="text-zinc-600">
                              Authorized{' '}
                              {new Date(selectedAuth.authorizedAt).toLocaleDateString('en-US', {
                                month: 'short',
                                day: 'numeric',
                                year: 'numeric',
                              })}
                            </div>
                          )}
                          <div className="text-zinc-700">
                            Rental agreement:{' '}
                            {selectedAuth.rentalAgreement ? (
                              <span className="text-green-700">
                                {selectedAuth.rentalAgreement.status}
                                {selectedAuth.rentalAgreement.signedDocumentUrl && (
                                  <a
                                    href={selectedAuth.rentalAgreement.signedDocumentUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="ml-2 text-amber-700 underline"
                                  >
                                    view
                                  </a>
                                )}
                              </span>
                            ) : (
                              <span className="text-amber-700">none found on this job</span>
                            )}
                          </div>
                          {selectedAuth.paymentPreference === 'UNDECIDED' && (
                            <div className="text-amber-700">
                              Client hasn&rsquo;t chosen a payment method yet — this card is on
                              file as a guarantee, not an election to pay by card.
                            </div>
                          )}
                          {selectedAuth.paymentPreference === 'CHECK_WIRE' && (
                            <div className="text-amber-700">
                              Client elected to pay by check/wire — this card was authorized as
                              security only.
                            </div>
                          )}
                        </div>
                      )}
                    </>
                  )
                ) : (
                  <>
                    {iframeUrl ? (
                      // Attributes match the portal's pay panel, which is the
                      // proven configuration for this tokenizer.
                      <iframe
                        key={cardFormKey}
                        title="Card entry"
                        src={iframeUrl}
                        frameBorder="0"
                        scrolling="no"
                        width="100%"
                        // The tokenizer renders THREE stacked labelled inputs once useexpiry/
                        // usecvv are on. 48px was sized for the old number-only widget and
                        // silently clipped expiry and CVV — the fields were present but
                        // invisible, with scrolling='no' hiding the overflow.
                        height="150"
                        className="bg-white rounded-lg"
                      />
                    ) : (
                      <p className="text-xs text-zinc-600">Loading secure card entry…</p>
                    )}
                    {/* Expiry lives here, not in the iframe — the tokenizer
                        doesn't reliably return it. Styled like the rest of the
                        form rather than the iframe's default controls. */}
                    <div className="mt-2 flex gap-2">
                      <select
                        className={input}
                        value={expMonth}
                        onChange={(e) => setExpMonth(e.target.value)}
                        aria-label="Expiry month"
                      >
                        <option value="">Month</option>
                        {Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, '0')).map(
                          (m) => (
                            <option key={m} value={m}>
                              {m}
                            </option>
                          ),
                        )}
                      </select>
                      <select
                        className={input}
                        value={expYear}
                        onChange={(e) => setExpYear(e.target.value)}
                        aria-label="Expiry year"
                      >
                        <option value="">Year</option>
                        {Array.from({ length: 15 }, (_, i) => 26 + i).map((y) => (
                          <option key={y} value={String(y)}>
                            20{y}
                          </option>
                        ))}
                      </select>
                    </div>
                    {cardToken && cardExpiry.length === 4 && (
                      <p className="text-xs text-green-700 mt-1">Card captured.</p>
                    )}
                    {cardToken && cardExpiry.length !== 4 && (
                      <p className="text-xs text-amber-700 mt-1">
                        Choose the expiry month and year to continue.
                      </p>
                    )}
                    <div className="mt-2 flex gap-1.5">
                      {(['VISA', 'MASTERCARD', 'AMEX', 'DISCOVER'] as const).map((b) => (
                        <button
                          key={b}
                          type="button"
                          onClick={() => setCardBrand(cardBrand === b ? '' : b)}
                          className={`flex-1 rounded-lg px-2 py-1.5 text-[11px] font-semibold transition-colors ${
                            cardBrand === b
                              ? 'bg-amber-600 text-zinc-900'
                              : 'bg-zinc-100 text-zinc-600 hover:text-zinc-900'
                          }`}
                        >
                          {b === 'MASTERCARD' ? 'MC' : b === 'DISCOVER' ? 'DISC' : b}
                        </button>
                      ))}
                    </div>
                    <input
                      className={`${input} mt-2`}
                      placeholder="Cardholder name"
                      value={cardholderName}
                      onChange={(e) => setCardholderName(e.target.value)}
                    />
                    <input
                      className={`${input} mt-2`}
                      placeholder="Cardholder's billing ZIP"
                      inputMode="numeric"
                      value={cardPostal}
                      onChange={(e) => setCardPostal(e.target.value)}
                    />
                    {/* Spelled out because the obvious wrong answer is the shoot
                        location. Eligibility follows the CARDHOLDER's state, so
                        a Connecticut production paying for an LA job must not be
                        surcharged — and a job-site ZIP would silently apply the
                        wrong state's rules. */}
                    <p className="text-xs text-zinc-600 mt-1">
                      The ZIP on the cardholder&rsquo;s billing statement — not
                      the job location. It decides whether the card fee applies:
                      the fee is waived for debit cards and for cardholders in
                      states that prohibit surcharging.
                    </p>
                  </>
                )}
              </div>

              <div>
                <label className={label}>Note (optional)</label>
                <input
                  className={input}
                  placeholder="e.g. spoke with Dana, authorized over phone"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
              </div>

              {err && <p className="text-sm text-red-700">{err}</p>}

              <button
                onClick={() => {
                  if (!canCharge) return
                  if (!confirming) {
                    setConfirming(true)
                    return
                  }
                  setConfirming(false)
                  void charge()
                }}
                disabled={!canCharge}
                className={`w-full rounded-lg disabled:opacity-40 disabled:cursor-not-allowed text-zinc-900 font-bold px-4 py-2.5 text-sm transition-colors ${
                  confirming ? 'bg-amber-500 ring-2 ring-amber-300' : 'bg-amber-600 hover:bg-amber-500'
                }`}
              >
                {/* Names the amount we actually send. The fee is added by the
                    processor on top, so a single definite total here would be
                    wrong whenever the fee is waived. Armed, it re-states
                    amount + card + who, and asks to be clicked again. */}
                {busy
                  ? 'Charging…'
                  : confirming
                    ? `Confirm: charge ${money(base)} + fee to ····${
                        source === 'saved' ? selectedAuth?.last4 ?? '????' : cardToken?.slice(-4) ?? '????'
                      }${invoice.customerName ? ` — ${invoice.customerName}` : ''}`
                    : validAmount
                      ? `Charge ${money(base)} + fee`
                      : 'Charge'}
              </button>
              {confirming && !busy && (
                <p className="text-[11px] text-zinc-600 text-center -mt-2">
                  Click again to charge the card. This is a live charge.
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
