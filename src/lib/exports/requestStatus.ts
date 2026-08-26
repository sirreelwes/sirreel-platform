/**
 * Effective status of a DataExportRequest.
 *
 * EXPIRED is DERIVED, never stored: an approval simply stops being spendable
 * once `expiresAt` passes. Computing it on read means a request cannot sit in
 * a stale APPROVED state just because no cron job happened to run — the
 * download path and the UI reach the same verdict from the same function.
 */

import type { DataExportRequest, DataExportStatus } from '@prisma/client'

export type EffectiveStatus = DataExportStatus

type StatusInput = Pick<DataExportRequest, 'status' | 'expiresAt'>

export function effectiveStatus(
  r: StatusInput,
  now: Date = new Date(),
): EffectiveStatus {
  if (
    (r.status === 'APPROVED' || r.status === 'FULFILLED') &&
    r.expiresAt &&
    r.expiresAt.getTime() <= now.getTime()
  ) {
    return 'EXPIRED'
  }
  return r.status
}

/** Whether a CSV may still be served for this request. */
export function isDownloadable(r: StatusInput, now: Date = new Date()): boolean {
  const s = effectiveStatus(r, now)
  return s === 'APPROVED' || s === 'FULFILLED'
}
