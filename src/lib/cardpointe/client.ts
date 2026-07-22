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
export function cardpointeBaseUrl(): string | null {
  const url = process.env[`${cardpointePrefix()}_URL`]
  return url && url.trim() ? url : null
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
  ecomind?: 'E' // ecommerce. Required field on most accounts.
  /** Operator-supplied invoice reference — shows on the merchant
   *  statement. We pass our Invoice number here. */
  orderid?: string
  name?: string
  /** ACH-only routing fields. */
  bankaba?: string // routing number
  bankaccttype?: 'C' | 'S' // Checking / Savings
}

export interface AuthResponse {
  /** Gateway response code. "00" = approved. Anything else is a
   *  decline or error and the caller should mark the payment FAILED. */
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
export async function chargeCard(args: {
  cardToken: string
  amountDollars: number
  invoiceNumber: string
  cardholderName?: string
}): Promise<AuthResponse> {
  const cfg = readConfig()
  const body: AuthRequest = {
    account: args.cardToken,
    amount: args.amountDollars.toFixed(2),
    currency: 'USD',
    capture: 'Y',
    ecomind: 'E',
    orderid: args.invoiceNumber,
    name: args.cardholderName,
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
}): Promise<ReversalResult> {
  // 1) Pre-settlement void.
  let voidErr = ''
  try {
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
    respcode: typeof json.respcode === 'string' ? json.respcode : '',
    resptext: typeof json.resptext === 'string' ? json.resptext : '',
    retref: typeof json.retref === 'string' ? json.retref : undefined,
    authcode: typeof json.authcode === 'string' ? json.authcode : undefined,
    setlstat: typeof json.setlstat === 'string' ? json.setlstat : undefined,
    raw: json,
  }
}

/**
 * "00" is CardConnect's approved response code. Anything else is a
 * decline, error, or gateway issue — caller writes Payment.status
 * = FAILED and surfaces the resptext to the user.
 */
export function isApproved(r: { respcode: string }): boolean {
  return r.respcode === '00'
}
