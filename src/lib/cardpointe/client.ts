/**
 * CardPointe (CardConnect) gateway REST client.
 *
 * Phase 6 commit 1 — single chokepoint for every CardPointe API call.
 * UAT-only for now. Production go-live (post-ACH-underwriting) flips
 * the CARDPOINTE_ENV env var to "PROD" and reads the matching
 * CARDPOINTE_PROD_* set.
 *
 * Authentication: HTTP Basic against the gateway. CardConnect's
 * convention is the gateway hostname WITHOUT the /cardconnect/rest
 * suffix in the UAT URL we already store — the tokenizer iframe uses
 * the bare hostname (`fts-uat.cardconnect.com`) while the REST API
 * lives under `https://<host>/cardconnect/rest`. We normalize both
 * forms here.
 *
 * NEVER log raw card or bank numbers. Token in, MID + amount in,
 * gateway-managed retref out. Errors bubble up so callers can
 * decide whether to retry or mark FAILED.
 */

type CardPointeEnv = 'UAT' | 'PROD'

interface CardPointeConfig {
  env: CardPointeEnv
  /** Bare hostname or full URL — both accepted. */
  baseUrl: string
  /** Merchant ID. */
  mid: string
  username: string
  password: string
}

/** Resolve the active environment from CARDPOINTE_ENV (defaults to UAT). */
export function cardpointeEnv(): CardPointeEnv {
  return (process.env.CARDPOINTE_ENV ?? 'UAT').toUpperCase() === 'PROD' ? 'PROD' : 'UAT'
}

/** Env var prefix for the active environment. */
function cardpointePrefix(): 'CARDPOINTE_PROD' | 'CARDPOINTE_UAT' {
  return cardpointeEnv() === 'PROD' ? 'CARDPOINTE_PROD' : 'CARDPOINTE_UAT'
}

/**
 * The env-appropriate CardConnect base host. Within one environment the
 * SAME host serves the CardSecure tokenizer iframe (`/itoke/…`) and the
 * REST gateway (`/cardconnect/rest`), so the tokenizer route and the
 * gateway client MUST resolve it from the same CARDPOINTE_ENV → *_URL
 * map — otherwise a token minted on one environment's tokenizer is
 * handed to the other environment's gateway and the charge rejects.
 * Returns null when the env var is unset (caller decides how to fail).
 */
/**
 * Origin for the CardSecure TOKENIZER iframe.
 *
 * MUST be the same CardConnect SITE as the REST gateway. Tokens are
 * site-scoped: one minted on fts-uat is rejected by a boltgw-uat gateway with
 * "Invalid token", which is exactly what happened when this returned a
 * hardcoded fts host. Both hosts serve the tokenizer page and both return 200,
 * so reachability proves nothing — only the site match matters.
 *
 * So: derive it from the SAME env var the gateway uses, dropping the
 * /cardconnect/rest path.
 *   CARDPOINTE_UAT_URL = https://boltgw-uat.cardconnect.com/cardconnect/rest
 *   tokenizer          = https://boltgw-uat.cardconnect.com/itoke/...
 *
 * This is what the file header above meant by "we normalize both forms here" —
 * it just never did. The original code returned the URL verbatim, so the
 * tokenizer path was appended to /cardconnect/rest and 404'd.
 *
 * CARDPOINTE_{UAT,PROD}_TOKENIZER_URL overrides, for an account whose
 * tokenizer genuinely lives on a different host.
 */
export function cardpointeBaseUrl(): string | null {
  const override = process.env[`${cardpointePrefix()}_TOKENIZER_URL`]
  if (override && override.trim()) return override.trim().replace(/\/+$/, '')

  const gateway = process.env[`${cardpointePrefix()}_URL`]
  if (!gateway || !gateway.trim()) return null
  try {
    return new URL(gateway.trim()).origin
  } catch {
    // Bare hostname with no scheme — tolerate it rather than dropping the
    // card field entirely.
    return `https://${gateway.trim().replace(/^\/+|\/.*$/g, '')}`
  }
}


function readConfig(): CardPointeConfig {
  const env = cardpointeEnv()

  const prefix = cardpointePrefix()
  const baseUrl = process.env[`${prefix}_URL`] ?? ''
  const mid = process.env[`${prefix}_MID`] ?? ''
  const username = process.env[`${prefix}_USERNAME`] ?? ''
  const password = process.env[`${prefix}_PASSWORD`] ?? ''

  if (!baseUrl || !mid || !username || !password) {
    throw new Error(
      `[cardpointe] missing env for ${env}: need ${prefix}_URL, _MID, _USERNAME, _PASSWORD`,
    )
  }
  return { env, baseUrl, mid, username, password }
}

/**
 * Returns the REST API base — accepts either a bare hostname like
 * `fts-uat.cardconnect.com` or a fully-formed URL. Normalizes to
 * `https://<host>/cardconnect/rest`.
 */
function restBase(cfg: CardPointeConfig): string {
  let host = cfg.baseUrl.trim().replace(/\/+$/, '')
  if (!host.startsWith('http')) {
    host = `https://${host}`
  }
  const url = new URL(host)
  // Strip any path the caller may have included.
  return `${url.origin}/cardconnect/rest`
}

function authHeader(cfg: CardPointeConfig): string {
  const token = Buffer.from(`${cfg.username}:${cfg.password}`).toString('base64')
  return `Basic ${token}`
}

// ─── Request shapes ─────────────────────────────────────────────
// Field names match CardConnect's documented JSON schema. We
// deliberately keep these minimal — only the columns we actually
// send. Optional gateway fields can be added as needed without
// changing the wire format for existing callers.

export interface AuthRequest {
  /** Card token (from CardSecure iframe) OR ACH bank account token. */
  account: string
  /** Amount in dollars, decimal string ("100.00"). Gateway prefers
   *  string to avoid float-rounding ambiguity. */
  amount: string
  currency: 'USD'
  /** "Y" to authorize-and-capture in one call (default for card).
   *  "N" to authorize-only (auth holds funds; capture later). */
  capture: 'Y' | 'N'
  /** ACH-only: set to "Y" to flag this as an eCheck. Cards omit. */
  /** Transaction origin. 'E' = ecommerce (cardholder at a web form).
   *  'T' = telephone / MOTO — the operator keys a card the client reads out.
   *  Submitting a phone charge as 'E' misrepresents it to the network: it
   *  can downgrade interchange and it weakens SirReel's position in a
   *  dispute, because the record claims the cardholder was present online. */
  ecomind?: 'E' | 'T' | 'R'
  /** Operator-supplied invoice reference — shows on the merchant
   *  statement. We pass our Invoice number here. */
  orderid?: string
  name?: string
  /** MMYY. REQUIRED by the gateway for a card authorization — a token alone
   *  is not enough. Captured from the CardSecure iframe alongside the token. */
  expiry?: string
  /** Cardholder billing postal code.
   *
   *  REQUIRED on every card-not-present authorization once surcharging is
   *  enabled on the merchant account. The gateway decides surcharge
   *  eligibility from the cardholder's region and waives the fee where state
   *  law prohibits it (Connecticut, Massachusetts, ...). Omitting it means
   *  the gateway cannot validate eligibility.
   *
   *  Fiserv: "the merchant must provide the cardholder's postal code to
   *  validate the cardholder's eligibility." */
  postal?: string

  // ── Visa/Mastercard Stored Credential Transaction Framework ──────────
  // Required whenever a card is stored for later use, or a stored card is
  // charged. Field names are Fiserv's, from the CardPointe Gateway Developer
  // Guide ("Scheduling Recurring Payments").
  //
  // WITHOUT these, stored-credential charges are non-compliant with the card
  // brand mandate — they may still authorize, so the omission is invisible
  // until a dispute or an audit.

  /** 'Y' on the INITIAL transaction that establishes a stored credential —
   *  asserts the cardholder consented to their card being saved. */
  cofpermission?: 'Y'
  /** Who initiated a SUBSEQUENT transaction against a stored credential.
   *  'C' customer-initiated (they are present), 'M' merchant-initiated
   *  (we charge without them, e.g. a collections call).
   *  Documented explicitly for 'M'; 'C' is the counterpart value. */
  cof?: 'C' | 'M'
  /** 'Y' for scheduled/recurring, 'N' for a one-off merchant-initiated
   *  charge. SirReel's collections charges are unscheduled, so 'N'. */
  cofscheduled?: 'Y' | 'N'
  /** ACH-only routing fields. */
  bankaba?: string // routing number
  bankaccttype?: 'C' | 'S' // Checking / Savings
}

export interface AuthResponse {
  /** Gateway response code. "00" = approved. Anything else is a
   *  decline or error and the caller should mark the payment FAILED. */
  /** AUTHORITATIVE approval flag: 'A' approved, 'B' retry, 'C' declined.
   *  Prefer this over respcode, whose approval value varies by processor —
   *  checking respcode === '00' recorded a real approval ("Approval") as a
   *  decline, which means the card is charged and the invoice never credited. */
  respstat?: 'A' | 'B' | 'C'
  respcode: string
  /** Human-readable response text. */
  resptext: string
  /** Retrieval reference — gateway's transaction id. Persist as
   *  Payment.gatewayRefId; needed for polling, voids, refunds. */
  retref?: string
  /** Authorization code when approved. */
  authcode?: string
  /** Settlement batch id (when settled). */
  setlstat?: string
  /** Amount the gateway ACTUALLY authorized, decimal string. This is the
   *  authority on what the card was charged — with surcharging enabled the
   *  gateway adds its own fee, so this can exceed the amount we sent. */
  amount?: string
  /** Full raw payload — exposed so callers can persist for forensics
   *  without us having to enumerate every optional field. */
  raw: Record<string, unknown>
}

// ─── Public API ─────────────────────────────────────────────────

/**
 * Authorize + capture a card payment in one call. Card path is
 * instant — the gateway response tells us approve/decline
 * immediately, and the resulting Payment row writes CLEARED.
 */
/**
 * Translate our intent into Fiserv's stored-credential fields.
 *
 * Kept in one place so the three call sites can't disagree — a subsequent
 * charge flagged as an initial one (or vice versa) is exactly the kind of
 * mismatch the card brands penalise, and it authorizes normally either way.
 */
function storedCredentialFields(kind?: 'initial' | 'merchant' | 'customer'): {
  cofpermission?: 'Y'
  cof?: 'C' | 'M'
  cofscheduled?: 'Y' | 'N'
} {
  // Fiserv validation, 2026-08-14: the $0 token-storage call sent
  // cofpermission alone. `cof` and `cofscheduled` are required TOO — the
  // credential is being established by the cardholder, sitting at the portal,
  // so it is customer-initiated and unscheduled. Sending permission without
  // them leaves the stored credential non-compliant with the Visa/Mastercard
  // mandate, and it authorizes normally either way, so nothing surfaced it
  // until Fiserv read the transactions back to us.
  if (kind === 'initial') return { cofpermission: 'Y', cof: 'C', cofscheduled: 'N' }
  // Unscheduled: SirReel charges when a job wraps, not on a fixed cadence.
  // 'Y' here would assert a recurring schedule that does not exist.
  if (kind === 'merchant') return { cof: 'M', cofscheduled: 'N' }
  if (kind === 'customer') return { cof: 'C', cofscheduled: 'N' }
  return {}
}

/**
 * $0 authorization that VALIDATES a card and establishes it as a stored
 * credential — no money moves.
 *
 * The portal's card-authorization step previously saved a token with no
 * gateway call whatsoever. Nothing confirmed the card was real, active, or
 * even correctly keyed; a dead card sat in the collections queue looking
 * perfectly good until someone tried to charge it weeks later, by which point
 * the job had wrapped and the leverage was gone.
 *
 * capture 'N' — authorize only, never settle.
 */
export async function authorizeStoredCredential(args: {
  cardToken: string
  expiry: string
  cardholderName?: string
  reference?: string
  /** Cardholder billing postal — see AuthRequest.postal. */
  postal?: string
}): Promise<AuthResponse> {
  const cfg = readConfig()
  const body: AuthRequest = {
    account: args.cardToken,
    amount: '0',
    currency: 'USD',
    capture: 'N',
    ecomind: 'E',
    orderid: args.reference,
    name: args.cardholderName,
    expiry: args.expiry,
    postal: args.postal,
    ...storedCredentialFields('initial'),
  }
  return postAuth(cfg, body)
}

export async function chargeCard(args: {
  cardToken: string
  amountDollars: number
  invoiceNumber: string
  cardholderName?: string
  /** MMYY from the CardSecure iframe. Card auths decline without it. */
  expiry?: string
  /** True when an operator keyed the card on a phone call (collections).
   *  Sends ecomind 'T' instead of 'E' — see AuthRequest.ecomind. */
  moto?: boolean
  /** Cardholder billing postal — see AuthRequest.postal. Required on
   *  card-not-present auths once surcharging is enabled. */
  postal?: string
  /** Stored-credential framework flags. Omit for a plain one-off sale.
   *  'initial'  — this charge also establishes a credential we will reuse
   *  'merchant' — charging a stored card with the cardholder absent
   *  'customer' — cardholder present, paying with their stored card */
  storedCredential?: 'initial' | 'merchant' | 'customer'
}): Promise<AuthResponse> {
  const cfg = readConfig()
  const body: AuthRequest = {
    account: args.cardToken,
    amount: args.amountDollars.toFixed(2),
    currency: 'USD',
    capture: 'Y',
    ecomind: args.moto ? 'T' : 'E',
    orderid: args.invoiceNumber,
    name: args.cardholderName,
    expiry: args.expiry,
    postal: args.postal,
    ...storedCredentialFields(args.storedCredential),
  }
  return postAuth(cfg, body)
}

/**
 * Originate an ACH (eCheck) debit. Differs from card:
 *  - capture: 'Y' here means "submit to ACH origination" — funds
 *    won't actually settle for 1-2 business days. The Payment row
 *    starts as PENDING and the polling job advances it.
 *  - bankaba (routing) + bankaccttype required. account = ACH token
 *    from the CardSecure echeck iframe (bank account tokenized; we
 *    NEVER see the raw account number).
 *
 * Behind the ACH feature flag in Commit 3 — UAT-only until
 * underwriting completes.
 */
export async function originateAch(args: {
  bankAccountToken: string
  routingNumber: string
  accountType: 'C' | 'S'
  amountDollars: number
  invoiceNumber: string
  accountHolderName?: string
}): Promise<AuthResponse> {
  const cfg = readConfig()
  const body: AuthRequest = {
    account: args.bankAccountToken,
    amount: args.amountDollars.toFixed(2),
    currency: 'USD',
    capture: 'Y',
    ecomind: 'E',
    orderid: args.invoiceNumber,
    name: args.accountHolderName,
    bankaba: args.routingNumber,
    bankaccttype: args.accountType,
  }
  return postAuth(cfg, body)
}

export interface InquireResponse {
  retref: string
  /** "A" = approved, "S" = settled, "R" = rejected/returned, etc.
   *  Caller maps to our PaymentStatus enum. */
  setlstat?: string
  /** Last seen ACH/return reason code, when applicable. */
  bankret?: string
  resptext?: string
  raw: Record<string, unknown>
}

/**
 * Poll a transaction's status. Used by the Commit 4 polling job
 * for outstanding PENDING/SETTLED ACH payments. Returns the
 * gateway's latest known state for the given retref.
 */
export async function inquireByRetref(retref: string): Promise<InquireResponse> {
  const cfg = readConfig()
  const res = await fetch(`${restBase(cfg)}/inquire/${encodeURIComponent(retref)}/${encodeURIComponent(cfg.mid)}`, {
    method: 'GET',
    headers: {
      Authorization: authHeader(cfg),
      Accept: 'application/json',
    },
  })
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>
  return {
    retref: typeof json.retref === 'string' ? json.retref : retref,
    setlstat: typeof json.setlstat === 'string' ? json.setlstat : undefined,
    bankret: typeof json.bankret === 'string' ? json.bankret : undefined,
    resptext: typeof json.resptext === 'string' ? json.resptext : undefined,
    raw: json,
  }
}

/**
 * Void an authorized-but-not-settled transaction. Card pre-settlement
 * void. After settlement use refund instead (separate gateway call —
 * out of scope for Commit 1).
 */
export async function voidByRetref(retref: string): Promise<AuthResponse> {
  const cfg = readConfig()
  const res = await fetch(`${restBase(cfg)}/void`, {
    method: 'PUT',
    headers: {
      Authorization: authHeader(cfg),
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ merchid: cfg.mid, retref }),
  })
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>
  return {
    respcode: typeof json.respcode === 'string' ? json.respcode : '',
    resptext: typeof json.resptext === 'string' ? json.resptext : '',
    retref: typeof json.retref === 'string' ? json.retref : undefined,
    raw: json,
  }
}

/**
 * Refund a settled transaction (full or partial). Use AFTER settlement,
 * when a void no longer qualifies. `amountDollars` omitted → full refund
 * of the original; provided → partial. CardConnect returns a NEW retref
 * for the refund transaction.
 */
export async function refundByRetref(
  retref: string,
  amountDollars?: number,
): Promise<AuthResponse> {
  const cfg = readConfig()
  const payload: Record<string, unknown> = { merchid: cfg.mid, retref }
  if (typeof amountDollars === 'number' && amountDollars > 0) {
    payload.amount = amountDollars.toFixed(2)
  }
  const res = await fetch(`${restBase(cfg)}/refund`, {
    method: 'PUT',
    headers: {
      Authorization: authHeader(cfg),
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(payload),
  })
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>
  return {
    respcode: typeof json.respcode === 'string' ? json.respcode : '',
    resptext: typeof json.resptext === 'string' ? json.resptext : '',
    retref: typeof json.retref === 'string' ? json.retref : undefined,
    raw: json,
  }
}

export interface ReversalResult {
  ok: boolean
  /** How the money was returned: pre-settlement void or post-settlement
   *  refund. Null when neither succeeded. */
  kind: 'void' | 'refund' | null
  /** Gateway retref of the reversal transaction (refund mints a new one;
   *  void echoes the original). */
  retref?: string
  /** Human-readable gateway text for the failing path, for surfacing. */
  message: string
}

/**
 * Reverse a card charge without the caller needing to know whether it has
 * settled yet. Tries a VOID first (works pre-settlement, no fee); if the
 * gateway declines it (typically because the batch already settled),
 * falls back to a REFUND. Returns which path succeeded so the caller can
 * record it. NEVER assume success — check `.ok`.
 */
export async function reverseCardCharge(args: {
  retref: string
  amountDollars?: number
  /**
   * Set when reversing LESS than the full charge.
   *
   * A void is all-or-nothing: it annuls the whole authorization regardless of
   * any amount sent. So the void attempt MUST be skipped for a partial, or a
   * request to return $5 of a $9.27 charge would quietly return all $9.27 and
   * report success.
   *
   * A partial therefore requires settlement, since refund is the only
   * mechanism that can return part of a transaction. Before settlement the
   * gateway answers "txn not settled", which is the honest outcome.
   */
  partial?: boolean
}): Promise<ReversalResult> {
  // 1) Pre-settlement void — full reversals only.
  let voidErr = args.partial ? 'skipped: partial amount cannot be voided' : ''
  if (!args.partial) try {
    const v = await voidByRetref(args.retref)
    if (isApproved(v)) {
      return { ok: true, kind: 'void', retref: v.retref ?? args.retref, message: v.resptext }
    }
    voidErr = v.resptext || `void respcode ${v.respcode}`
  } catch (err) {
    voidErr = err instanceof Error ? err.message : 'void request failed'
  }

  // 2) Post-settlement refund fallback.
  try {
    const r = await refundByRetref(args.retref, args.amountDollars)
    if (isApproved(r)) {
      return { ok: true, kind: 'refund', retref: r.retref ?? args.retref, message: r.resptext }
    }
    return {
      ok: false,
      kind: null,
      message: `void failed (${voidErr}); refund failed (${r.resptext || r.respcode})`,
    }
  } catch (err) {
    const refundErr = err instanceof Error ? err.message : 'refund request failed'
    return { ok: false, kind: null, message: `void failed (${voidErr}); refund failed (${refundErr})` }
  }
}

// ─── Internal ───────────────────────────────────────────────────

async function postAuth(cfg: CardPointeConfig, body: AuthRequest): Promise<AuthResponse> {
  const payload = { merchid: cfg.mid, ...body }
  const res = await fetch(`${restBase(cfg)}/auth`, {
    method: 'PUT',
    headers: {
      Authorization: authHeader(cfg),
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(payload),
  })
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>
  return {
    // respstat is documented as the authoritative approval flag and the type
    // has always declared it, but this mapping never populated it — so every
    // caller silently fell through to the respcode fallback and every stored
    // respstat was null.
    respstat:
      json.respstat === 'A' || json.respstat === 'B' || json.respstat === 'C'
        ? json.respstat
        : undefined,
    respcode: typeof json.respcode === 'string' ? json.respcode : '',
    resptext: typeof json.resptext === 'string' ? json.resptext : '',
    retref: typeof json.retref === 'string' ? json.retref : undefined,
    authcode: typeof json.authcode === 'string' ? json.authcode : undefined,
    setlstat: typeof json.setlstat === 'string' ? json.setlstat : undefined,
    amount: typeof json.amount === 'string' ? json.amount : undefined,
    raw: json,
  }
}

/**
 * What the gateway ACTUALLY charged, and how much of it was surcharge.
 *
 * With the Merchant Surcharge Program enabled, SirReel does NOT compute the
 * fee — the gateway applies it, and waives it entirely when the cardholder is
 * ineligible (debit, prepaid, or a state that prohibits surcharging). So the
 * fee is only knowable from the response, never from our own arithmetic.
 *
 * Derived from the authorized amount rather than a named fee field: the
 * response's `amount` is unambiguous and stable, while the fee is reported
 * under several names across gateway versions (fee_amount, surchargeamount).
 * Those are read as a cross-check when present.
 *
 * Returns the base we sent when the gateway reports nothing, so a merchant
 * account with surcharging switched off records a clean zero fee.
 */
export function appliedAmounts(
  resp: AuthResponse,
  baseDollars: number,
): { total: number; surcharge: number } {
  const round = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100
  const base = round(baseDollars)

  const authorized = Number(resp.amount)
  if (Number.isFinite(authorized) && authorized > 0) {
    const total = round(authorized)
    // A gateway total BELOW the base would mean a partial authorization, not
    // a surcharge; clamp rather than record a negative fee.
    return { total, surcharge: Math.max(0, round(total - base)) }
  }

  const named = ['fee_amount', 'feeamount', 'surchargeamount', 'surcharge']
    .map((k) => Number(resp.raw?.[k]))
    .find((n) => Number.isFinite(n) && n > 0)
  if (named != null) return { total: round(base + named), surcharge: round(named) }

  return { total: base, surcharge: 0 }
}

/**
 * "00" is CardConnect's approved response code. Anything else is a
 * decline, error, or gateway issue — caller writes Payment.status
 * = FAILED and surfaces the resptext to the user.
 */
/**
 * Display-only card details recovered from a CardSecure token.
 *
 * LAST-4 is reliable: CardSecure tokens always end in the PAN's last four.
 *
 * CARD TYPE is best-effort and often null. Some tokens preserve the leading
 * BIN (37…1008 reads as Amex), but many are issued with a synthetic prefix —
 * commonly 9 — in which case the brand is simply not in the token. Returning
 * null there is deliberate: an absent brand is honest, a guessed one would be
 * wrong on a dispute, which is the one moment this field matters.
 *
 * Derived SERVER-side so the stored record can't be shaped by the browser and
 * is populated whichever surface took the payment. Keyed collections charges
 * previously recorded neither, leaving a disputed payment with nothing
 * identifying it.
 */
export function cardDisplayFromToken(token: string): {
  last4: string | null
  cardType: string | null
} {
  const tail = token.slice(-4)
  const last4 = /^\d{4}$/.test(tail) ? tail : null

  // Major Industry Identifier / IIN ranges. Amex is the two-digit case.
  const head = token.replace(/\D/g, '').slice(0, 2)
  let cardType: string | null = null
  if (head.startsWith('4')) cardType = 'VISA'
  else if (head === '34' || head === '37') cardType = 'AMEX'
  else if (head.startsWith('5')) cardType = 'MASTERCARD'
  else if (head.startsWith('6')) cardType = 'DISCOVER'
  else if (head.startsWith('3')) cardType = 'DINERS/JCB'

  return { last4, cardType }
}

export function isApproved(r: { respstat?: string; respcode?: string }): boolean {
  // respstat is definitive when present. respcode is a processor-specific
  // fallback — '00' and '000' are both seen for approvals.
  if (r.respstat) return r.respstat === 'A'
  return r.respcode === '00' || r.respcode === '000'
}
