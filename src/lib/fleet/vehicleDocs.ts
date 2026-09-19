/**
 * The two client-facing DOT documents that hang off an Asset: the vehicle
 * REGISTRATION and the current BIT CERTIFICATE.
 *
 * Phase 1 (2026-09) built `BitInspection` — the dated, PDF-backed BIT history
 * — and Phase 2 built the generated DOT info sheet. What neither built was a
 * way to PUT a registration or a certificate on a unit: nothing in the app
 * has ever written `Asset.registrationUrl` or `Asset.bitCertificateUrl`. The
 * portal has rendered "Registration · Not yet on file" on every job we have
 * ever sent, because the only writer was a hand edit nobody made.
 *
 * TWO COLUMNS, ONE BLOB — the BIT certificate is a POINTER, not a copy.
 * `Asset.bitCertificateUrl` is documented in schema.prisma as "a current-cert
 * pointer the alert cron reads", and that is exactly how it is maintained
 * here: uploading a BIT inspection stamps the pointer at THAT inspection's
 * blob. There is deliberately no second upload box for it. Two upload paths
 * would mean two PDFs for one physical certificate, and then the portal and
 * the DOT sheet could name different BIT dates for the same truck with
 * nothing to say which was right — the same "two rows for one object" failure
 * the radio-battery pool avoids.
 *
 * The registration has no history model, so it IS a slot: upload replaces.
 *
 * Both URLs are PRIVATE blobs (`uploadPrivateImage`) that 403 on a direct
 * fetch, so neither may be handed to a browser. Staff read them through
 * /api/fleet/[id]/documents/[kind]; clients through
 * /api/portal/job/vehicle-doc, which is why `portalDocHref` below is the only
 * way the portal payload is allowed to name one.
 */

/** 30 days — the same horizon the fleet-expirations cron alerts on. */
export const DOC_EXPIRY_HORIZON_DAYS = 30

export type VehicleDocKind = 'registration' | 'bit-certificate'

export const VEHICLE_DOC_KINDS: readonly VehicleDocKind[] = ['registration', 'bit-certificate']

// ── Which inspection a class actually carries ─────────────────────────────

/**
 * WHICH document this is depends on the VEHICLE, not on the slot it is filed
 * in. Julian, 2026-09-18: the trucks carry a federal DOT ANNUAL inspection
 * (49 CFR 396.17) and the passenger vans a CHP BIT (Biennial Inspection of
 * Terminals — CVC 34501, which reaches anything built to carry 10+
 * passengers, i.e. our 12- and 15-seat vans).
 *
 * That day the label swung from "BIT" on the whole fleet to "DOT inspection"
 * on the whole fleet, because "BIT" was wrong on the cubes and the umbrella
 * is at least true of both. The file header's own note said a per-class
 * label "would need a mapping for every category on the roster, which nobody
 * has given us." Wes, 2026-09-19, gave us the half that matters: "where is
 * the BIT Inspections? For pass vans that is what is needed." A van's
 * certificate says BIT across the top, Julian files it under BIT and the CHP
 * asks for it by that name, so a screen that will only say "DOT inspection"
 * is a screen he cannot find it on.
 *
 * So: NAME the regime we were told about, and keep the umbrella everywhere
 * else. This is a TABLE, not an inference — the same posture as
 * SANDBAGS_BY_SIZE. A class nobody has ruled on reads "DOT inspection",
 * which is correct-but-vague, rather than a guess that is confidently wrong
 * on a document somebody has to hand to an inspector.
 *
 * DELIBERATELY NOT CLASSIFIED: ProScout / VTR (the LCDW note calls it a
 * "VTR/PeopleMover" van, so it may well be a BIT vehicle — but "may well be"
 * is not a ruling, and a wrong BIT label is worse than a vague right one).
 * Add a pattern here the day Julian says so.
 */
export type InspectionRegime = 'bit' | 'dot'

/**
 * Matched against `AssetCategory.name`. A regex rather than an exact-name set
 * on purpose: this family has already been renamed once — "Passenger Van"
 * split into "12-Passenger Van" and "15-Passenger Van" on 2026-09-09 — and
 * an exact list would have silently gone back to saying DOT that afternoon.
 * "passenger" is the discriminator; no other vehicle class on the roster
 * carries the word (Cargo Van, PopVan, Camera Cube, Stakebed, DLUX...).
 */
const BIT_CLASS_PATTERNS: readonly RegExp[] = [/\bpassenger\b/i]

/** Which inspection a class carries. An unknown class gets the umbrella. */
export function inspectionRegimeForClass(categoryName?: string | null): InspectionRegime {
  const name = String(categoryName ?? '')
  return BIT_CLASS_PATTERNS.some((re) => re.test(name)) ? 'bit' : 'dot'
}

/** The words on screen for each regime, and the short form for a chip. */
export const INSPECTION_LABEL: Record<InspectionRegime, string> = {
  bit: 'BIT inspection',
  dot: 'DOT inspection',
}
export const INSPECTION_SHORT_LABEL: Record<InspectionRegime, string> = {
  bit: 'BIT',
  dot: 'DOT',
}

/**
 * What people CALL these documents when the vehicle's class is NOT known.
 * The kind key stays `bit-certificate` — it is a wire value in URLs and half
 * a column name. Prefer `vehicleDocLabel(kind, categoryName)`; this map is
 * the fallback it reads, so the two can never disagree.
 */
export const VEHICLE_DOC_LABEL: Record<VehicleDocKind, string> = {
  registration: 'Registration',
  'bit-certificate': INSPECTION_LABEL.dot,
}

/** The label for a document ON A PARTICULAR UNIT — "BIT inspection" on a van. */
export function vehicleDocLabel(kind: VehicleDocKind, categoryName?: string | null): string {
  if (kind === 'registration') return VEHICLE_DOC_LABEL.registration
  return INSPECTION_LABEL[inspectionRegimeForClass(categoryName)]
}

/** The same, short enough for a chip in a fleet row — "Reg" / "BIT" / "DOT". */
export function vehicleDocShortLabel(kind: VehicleDocKind, categoryName?: string | null): string {
  if (kind === 'registration') return 'Reg'
  return INSPECTION_SHORT_LABEL[inspectionRegimeForClass(categoryName)]
}

/** Narrow a path segment / query value to a kind, or null. Never throws. */
export function parseVehicleDocKind(raw: unknown): VehicleDocKind | null {
  const s = String(raw ?? '').trim().toLowerCase()
  return (VEHICLE_DOC_KINDS as readonly string[]).includes(s) ? (s as VehicleDocKind) : null
}

/**
 * Only the registration is UPLOADED to its slot. The BIT certificate pointer
 * is stamped from the BIT-inspection history (see the file header), so a POST
 * aimed at it is refused with somewhere to go rather than quietly creating
 * the second copy.
 */
export function isUploadableKind(kind: VehicleDocKind): kind is 'registration' {
  return kind === 'registration'
}

// ── Expiry ────────────────────────────────────────────────────────────────

export type DocExpiryState = 'missing' | 'no-expiry' | 'ok' | 'expiring' | 'expired'

/**
 * One reading of a document slot, shared by the fleet row, the fleet modal
 * and the portal. `expiring` matches the cron's 30-day horizon so a unit
 * never wears an amber chip on a day no alert was raised, or the reverse.
 */
export function docExpiryState(
  args: { hasFile: boolean; expiresAt: Date | string | null | undefined },
  now: Date = new Date(),
): DocExpiryState {
  if (!args.hasFile) return 'missing'
  if (!args.expiresAt) return 'no-expiry'
  const at = args.expiresAt instanceof Date ? args.expiresAt : new Date(args.expiresAt)
  if (Number.isNaN(at.getTime())) return 'no-expiry'
  const ms = at.getTime() - now.getTime()
  if (ms <= 0) return 'expired'
  return ms < DOC_EXPIRY_HORIZON_DAYS * 86_400_000 ? 'expiring' : 'ok'
}

/**
 * Does a newly filed BIT inspection become the unit's CURRENT certificate?
 *
 * Only when nothing is on file yet, or it is dated on/after the newest one
 * already filed. Backfilling last cycle's certificate is a normal thing to do
 * and must not drag the pointer — and the client-facing surfaces read the
 * pointer, so getting this backwards publishes a stale certificate.
 *
 * Ties go to the new row: re-uploading a better scan of the same day's
 * inspection is a correction, and the correction is what should be served.
 */
export function shouldStampCurrentBit(args: {
  newInspectionDate: Date
  latestExistingDate: Date | null | undefined
}): boolean {
  if (!args.latestExistingDate) return true
  return args.newInspectionDate.getTime() >= args.latestExistingDate.getTime()
}

// ── Who may read a unit's documents on the portal ─────────────────────────

/**
 * Narrow a booking's vehicle assignments to the ones that belong to THIS
 * order. Lifted verbatim out of /api/portal/job/data so the document proxy
 * cannot answer a question the page would have answered differently — the
 * proxy takes an assetId straight off the query string, so "which units is
 * this session allowed to see" is now a security check, not just a display
 * filter.
 *
 * `BookingAssignment.orderId` is the precise link but is only stamped from
 * the day assignUnit started writing it (460 of 555 live rows carry none), so
 * the rule is: prefer the units stamped to this order, and fall back to the
 * UNSTAMPED ones. A truck stamped to a SIBLING order is excluded either way —
 * that was the leak fixed on 2026-09-15 (Wrong Number, SR-JOB-0273).
 */
export function narrowAssignmentsToOrder<T extends { orderId: string | null }>(
  rows: readonly T[],
  ownOrderIds: readonly (string | null | undefined)[],
): T[] {
  const own = new Set(ownOrderIds.filter((v): v is string => !!v))
  const mine = rows.filter((r) => r.orderId && own.has(r.orderId))
  return mine.length > 0 ? mine : rows.filter((r) => r.orderId === null)
}

/**
 * The client-facing href for a unit's document. The portal payload must never
 * carry `Asset.registrationUrl` / `bitCertificateUrl` themselves — those are
 * private-blob URLs that 403 in a browser, which is how they would have
 * shipped the moment someone filled the columns in.
 */
export function portalDocHref(assetId: string, kind: VehicleDocKind): string {
  return `/api/portal/job/vehicle-doc?assetId=${encodeURIComponent(assetId)}&kind=${kind}`
}

/**
 * Filename a downloaded copy lands under — unit first, so a folder sorts.
 * `categoryName` is optional and only changes the inspection's word, so a
 * van's certificate saves as `Pass-3_BIT-inspection_...` — which is what it
 * says across the top and how Julian's folder is already organised. Omitted,
 * it keeps the umbrella, so no existing caller changes.
 */
export function vehicleDocFilename(args: {
  unitName: string
  kind: VehicleDocKind
  expiresAt?: Date | string | null
  categoryName?: string | null
}): string {
  const slug = (s: string) => s.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'unit'
  const kindPart =
    args.kind === 'registration'
      ? 'registration'
      : `${INSPECTION_SHORT_LABEL[inspectionRegimeForClass(args.categoryName)]}-inspection`
  const at = args.expiresAt ? new Date(args.expiresAt) : null
  const exp = at && !Number.isNaN(at.getTime()) ? `_exp-${at.toISOString().slice(0, 10)}` : ''
  return `${slug(args.unitName)}_${kindPart}${exp}.pdf`
}
