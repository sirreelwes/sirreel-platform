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
  /**
   * EXPIRED on a date nobody has confirmed. The block still stands — a
   * genuinely expired card must not walk out on a maybe — but the SCREEN
   * must not call it expired, and the way out is fixing the date rather
   * than chasing the driver for a licence they already hold.
   */
  unconfirmedDate?: boolean
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
      // Staff never hand their phone to the driver (Wes 2026-09-16): the
      // driver hands over their license and fleet photographs it.
      message: 'No license on file. Ask the driver for their license and take the photo yourself.',
    }
  }
  if (expiredNow(driver, now)) {
    // Where the expiry came from decides the WORDING, never the block.
    // Until a human has looked at the images, the date is one read of a
    // phone photo — and a card shot at an angle, on top of paperwork,
    // gets misread (2026-09-16: a CDL good to 2029 read as Feb 2025 and
    // the driver was refused). Staff sign-off is what turns the read
    // into a fact.
    if (!driver.licenseVerified) {
      return {
        ok: false,
        code: 'EXPIRED',
        unconfirmedDate: true,
        message:
          'The date we read off this license has already passed — but nobody has checked it yet. ' +
          'Open the images: if the printed expiry is different, fix the date on the driver, then mark it checked.',
      }
    }
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

/**
 * The licence chip, one definition for every screen that shows one —
 * the roster, the job page, the Gantt driver strip. Surfaces still own
 * the states that OUTRANK the licence (picked up, invited, nothing
 * uploaded); this decides only what the licence itself says.
 *
 * "Check date" rather than "Expired" for an unconfirmed read is the
 * whole point: the chip must not accuse a current licence of being
 * expired on the strength of an OCR pass nobody has looked at.
 */
export type LicenseBadgeTone = 'expired' | 'attention' | 'ok'

export interface LicenseBadge {
  tone: LicenseBadgeTone
  label: string
}

export const LICENSE_BADGE_CLASS: Record<LicenseBadgeTone, string> = {
  expired: 'bg-rose-100 text-rose-700',
  attention: 'bg-amber-100 text-amber-700',
  ok: 'bg-emerald-100 text-emerald-700',
}

export function licenseBadge(
  driver: LicenseGateInput,
  now: Date = new Date(),
): LicenseBadge {
  if (expiredNow(driver, now)) {
    return driver.licenseVerified
      ? { tone: 'expired', label: 'Expired' }
      : { tone: 'attention', label: 'Check date' }
  }
  return driver.licenseVerified
    ? { tone: 'ok', label: 'Checked' }
    : { tone: 'attention', label: 'Needs check' }
}
