/**
 * Thin wrapper around the Planyo REST endpoint. Handles pagination,
 * surfaces structured errors, and exposes the server-claimed total so the
 * caller can detect an incomplete pull.
 */

const BASE = 'https://www.planyo.com/rest/'

export interface PlanyoLine {
  reservation_id: string | number
  cart_id?: string | number
  name?: string
  resource_id?: string | number
  unit_assignment?: string
  start_time?: string
  end_time?: string
  status?: string | number
  first_name?: string
  last_name?: string
  email?: string
  phone?: string
  user_notes?: string
  admin_notes?: string
  /** Planyo system-rendered status message. Present on
   *  `get_reservation_data` responses, NOT on `list_reservations` at
   *  any detail level. Carries the current cancellation message for
   *  cancelled reservations. Use `isReservationCancelled(line)`. */
  user_text?: string
  /** Audit trail. `log_events[i].event === '2'` is HISTORICAL
   *  cancellation — a reservation can be reinstated and the '2' event
   *  stays in the log. Do NOT use as a current-state signal. */
  log_events?: Array<{
    admin_id?: string | number
    event?: string | number
    event_time?: string
    comment?: string | null
  }>
  quantity?: string | number
  properties?: Record<string, string | undefined>
}

export interface ListReservationsResult {
  ok: true
  results: PlanyoLine[]
  totalServer: number
}

export interface PlanyoPullError {
  ok: false
  reason: 'FAILED_PULL' | 'FAILED_INCOMPLETE' | 'FAILED_NETWORK'
  detail: string
}

const apiKey = () => process.env.PLANYO_API_KEY || ''
const siteId = () => process.env.PLANYO_SITE_ID || ''

async function call(method: string, params: Record<string, string>): Promise<unknown> {
  const u = new URL(BASE)
  u.searchParams.set('method', method)
  u.searchParams.set('api_key', apiKey())
  u.searchParams.set('site_id', siteId())
  u.searchParams.set('format', 'json')
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v)
  const r = await fetch(u.toString())
  return r.json()
}

const fmtPlanyo = (d: Date) => d.toISOString().slice(0, 10) + ' 00:00:00'

/**
 * Pull all reservation lines in [windowStart, windowEnd]. Paginates
 * through results until the server's claimed total is met. Returns ok:false
 * if anything is off — caller MUST abort and write no reconciliation rows.
 */
export async function listReservationsFull(opts: {
  windowStart: Date
  windowEnd: Date
  pageSize?: number
}): Promise<ListReservationsResult | PlanyoPullError> {
  const pageSize = opts.pageSize ?? 500
  const collected: PlanyoLine[] = []
  let page = 1
  let totalServer = 0

  while (true) {
    let raw: unknown
    try {
      raw = await call('list_reservations', {
        start_time: fmtPlanyo(opts.windowStart),
        end_time: fmtPlanyo(opts.windowEnd),
        results_per_page: String(pageSize),
        page_num: String(page),
        detail_level: '3',
      })
    } catch (e) {
      return { ok: false, reason: 'FAILED_NETWORK', detail: (e as Error).message }
    }
    const r = raw as { response_code?: number; response_message?: string; data?: { results?: PlanyoLine[]; total_count?: number } }
    if (r.response_code !== 0) {
      return { ok: false, reason: 'FAILED_PULL', detail: r.response_message ?? 'unknown' }
    }
    const results: PlanyoLine[] = r.data?.results ?? []
    const claimedTotal = Number(r.data?.total_count ?? results.length)
    if (page === 1) totalServer = claimedTotal
    collected.push(...results)
    if (results.length < pageSize) break
    if (collected.length >= totalServer) break
    page += 1
    if (page > 50) {
      return {
        ok: false,
        reason: 'FAILED_INCOMPLETE',
        detail: `pagination exceeded 50 pages (collected=${collected.length}, server claimed=${totalServer})`,
      }
    }
  }

  if (totalServer > 0 && collected.length < totalServer) {
    return {
      ok: false,
      reason: 'FAILED_INCOMPLETE',
      detail: `pagination ended early (collected=${collected.length}, server claimed=${totalServer})`,
    }
  }

  return { ok: true, results: collected, totalServer: totalServer || collected.length }
}

export interface ReservationDetail {
  ok: true
  data: PlanyoLine
}
export interface ReservationDetailError {
  ok: false
  detail: string
}

export async function getReservationData(
  reservationId: string | number,
): Promise<ReservationDetail | ReservationDetailError> {
  try {
    const raw = (await call('get_reservation_data', {
      reservation_id: String(reservationId),
    })) as { response_code?: number; response_message?: string; data?: PlanyoLine }
    if (raw.response_code !== 0) {
      return { ok: false, detail: raw.response_message ?? 'unknown' }
    }
    return { ok: true, data: raw.data ?? ({} as PlanyoLine) }
  } catch (e) {
    return { ok: false, detail: (e as Error).message }
  }
}
