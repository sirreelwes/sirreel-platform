'use client'

import { useCallback, useEffect, useState } from 'react'

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
  cardholderName: string | null
  cardType: string | null
  last4: string | null
  authorizedAt: string | null
  paymentPreference: string
  jobName: string | null
  jobCode: string | null
  orderNumber: string | null
  rentalAgreement: { status: string; signedAt: string | null; signedDocumentUrl: string | null } | null
}

interface RwInvoice {
  rwInvoiceId: string
  invoiceNumber: string | null
  customerName: string | null
  dealName: string | null
  orderNumber: string | null
  invoiceDate: string | null
  status: string | null
  invoiceTotal: number
  remainingTotal: number
  alreadyCharged: { count: number; total: number; last: string | null }
}

interface FinalInvoice {
  id: string
  rwInvoiceId: string | null
  invoiceNumber: string | null
  amount: number
  pdfUrl: string | null
  note: string | null
  jobName: string | null
  jobCode: string | null
  companyName: string | null
  alreadyCharged: number
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
  reversedAt: string | null
  reversalKind: string | null
  reversalRetref: string | null
}

const money = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD' })

export function CollectionsWorkspace({ operatorName }: { operatorName: string }) {
  const [auths, setAuths] = useState<Authorization[]>([])
  const [invoices, setInvoices] = useState<RwInvoice[]>([])
  const [finals, setFinals] = useState<FinalInvoice[]>([])
  const [finalPick, setFinalPick] = useState<FinalInvoice | null>(null)
  const [charges, setCharges] = useState<ChargeRow[]>([])
  const [reversing, setReversing] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [invoice, setInvoice] = useState<RwInvoice | null>(null)
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [pdf, setPdf] = useState<{ pdfUrl: string; pdfKey: string; name: string } | null>(null)
  const [uploading, setUploading] = useState(false)

  const [source, setSource] = useState<'saved' | 'new'>('new')
  const [savedId, setSavedId] = useState('')
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
      .then((d) => d.ok && setFinals(d.finalInvoices ?? []))
      .catch(() => {})
  }, [])

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
      .then((d) => d.ok && setInvoices(d.invoices ?? []))
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
  const cardReady =
    source === 'saved'
      ? !!savedId
      : !!cardToken &&
        cardExpiry.length === 4 &&
        cardPostal.trim().length >= 5 &&
        !!cardBrand
  const canCharge = !!invoice && validAmount && cardReady && !busy

  const selectedAuth = auths.find((a) => a.id === savedId) ?? null

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
          savedPaperworkId: source === 'saved' ? savedId : undefined,
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
    const reason = window.prompt(
      `Reverse ${money(c.gatewayTotal)} charged to ****${c.cardLast4 ?? '????'}?\n\n` +
        'The gateway voids it if it has not settled yet, otherwise it refunds. ' +
        'Enter a reason (required, min 4 characters):',
    )
    if (!reason || reason.trim().length < 4) return
    setReversing(c.id)
    try {
      const r = await fetch(`/api/collections/charges/${c.id}/reverse`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: reason.trim() }),
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

  const label = 'text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-1.5 block'
  const input =
    'w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder:text-zinc-500 outline-none focus:border-amber-600'

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      <div className="flex items-baseline justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Collections</h1>
          <p className="text-sm text-zinc-400 mt-1">
            Take a card payment against a RentalWorks invoice. Signed in as {operatorName}.
          </p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.1fr_1fr] items-start">
        {/* ── invoices ─────────────────────────────────────────── */}
        <div className="space-y-6">
        {/* Ready to collect — finalized by an agent on the job page. This is
            the queue Ana works; the RW browse below is the fallback for
            anything finalized outside HQ. */}
        <div className="bg-zinc-900 border border-amber-700/50 rounded-xl p-5">
          <h2 className="text-sm font-bold text-white mb-1">Ready to collect</h2>
          <p className="text-xs text-zinc-400 mb-3">
            Final amounts agreed with the client and sent over from the job page.
          </p>
          {finals.length === 0 ? (
            <p className="text-sm text-zinc-500 py-3">
              Nothing queued. Agents send invoices here with{' '}
              <b className="text-zinc-300">Upload final invoice</b> on the job page.
            </p>
          ) : (
            <div className="divide-y divide-zinc-800 max-h-[260px] overflow-y-auto">
              {finals.map((fv) => (
                <button
                  key={fv.id}
                  onClick={() => {
                    setFinalPick(fv)
                    setAmount(String(fv.amount))
                    setInvoice({
                      rwInvoiceId: fv.rwInvoiceId || `final:${fv.id}`,
                      invoiceNumber: fv.invoiceNumber,
                      customerName: fv.companyName,
                      dealName: fv.jobName,
                      orderNumber: null,
                      invoiceDate: null,
                      status: 'FINAL',
                      invoiceTotal: fv.amount,
                      remainingTotal: fv.amount,
                      alreadyCharged: { count: 0, total: fv.alreadyCharged, last: null },
                    })
                  }}
                  className={`w-full text-left py-2.5 px-2 rounded transition-colors ${
                    finalPick?.id === fv.id ? 'bg-amber-600/20' : 'hover:bg-zinc-800'
                  }`}
                >
                  <div className="flex justify-between gap-3">
                    <span className="text-sm font-semibold text-white">
                      {fv.jobName || fv.invoiceNumber || 'Final invoice'}
                    </span>
                    <span className="text-sm text-amber-500 font-semibold">
                      {money(fv.amount)}
                    </span>
                  </div>
                  <div className="text-xs text-zinc-400 mt-0.5">
                    {fv.companyName || '—'}
                    {fv.invoiceNumber ? ` · ${fv.invoiceNumber}` : ''}
                    {fv.pdfUrl ? ' · PDF attached' : ' · no PDF'}
                  </div>
                  {fv.note && <div className="text-xs text-zinc-500 mt-0.5">{fv.note}</div>}
                  {fv.alreadyCharged > 0 && (
                    <div className="text-xs text-amber-500/90 mt-1">
                      ⚠ {money(fv.alreadyCharged)} already collected against this invoice
                    </div>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="bg-zinc-900 border border-zinc-700 rounded-xl p-5">
          <h2 className="text-sm font-bold text-white mb-3">Or browse RentalWorks invoices</h2>
          <input
            className={input}
            placeholder="Search invoice #, customer, order, production… (blank = all with a balance)"
            value={q}
            onChange={(e) => {
              setQ(e.target.value)
              loadInvoices(e.target.value)
            }}
          />
          <div className="mt-3 max-h-[320px] overflow-y-auto divide-y divide-zinc-800">
            {invoices.length === 0 && (
              <div className="py-6 text-sm text-zinc-500 text-center">No invoices found.</div>
            )}
            {invoices.map((i) => (
              <button
                key={i.rwInvoiceId}
                onClick={() => {
                  setInvoice(i)
                  setAmount(i.remainingTotal > 0 ? String(i.remainingTotal) : '')
                }}
                className={`w-full text-left py-2.5 px-2 rounded transition-colors ${
                  invoice?.rwInvoiceId === i.rwInvoiceId ? 'bg-amber-600/15' : 'hover:bg-zinc-800'
                }`}
              >
                <div className="flex justify-between gap-3">
                  <span className="text-sm font-semibold text-white">
                    {i.invoiceNumber || '(no number)'}
                  </span>
                  <span className="text-sm text-amber-500 font-semibold">
                    {money(i.remainingTotal)} due
                  </span>
                </div>
                <div className="text-xs text-zinc-400 mt-0.5">
                  {i.customerName || '—'}
                  {i.dealName ? ` · ${i.dealName}` : ''}
                  {i.status ? ` · ${i.status}` : ''}
                </div>
                {i.alreadyCharged.count > 0 && (
                  <div className="text-xs text-amber-500/90 mt-1">
                    ⚠ {i.alreadyCharged.count} charge{i.alreadyCharged.count === 1 ? '' : 's'} already
                    taken here totalling {money(i.alreadyCharged.total)}
                  </div>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Recent charges + reversal. Without this the history was
            write-only: a mis-keyed amount had no path back short of a
            database query, which is not a thing Ana can do mid-call. */}
        <div className="bg-zinc-900 border border-zinc-700 rounded-xl p-5">
          <h2 className="text-sm font-bold text-white mb-1">Recent charges</h2>
          <p className="text-xs text-zinc-400 mb-3">
            Void if it hasn&rsquo;t settled yet, refund if it has — the gateway decides which.
          </p>
          {charges.length === 0 ? (
            <p className="text-sm text-zinc-500 py-2">Nothing charged yet.</p>
          ) : (
            <div className="divide-y divide-zinc-800 max-h-[280px] overflow-y-auto">
              {charges.map((c) => (
                <div key={c.id} className="py-2.5 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-white">
                      {money(c.gatewayTotal)}
                      <span className="text-zinc-400 font-normal">
                        {' '}
                        ····{c.cardLast4 ?? '????'}
                      </span>
                    </div>
                    <div className="text-xs text-zinc-400 mt-0.5 truncate">
                      {c.customerName || c.invoiceNumber || '—'} ·{' '}
                      {new Date(c.chargedAt).toLocaleString()}
                    </div>
                    <div className="text-xs text-zinc-500 mt-0.5">
                      {c.status}
                      {c.authCode ? ` · auth ${c.authCode}` : ''}
                      {c.retref ? ` · ref ${c.retref}` : ''}
                    </div>
                    {c.reversedAt && (
                      <div className="text-xs text-amber-500 mt-0.5">
                        {c.reversalKind === 'VOID' ? 'Voided' : 'Refunded'}
                        {c.reversalRetref ? ` · ref ${c.reversalRetref}` : ''}
                      </div>
                    )}
                  </div>
                  {c.status === 'APPROVED' && !c.reversedAt && (
                    <button
                      onClick={() => reverse(c)}
                      disabled={reversing === c.id}
                      className="flex-none rounded-lg border border-zinc-600 hover:border-red-500 hover:text-red-400 text-zinc-300 px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-40"
                    >
                      {reversing === c.id ? 'Reversing…' : 'Void / Refund'}
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
        </div>

        {/* ── charge ───────────────────────────────────────────── */}
        <div className="bg-zinc-900 border border-zinc-700 rounded-xl p-5 space-y-4">
          <h2 className="text-sm font-bold text-white">2. Attach, confirm, charge</h2>

          {!invoice ? (
            <p className="text-sm text-zinc-500 py-8 text-center">
              Pick an invoice on the left to begin.
            </p>
          ) : (
            <>
              <div className="bg-zinc-800/60 rounded-lg px-3 py-2.5 text-sm">
                <div className="font-semibold text-white">
                  {invoice.invoiceNumber || '(no number)'}
                </div>
                <div className="text-xs text-zinc-400 mt-0.5">
                  {invoice.customerName || '—'} · balance {money(invoice.remainingTotal)}
                </div>
              </div>

              <div>
                <label className={label}>RentalWorks invoice PDF</label>
                <input
                  type="file"
                  accept="application/pdf"
                  onChange={(e) => e.target.files?.[0] && uploadPdf(e.target.files[0])}
                  className="block w-full text-sm text-zinc-300 file:mr-3 file:rounded-lg file:border-0 file:bg-zinc-700 file:px-3 file:py-1.5 file:text-sm file:text-white hover:file:bg-zinc-600"
                />
                {uploading && <p className="text-xs text-zinc-400 mt-1">Uploading…</p>}
                {pdf && <p className="text-xs text-green-400 mt-1">Attached: {pdf.name}</p>}
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
                {validAmount && (
                  <div className="mt-2 text-xs bg-zinc-800/60 rounded-lg px-3 py-2 space-y-0.5">
                    <div className="flex justify-between text-zinc-300">
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
                    <div className="flex justify-between text-zinc-400">
                      <span>Card processing fee (up to 3%)</span>
                      <span>{money(surcharge)}</span>
                    </div>
                    <div className="flex justify-between text-white font-bold border-t border-zinc-700 pt-1 mt-1">
                      <span>Card will be charged</span>
                      <span>
                        {money(base)}–{money(total)}
                      </span>
                    </div>
                    <p className="text-[11px] text-zinc-500 pt-1">
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
                          : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'
                      }`}
                    >
                      {s === 'saved' ? `On file (${auths.length})` : 'Key a card'}
                    </button>
                  ))}
                </div>

                {source === 'saved' ? (
                  auths.length === 0 ? (
                    <p className="text-xs text-zinc-500 bg-zinc-800/60 rounded-lg px-3 py-2.5 leading-relaxed">
                      No authorizations on file yet. This fills as clients complete the card
                      authorization step in the portal — historical authorizations live in Cognito
                      and can&rsquo;t be charged from here. Use <b className="text-zinc-300">Key a
                      card</b> in the meantime.
                    </p>
                  ) : (
                    <>
                      <select
                        className={input}
                        value={savedId}
                        onChange={(e) => setSavedId(e.target.value)}
                      >
                        <option value="">Select an authorization…</option>
                        {auths.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.cardholderName || 'Unnamed'} · {a.cardType || 'card'} ****{a.last4}
                            {a.jobName ? ` · ${a.jobName}` : ''}
                          </option>
                        ))}
                      </select>
                      {selectedAuth && (
                        <div className="mt-2 text-xs bg-zinc-800/60 rounded-lg px-3 py-2 space-y-1">
                          <div className="text-zinc-300">
                            Rental agreement:{' '}
                            {selectedAuth.rentalAgreement ? (
                              <span className="text-green-400">
                                {selectedAuth.rentalAgreement.status}
                                {selectedAuth.rentalAgreement.signedDocumentUrl && (
                                  <a
                                    href={selectedAuth.rentalAgreement.signedDocumentUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="ml-2 text-amber-500 underline"
                                  >
                                    view
                                  </a>
                                )}
                              </span>
                            ) : (
                              <span className="text-amber-500">none found on this job</span>
                            )}
                          </div>
                          {selectedAuth.paymentPreference === 'CHECK_WIRE' && (
                            <div className="text-amber-500">
                              ⚠ Client elected to pay by check/wire — this card was authorized as
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
                      <p className="text-xs text-zinc-500">Loading secure card entry…</p>
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
                      <p className="text-xs text-green-400 mt-1">Card captured.</p>
                    )}
                    {cardToken && cardExpiry.length !== 4 && (
                      <p className="text-xs text-amber-500 mt-1">
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
                              : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200'
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
                    <p className="text-xs text-zinc-500 mt-1">
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

              {err && <p className="text-sm text-red-400">{err}</p>}
              {result && (
                <p className={`text-sm ${result.ok ? 'text-green-400' : 'text-red-400'}`}>
                  {result.message}
                </p>
              )}

              <button
                onClick={charge}
                disabled={!canCharge}
                className="w-full rounded-lg bg-amber-600 hover:bg-amber-500 disabled:opacity-40 disabled:cursor-not-allowed text-zinc-900 font-bold px-4 py-2.5 text-sm transition-colors"
              >
                {/* Names the amount we actually send. The fee is added by the
                    processor on top, so a single definite total here would be
                    wrong whenever the fee is waived. */}
                {busy
                  ? 'Charging…'
                  : validAmount
                    ? `Charge ${money(base)} + fee`
                    : 'Charge'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
