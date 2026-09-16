/**
 * Why a partner unit is — or is not — actually on sirreel.com.
 *
 * `SUB_LISTED_WHERE` (site/vehicleCatalog.ts) is the gate the public
 * catalog queries through, and it tests SIX things. The roster page's
 * "Public catalog" switch only ever set ONE of them (`publiclyListed`) and
 * then told the user "Listed — anyone browsing sirreel.com can find it",
 * printing a sirreel.com/vehicles/<slug> link beside it. If the unit had no
 * photo, or the partner had not signed yet, that sentence was wrong and that
 * link 404'd — and nothing on the screen said which of the two it was. The
 * only warning was about a missing slug.
 *
 * That is a bad failure to have on this particular switch: the person
 * flipping it is publishing, they get a confident green state plus a URL,
 * and the URL is the only way to discover it did not work. Wes hit it going
 * to feature VSM Planet's first two units (2026-09-16).
 *
 * So the conditions are named here, ONCE, as data — each with what is
 * missing and what to do about it — and the card renders them. Pure: no
 * Prisma, so the test can hold it against SUB_LISTED_WHERE without a
 * database.
 *
 * KEEP IN LOCKSTEP WITH `SUB_LISTED_WHERE`. If a condition is added there
 * and not here, the card goes back to lying — quietly, in the confident
 * direction. `npm run test:public-listing` fails when the two lists differ
 * in length, which is the cheapest tripwire available for a rule that lives
 * in a Prisma where-clause.
 */

export type ListingBlockerCode =
  | 'not-listed'
  | 'no-slug'
  | 'no-photo'
  | 'no-signed-agreement'
  | 'not-offered'
  | 'inactive'
  | 'vendor-inactive'

export interface ListingBlocker {
  code: ListingBlockerCode
  /** What is missing, in the words of someone looking at this screen. */
  label: string
  /** The next action, naming where it happens. */
  fix: string
}

/** Everything `SUB_LISTED_WHERE` tests, flattened. */
export interface ListingFacts {
  offeredToSirReel: boolean
  isActive: boolean
  publiclyListed: boolean
  publicSlug: string | null
  /** SubcontractedVehiclePhoto rows on this unit. */
  photoCount: number
  vendorActive: boolean
  /** A VendorAgreement with `signedAt` set and `deletedAt` null. */
  vendorHasSignedAgreement: boolean
}

/**
 * Everything standing between this unit and the public catalog, in the
 * order someone would work through it. Empty = it is genuinely live.
 *
 * `not-listed` is included so one function answers both questions the card
 * asks ("is it live?" and "if I flip this, what else is missing?"); callers
 * previewing a flip filter it out.
 */
export function listingBlockers(f: ListingFacts): ListingBlocker[] {
  const out: ListingBlocker[] = []
  if (!f.publiclyListed) {
    out.push({
      code: 'not-listed',
      label: 'Not listed in the public catalog',
      fix: 'Turn on the Public catalog switch below.',
    })
  }
  if (f.publiclyListed && !f.publicSlug) {
    // The PATCH route derives a slug when listing without one, so this is
    // only reachable on a row listed before that existed.
    out.push({
      code: 'no-slug',
      label: 'No catalog URL',
      fix: 'Save the unit to generate one.',
    })
  }
  if (f.photoCount === 0) {
    out.push({
      code: 'no-photo',
      label: 'No photo',
      fix: 'Add one in Photos above, or ask the partner to upload from their account page.',
    })
  }
  if (!f.vendorHasSignedAgreement) {
    out.push({
      code: 'no-signed-agreement',
      label: 'The partner has not signed their agreement',
      fix: 'File and send the standard agreement from /crm/portals#partners.',
    })
  }
  if (!f.offeredToSirReel) {
    out.push({
      code: 'not-offered',
      label: 'The partner keeps this unit for their own bookings',
      fix: 'It is not ours to list. Nothing to do here.',
    })
  }
  if (!f.isActive) {
    out.push({
      code: 'inactive',
      label: 'This unit is retired',
      fix: 'Reactivate it before listing.',
    })
  }
  if (!f.vendorActive) {
    out.push({
      code: 'vendor-inactive',
      label: 'The partner is inactive',
      fix: 'Reactivate them on /crm/portals#partners.',
    })
  }
  return out
}

/** True only when the public catalog would really return this unit. */
export function isPubliclyLive(f: ListingFacts): boolean {
  return listingBlockers(f).length === 0
}

/**
 * What stands in the way BESIDES the switch itself — what the card warns
 * about while the switch is on, and previews while it is off.
 */
export function blockersBesidesListing(f: ListingFacts): ListingBlocker[] {
  return listingBlockers({ ...f, publiclyListed: true }).filter((b) => b.code !== 'not-listed')
}
