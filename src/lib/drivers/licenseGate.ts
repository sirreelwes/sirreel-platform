/**
 * The licence gate — may this driver take a vehicle?
 *
 * Applied HARD at physical checkout (the moment a truck actually leaves
 * with someone). Dispatch assignment is planning that happens hours or
 * days earlier and is deliberately NOT blocked: blocking the plan just
 * pushes people to assign a placeholder, and the handover is where the
 * real control belongs.
 *
 * "Checked" means a SirReel staff member opened the licence images and
 * accepted them (Driver.licenseVerified). It does NOT mean a DMV
 * confirmed anything — see src/lib/drivers/readLicense.ts. So this gate
 * enforces "we looked at a licence that hasn't expired", which is the
 * strongest claim the data supports.
 */

export type LicenseGateCode = 'OK' | 'NO_LICENSE' | 'EXPIRED' | 'NOT_CHECKED'

export interface LicenseGateInput {
  licenseFrontUrl?: string | null
  licenseBackUrl?: string | null
  licenseExpired?: boolean | null
  licenseVerified?: boolean | null
  licenseExpiry?: Date | string | null
}

export interface LicenseGateResult {
  ok: boolean
  code: LicenseGateCode
  /** Written for a rep at the counter, not for a log file. */
  message: string
}

/**
 * Recompute expiry from the stored date rather than trusting the boolean
 * captured at upload — a licence that was current in March is not current
 * in December, and nothing re-runs the extraction in between.
 */
function expiredNow(input: LicenseGateInput, now: Date): boolean {
  if (input.licenseExpiry) {
    const d = new Date(input.licenseExpiry)
    if (!Number.isNaN(d.getTime())) {
      // Date-only value stored at UTC midnight; good through that day.
      return d.getTime() + 24 * 60 * 60 * 1000 - 1 < now.getTime()
    }
  }
  return input.licenseExpired === true
}

export function evaluateLicenseGate(
  driver: LicenseGateInput | null | undefined,
  now: Date = new Date(),
): LicenseGateResult {
  if (!driver) {
    return { ok: false, code: 'NO_LICENSE', message: 'No driver on this checkout.' }
  }
  if (!driver.licenseFrontUrl && !driver.licenseBackUrl) {
    return {
      ok: false,
      code: 'NO_LICENSE',
      message: 'No license on file. Send this driver a portal link, or photograph their license at the counter.',
    }
  }
  if (expiredNow(driver, now)) {
    return {
      ok: false,
      code: 'EXPIRED',
      message: 'This license has expired. It cannot be accepted for a vehicle handover.',
    }
  }
  if (!driver.licenseVerified) {
    return {
      ok: false,
      code: 'NOT_CHECKED',
      message: 'License is on file but nobody has checked it yet. Open the images and mark it checked first.',
    }
  }
  return { ok: true, code: 'OK', message: 'License on file and checked.' }
}
