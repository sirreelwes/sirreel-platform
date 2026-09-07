/**
 * The condition report PDF — check-out and check-in, side by side.
 *
 * This is the artifact DamageID emails the renter, rebuilt in HQ
 * (Wes, 2026-09-02: "emulate that"). Its whole job is to make one
 * comparison unarguable: here is the panel when you took it, here is
 * the same panel when you brought it back, both time stamped.
 *
 * So the layout is pairs, not galleries. Every required slot prints
 * even when a photo is missing, because "no rear shot was taken on the
 * way out" is information the reader needs — a gallery that silently
 * omits it reads as complete when it isn't.
 *
 * Built on @react-pdf/renderer and the shared PDF_BRAND palette, with
 * the same top band (logo · title · number), info card and footer as
 * the quote and invoice, so a client who gets one recognises the other.
 *
 * 2026-09-07 redesign (Wes: "make this look better"):
 *   - photos print upright and un-cropped — `objectFit: contain` in a
 *     fixed frame, on bytes that lib/fleet/reportPhoto has already
 *     rotated and downscaled. The old `cover` crop threw away the
 *     edges of the panel, which is exactly where the dents are.
 *   - every time stamp is Pacific, the yard's clock, not UTC.
 *   - the check-out and check-in notes print. They were collected on
 *     both forms and shown nowhere in the document.
 *   - a "not checked in yet" report says so once, in the Back column,
 *     rather than printing seven "no photo taken" frames that read as
 *     a tech who skipped the walk-around.
 */

import React from 'react'
import fs from 'fs'
import path from 'path'
import { Document, Page, Text, View, Image, StyleSheet } from '@react-pdf/renderer'
import { PDF_BRAND as C } from '@/lib/pdf/brand'
import { REQUIRED_POSITIONS } from '@/lib/fleet/photoPositions'
import type { InspectionReport, ReportSide, ReportPhoto } from '@/lib/fleet/inspectionReport'

// Hyphenation policy is registered ONCE in lib/pdf/hyphenation (a global,
// last-registration-wins setting) — see that module. Do not register here.
import '@/lib/pdf/hyphenation'

/** Prepared JPEG bytes keyed by InspectionPhoto id — see reportPhoto. */
export type PhotoData = Record<string, Buffer>

// Same logo, loaded the same way, as the quote and invoice documents:
// the raw Buffer straight into <Image>, no network hop on Vercel.
const LOGO_PATH = path.join(process.cwd(), 'public', 'sirreel-logo.png')
let LOGO_BUFFER: Buffer | null = null
try {
  LOGO_BUFFER = fs.readFileSync(LOGO_PATH)
} catch (err) {
  console.warn('[ConditionReportDocument] failed to load sirreel-logo.png, falling back to text brand:', err)
}

// ── Geometry ─────────────────────────────────────────────────────────
// LETTER is 612 pt wide; 36 pt margins leave 540. The walk-around row
// is a 72 pt angle label plus two frames with a gutter between them.
const CONTENT_W = 540
const PAIR_LABEL_W = 72
const PAIR_GUTTER = 10
const SHOT_W = (CONTENT_W - PAIR_LABEL_W - PAIR_GUTTER) / 2 // 229
const SHOT_H = 140 // 229×140: four pairs to a page; a 4:3 phone shot prints 187 wide, a portrait one sits centred.
const EXTRA_COLS = 3
const EXTRA_GAP = 8
const EXTRA_W = (CONTENT_W - EXTRA_GAP * (EXTRA_COLS - 1)) / EXTRA_COLS
const EXTRA_H = 128

const s = StyleSheet.create({
  page: {
    paddingTop: 30,
    paddingBottom: 44,
    paddingHorizontal: 36,
    fontFamily: 'Helvetica',
    fontSize: 9,
    lineHeight: 1.35,
    color: C.ink,
  },

  // Top band — brand left, title centre, document number right.
  topBand: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 },
  brand: { flexDirection: 'column' },
  brandLogo: { width: 140, height: 'auto', marginBottom: 6 },
  brandName: { fontFamily: 'Helvetica-Bold', fontSize: 20, letterSpacing: 0.5 },
  brandSub: { fontSize: 8, color: C.muted, marginTop: 3 },
  brandAddress: { fontSize: 8, color: C.muted, marginTop: 1 },
  titleColumn: { flex: 1, alignItems: 'center', paddingTop: 2 },
  docTitle: { fontFamily: 'Helvetica-Bold', fontSize: 18, lineHeight: 1.1, letterSpacing: 1.6, color: C.accent, textAlign: 'center' },
  docTitleSub: { fontSize: 8, lineHeight: 1.2, color: C.muted, marginTop: 5, letterSpacing: 0.4, textTransform: 'uppercase' },
  meta: { flexDirection: 'column', alignItems: 'flex-end' },
  metaNum: {
    fontFamily: 'Helvetica-Bold',
    fontSize: 12,
    color: C.accent,
    backgroundColor: C.accentFill,
    borderWidth: 0.5,
    borderColor: C.accentEdge,
    borderRadius: 2,
    paddingVertical: 2,
    paddingHorizontal: 7,
  },
  metaLine: { fontSize: 9, color: C.muted, marginTop: 2 },
  hrThick: { borderBottomWidth: 1.5, borderBottomColor: C.accentDeep, marginTop: 5, marginBottom: 9 },

  // Info card — one bordered container, sections split by hairlines.
  infoCard: {
    flexDirection: 'row',
    borderWidth: 0.5,
    borderColor: C.accentEdge,
    borderRadius: 3,
    backgroundColor: C.accentFillSoft,
    marginBottom: 10,
  },
  infoSection: { padding: 6 },
  infoDivider: { borderLeftWidth: 0.5, borderLeftColor: C.accentEdge },
  infoTitle: {
    fontFamily: 'Helvetica-Bold',
    fontSize: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    color: C.accent,
    marginBottom: 4,
  },
  infoLine: { flexDirection: 'row', marginBottom: 1.5 },
  infoLabel: { width: '38%', fontSize: 9, color: C.muted },
  infoValue: { width: '62%', fontSize: 9 },

  // Section bands.
  band: {
    backgroundColor: C.accentFill,
    borderBottomWidth: 1,
    borderBottomColor: C.accentDeep,
    paddingVertical: 4,
    paddingHorizontal: 6,
    marginTop: 12,
    marginBottom: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
  },
  bandText: { fontFamily: 'Helvetica-Bold', fontSize: 10, color: C.accentDeep },
  bandNote: { fontSize: 8, color: C.muted },

  // Condition cards — Out and Back side by side, Driven between.
  condRow: { flexDirection: 'row', alignItems: 'stretch' },
  condCard: {
    flex: 1,
    borderWidth: 0.5,
    borderColor: C.rule,
    borderRadius: 3,
    padding: 8,
  },
  condCardMissing: {
    flex: 1,
    borderWidth: 0.75,
    borderStyle: 'dashed',
    borderColor: C.rule,
    borderRadius: 3,
    padding: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  condHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 },
  condTag: {
    fontFamily: 'Helvetica-Bold',
    fontSize: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    color: C.accent,
  },
  condWhen: { fontSize: 8, color: C.muted },
  condValue: { fontFamily: 'Helvetica-Bold', fontSize: 15, marginBottom: 4 },
  condLine: { flexDirection: 'row', marginBottom: 1.5 },
  condLabel: { width: 54, fontSize: 8.5, color: C.muted },
  condData: { flex: 1, fontSize: 8.5 },
  drivenCard: {
    width: 92,
    marginHorizontal: 8,
    borderWidth: 0.5,
    borderColor: C.accentEdge,
    borderRadius: 3,
    backgroundColor: C.accentFillSoft,
    padding: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  drivenValue: { fontFamily: 'Helvetica-Bold', fontSize: 15, color: C.accentDeep },
  drivenLabel: { fontSize: 7.5, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.6, marginTop: 2 },
  notesBlock: { marginTop: 6, paddingTop: 6, borderTopWidth: 0.5, borderTopColor: C.ruleSoft },
  notesLabel: { fontSize: 7.5, color: C.faint, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 1 },
  notesText: { fontSize: 8.5, color: C.ink },

  // Walk-around pairs.
  pairHead: {
    flexDirection: 'row',
    paddingBottom: 3,
    marginBottom: 6,
    borderBottomWidth: 0.5,
    borderBottomColor: C.rule,
  },
  pairHeadLabel: { width: PAIR_LABEL_W, fontSize: 7.5, color: C.faint, textTransform: 'uppercase', letterSpacing: 0.6 },
  pairHeadCol: { width: SHOT_W, fontSize: 7.5, color: C.accent, fontFamily: 'Helvetica-Bold', textTransform: 'uppercase', letterSpacing: 0.6 },
  pair: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 8 },
  pairLabelCol: { width: PAIR_LABEL_W, paddingRight: 8, paddingTop: 2 },
  pairLabel: { fontFamily: 'Helvetica-Bold', fontSize: 10 },
  pairHint: { fontSize: 7, color: C.faint, marginTop: 2, lineHeight: 1.25 },
  shot: { width: SHOT_W },
  frame: {
    width: SHOT_W,
    height: SHOT_H,
    backgroundColor: C.photoWell,
    borderWidth: 0.5,
    borderColor: C.rule,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  img: { width: '100%', height: '100%', objectFit: 'contain' },
  frameEmpty: {
    width: SHOT_W,
    height: SHOT_H,
    borderWidth: 0.75,
    borderStyle: 'dashed',
    borderColor: C.rule,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: { fontSize: 8, color: C.faint, textAlign: 'center' },
  shotCap: { fontSize: 7.5, color: C.muted, marginTop: 3 },

  // Close-ups grid.
  extras: { flexDirection: 'row', flexWrap: 'wrap', marginLeft: -EXTRA_GAP / 2, marginRight: -EXTRA_GAP / 2 },
  extra: { width: EXTRA_W, marginHorizontal: EXTRA_GAP / 2, marginBottom: 8 },
  extraFrame: {
    width: EXTRA_W,
    height: EXTRA_H,
    backgroundColor: C.photoWell,
    borderWidth: 0.5,
    borderColor: C.rule,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  extraEmpty: {
    width: EXTRA_W,
    height: EXTRA_H,
    borderWidth: 0.75,
    borderStyle: 'dashed',
    borderColor: C.rule,
    alignItems: 'center',
    justifyContent: 'center',
  },
  extraSide: { fontFamily: 'Helvetica-Bold', fontSize: 7.5, color: C.accentDeep },

  // Damage table.
  tHead: {
    flexDirection: 'row',
    backgroundColor: C.accentFillSoft,
    borderBottomWidth: 0.5,
    borderBottomColor: C.accentEdge,
    paddingVertical: 3,
    paddingHorizontal: 5,
  },
  tHeadText: { fontSize: 7.5, color: C.accent, fontFamily: 'Helvetica-Bold', textTransform: 'uppercase', letterSpacing: 0.5 },
  tRow: { flexDirection: 'row', paddingVertical: 3.5, paddingHorizontal: 5, borderBottomWidth: 0.5, borderBottomColor: C.ruleSoft },
  tRowNew: { backgroundColor: C.warnFill },
  cWhen: { width: 88 },
  cWhere: { flex: 1.3 },
  cType: { width: 78 },
  cSev: { width: 58 },
  cNotes: { flex: 1.7, color: C.muted },
  tCell: { fontSize: 8.5 },
  tagNew: { fontFamily: 'Helvetica-Bold', color: C.amber },
  tagPrior: { color: C.muted },
  empty: { fontSize: 9, color: C.muted, paddingVertical: 2 },

  // Footer. Anchored from the TOP of the page on purpose: with a
  // `lineHeight` on the page style, @react-pdf 4.5 drops a fixed
  // element positioned with `bottom` — it is laid out, then never
  // drawn on any page (verified in isolation, 2026-09-07; the same
  // combination is in the quote and invoice documents). LETTER is
  // 792 pt tall; 756 leaves one 7 pt line above a 22 pt margin.
  footer: {
    position: 'absolute',
    top: 756,
    left: 36,
    right: 36,
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTopWidth: 0.5,
    borderTopColor: C.ruleSoft,
    paddingTop: 5,
    fontSize: 7,
    color: C.faint,
  },
})

// ── Formatting ───────────────────────────────────────────────────────
// The yard's clock is Pacific. A renter reading "02:49 UTC" against a
// pickup that happened at dinner time is the argument the report is
// supposed to prevent.

const PT_DATE = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Los_Angeles',
  month: 'short',
  day: 'numeric',
  year: 'numeric',
})
const PT_TIME = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Los_Angeles',
  hour: 'numeric',
  minute: '2-digit',
})

function fmtWhen(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return `${PT_DATE.format(d)} · ${PT_TIME.format(d)} PT`
}

/** Short form for photo captions: "Sep 6 · 7:49 PM". */
function fmtShort(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const day = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', month: 'short', day: 'numeric' }).format(d)
  return `${day} · ${PT_TIME.format(d)}`
}

/** Booking dates are calendar days (YYYY-MM-DD) — format in UTC so the
 *  day never slips (see hq-white-label/dates). */
function fmtDay(ymd: string, withYear: boolean): string {
  const d = new Date(`${ymd}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) return ymd
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(withYear ? { year: 'numeric' } : {}), timeZone: 'UTC' })
}

function fmtRange(start: string, end: string): string {
  if (start === end) return fmtDay(start, true)
  const sameYear = start.slice(0, 4) === end.slice(0, 4)
  return `${fmtDay(start, !sameYear)} – ${fmtDay(end, true)}`
}

const titleCase = (v: string) => v.charAt(0) + v.slice(1).toLowerCase().replace(/_/g, ' ')

const fmtFuel = (v: string | null) => (v ? v.charAt(0).toUpperCase() + v.slice(1) : '—')

// ── Pieces ───────────────────────────────────────────────────────────

function ConditionCard({ side, tag }: { side: ReportSide | null; tag: 'Out' | 'Back' }) {
  if (!side) {
    return (
      <View style={s.condCardMissing}>
        <Text style={s.condTag}>{tag}</Text>
        <Text style={{ fontSize: 9, color: C.faint, marginTop: 4 }}>
          {tag === 'Back' ? 'Not checked in yet' : 'No check-out recorded'}
        </Text>
      </View>
    )
  }
  return (
    <View style={s.condCard}>
      <View style={s.condHead}>
        <Text style={s.condTag}>{tag === 'Out' ? 'Out · check-out' : 'Back · check-in'}</Text>
        <Text style={s.condWhen}>{fmtWhen(side.at)}</Text>
      </View>
      {/* Facts, not a verdict. The forms stopped asking for a one-word
          condition on 2026-09-07 (Wes) — the stored enum is derived from
          the damage list, so the headline IS the damage list. */}
      <Text style={s.condValue}>
        {side.damage.length === 0
          ? 'No damage logged'
          : `${side.damage.length} damage item${side.damage.length === 1 ? '' : 's'}`}
      </Text>
      <View style={s.condLine}>
        <Text style={s.condLabel}>Fuel</Text>
        <Text style={s.condData}>{fmtFuel(side.fuelLevel)}</Text>
      </View>
      <View style={s.condLine}>
        <Text style={s.condLabel}>Odometer</Text>
        <Text style={s.condData}>{side.mileage != null ? `${side.mileage.toLocaleString()} mi` : 'not read'}</Text>
      </View>
      <View style={s.condLine}>
        <Text style={s.condLabel}>Recorded by</Text>
        <Text style={s.condData}>{side.inspector ?? 'fleet'}</Text>
      </View>
      <View style={s.condLine}>
        <Text style={s.condLabel}>Photos</Text>
        <Text style={s.condData}>{side.photos.length}</Text>
      </View>
      {side.notes ? (
        <View style={s.notesBlock}>
          <Text style={s.notesLabel}>Notes</Text>
          <Text style={s.notesText}>{side.notes}</Text>
        </View>
      ) : null}
    </View>
  )
}

/**
 * Why a frame is empty matters, so the three reasons print differently:
 * nobody has done this end yet, somebody did but skipped this angle, or
 * the shot exists and the file could not be printed.
 */
function emptyReason(photo: ReportPhoto | null, sideExists: boolean, tag: 'Out' | 'Back'): string {
  if (photo) return 'Photo on file — could not be printed'
  if (!sideExists) return tag === 'Back' ? 'Not checked in yet' : 'No check-out recorded'
  return 'No photo taken'
}

function Shot({
  photo,
  data,
  sideExists,
  tag,
}: {
  photo: ReportPhoto | null
  data: PhotoData
  sideExists: boolean
  tag: 'Out' | 'Back'
}) {
  const src = photo ? data[photo.id] : undefined
  return (
    <View style={s.shot}>
      {src ? (
        <View style={s.frame}>
          {/* eslint-disable-next-line jsx-a11y/alt-text */}
          <Image style={s.img} src={src} />
        </View>
      ) : (
        <View style={s.frameEmpty}>
          <Text style={s.emptyText}>{emptyReason(photo, sideExists, tag)}</Text>
        </View>
      )}
      <Text style={s.shotCap}>{photo ? `${tag} · ${fmtShort(photo.takenAt)}` : ' '}</Text>
    </View>
  )
}

type DamageRowData = ReportSide['damage'][number] & { isNew: boolean }

function DamageRow({ d }: { d: DamageRowData }) {
  return (
    <View style={d.isNew ? [s.tRow, s.tRowNew] : s.tRow} wrap={false}>
      <Text style={[s.tCell, s.cWhen, d.isNew ? s.tagNew : s.tagPrior]}>
        {d.isNew ? 'New on return' : 'Already present'}
      </Text>
      <Text style={[s.tCell, s.cWhere]}>{d.location}</Text>
      <Text style={[s.tCell, s.cType]}>{titleCase(d.damageType)}</Text>
      <Text style={[s.tCell, s.cSev]}>{titleCase(d.severity)}</Text>
      <Text style={[s.tCell, s.cNotes]}>{d.notes ?? ''}</Text>
    </View>
  )
}

// ── Document ─────────────────────────────────────────────────────────

export function ConditionReportDocument({
  report,
  photoData,
  generatedAt = new Date(),
}: {
  report: InspectionReport
  photoData: PhotoData
  /** Injectable so the snapshot test renders the same bytes twice. */
  generatedAt?: Date
}): React.ReactElement<DocumentPropsLike> {
  const hints = new Map(REQUIRED_POSITIONS.map((p) => [p.id, p.hint]))
  const extras = [
    ...report.damagePhotos.out.map((p) => ({ p, side: 'Out', kind: 'Damage close-up' })),
    ...report.damagePhotos.back.map((p) => ({ p, side: 'Back', kind: 'Damage close-up' })),
    ...report.unpositioned.out.map((p) => ({ p, side: 'Out', kind: 'Additional' })),
    ...report.unpositioned.back.map((p) => ({ p, side: 'Back', kind: 'Additional' })),
  ]
  const damageRows: DamageRowData[] = [
    ...report.newDamage.map((d) => ({ ...d, isNew: true })),
    ...(report.out?.damage ?? []).map((d) => ({ ...d, isNew: false })),
  ]
  const hasOut = !!report.out
  const hasBack = !!report.back
  const vehicleLine = [report.makeModel, report.licensePlate].filter(Boolean).join(' · ')

  return (
    <Document
      title={`Condition report — Unit ${report.unitName} — ${report.bookingNumber}`}
      author="SirReel Studio Services"
      subject={`${report.jobName} · ${report.bookingNumber}`}
    >
      <Page size="LETTER" style={s.page} wrap>
        {/* Top band */}
        <View style={s.topBand}>
          <View style={s.brand}>
            {LOGO_BUFFER ? (
              <Image src={LOGO_BUFFER} style={s.brandLogo} />
            ) : (
              <Text style={s.brandName}>SirReel</Text>
            )}
            <Text style={s.brandSub}>Production Vehicles, Inc.</Text>
            <Text style={s.brandAddress}>8500 Lankershim Blvd</Text>
            <Text style={s.brandAddress}>Sun Valley, CA 91352</Text>
            <Text style={s.brandAddress}>(888) 477-7335</Text>
          </View>
          <View style={s.titleColumn}>
            <Text style={s.docTitle}>CONDITION REPORT</Text>
            <Text style={s.docTitleSub}>Check-out vs check-in</Text>
          </View>
          <View style={s.meta}>
            <Text style={s.metaNum}>Unit {report.unitName}</Text>
            <Text style={s.metaLine}>Booking {report.bookingNumber}</Text>
            <Text style={s.metaLine}>Generated {fmtWhen(generatedAt.toISOString())}</Text>
          </View>
        </View>
        <View style={s.hrThick} />

        {/* Info card: vehicle · production · rental period */}
        <View style={s.infoCard}>
          <View style={[s.infoSection, { width: '34%' }]}>
            <Text style={s.infoTitle}>Vehicle</Text>
            <View style={s.infoLine}>
              <Text style={s.infoLabel}>Unit</Text>
              <Text style={s.infoValue}>{report.unitName}</Text>
            </View>
            <View style={s.infoLine}>
              <Text style={s.infoLabel}>Type</Text>
              <Text style={s.infoValue}>{report.category}</Text>
            </View>
            {vehicleLine ? (
              <View style={s.infoLine}>
                <Text style={s.infoLabel}>Make / plate</Text>
                <Text style={s.infoValue}>{vehicleLine}</Text>
              </View>
            ) : null}
          </View>
          <View style={[s.infoSection, s.infoDivider, { width: '40%' }]}>
            <Text style={s.infoTitle}>Production</Text>
            <View style={s.infoLine}>
              <Text style={s.infoLabel}>Job</Text>
              <Text style={s.infoValue}>{report.jobName}</Text>
            </View>
            <View style={s.infoLine}>
              <Text style={s.infoLabel}>Company</Text>
              <Text style={s.infoValue}>{report.company}</Text>
            </View>
            <View style={s.infoLine}>
              <Text style={s.infoLabel}>Booking</Text>
              <Text style={s.infoValue}>{report.bookingNumber}</Text>
            </View>
          </View>
          <View style={[s.infoSection, s.infoDivider, { width: '26%' }]}>
            <Text style={s.infoTitle}>Rental period</Text>
            <View style={s.infoLine}>
              <Text style={s.infoLabel}>Out</Text>
              <Text style={s.infoValue}>{fmtDay(report.startDate, true)}</Text>
            </View>
            <View style={s.infoLine}>
              <Text style={s.infoLabel}>Back</Text>
              <Text style={s.infoValue}>{fmtDay(report.endDate, true)}</Text>
            </View>
          </View>
        </View>

        {/* Condition */}
        <View style={s.band}>
          <Text style={s.bandText}>Condition</Text>
          <Text style={s.bandNote}>{fmtRange(report.startDate, report.endDate)}</Text>
        </View>
        <View style={s.condRow}>
          <ConditionCard side={report.out} tag="Out" />
          <View style={s.drivenCard}>
            <Text style={s.drivenValue}>
              {report.milesDriven != null ? report.milesDriven.toLocaleString() : '—'}
            </Text>
            <Text style={s.drivenLabel}>{report.milesDriven != null ? 'miles driven' : 'miles'}</Text>
          </View>
          <ConditionCard side={report.back} tag="Back" />
        </View>

        {/* Damage — the verdict, before the evidence. New-on-return rows
            first, tinted; what was already there follows as the record
            that it was. */}
        <View wrap={false}>
          <View style={s.band}>
            <Text style={s.bandText}>Damage</Text>
            <Text style={s.bandNote}>
              {report.newDamage.length === 0
                ? hasBack
                  ? 'Nothing new on return'
                  : 'Return not yet inspected'
                : `${report.newDamage.length} new on return`}
            </Text>
          </View>
          {damageRows.length === 0 ? (
            <Text style={s.empty}>
              {hasBack
                ? 'No damage recorded at either end.'
                : 'No pre-existing damage recorded at check-out.'}
            </Text>
          ) : (
            <>
              <View style={s.tHead}>
                <Text style={[s.tHeadText, s.cWhen]}>When</Text>
                <Text style={[s.tHeadText, s.cWhere]}>Where</Text>
                <Text style={[s.tHeadText, s.cType]}>Type</Text>
                <Text style={[s.tHeadText, s.cSev]}>Severity</Text>
                <Text style={[s.tHeadText, s.cNotes]}>Notes</Text>
              </View>
              <DamageRow d={damageRows[0]} />
            </>
          )}
        </View>
        {damageRows.slice(1).map((d) => (
          <DamageRow key={d.id} d={d} />
        ))}

        {/* Walk-around. The band, the column header and the first pair
            are one unbreakable block: a section header stranded at the
            foot of a page, with its photos overleaf, is the one thing a
            reader flipping to "show me the rear" should never meet. */}
        {report.pairs.map((pair, i) => {
          const row = (
            <View key={pair.position} style={s.pair} wrap={false}>
              <View style={s.pairLabelCol}>
                <Text style={s.pairLabel}>{pair.label}</Text>
                <Text style={s.pairHint}>{hints.get(pair.position) ?? ''}</Text>
              </View>
              <Shot photo={pair.out} data={photoData} sideExists={hasOut} tag="Out" />
              <View style={{ width: PAIR_GUTTER }} />
              <Shot photo={pair.back} data={photoData} sideExists={hasBack} tag="Back" />
            </View>
          )
          if (i > 0) return row
          return (
            <View key="walk-around-head" wrap={false}>
              <View style={s.band}>
                <Text style={s.bandText}>Walk-around — the same angles, both directions</Text>
                <Text style={s.bandNote}>Photos are shown whole, never cropped</Text>
              </View>
              <View style={s.pairHead}>
                <Text style={s.pairHeadLabel}>Angle</Text>
                <Text style={s.pairHeadCol}>Out · {report.out ? fmtShort(report.out.at) : '—'}</Text>
                <View style={{ width: PAIR_GUTTER }} />
                <Text style={s.pairHeadCol}>Back · {report.back ? fmtShort(report.back.at) : 'not yet'}</Text>
              </View>
              {row}
            </View>
          )
        })}

        {/* Close-ups */}
        {extras.length > 0 && (
          <>
            <View style={s.band} minPresenceAhead={EXTRA_H + 24}>
              <Text style={s.bandText}>Close-ups and additional photos</Text>
              <Text style={s.bandNote}>
                {extras.length} photo{extras.length === 1 ? '' : 's'}
              </Text>
            </View>
            <View style={s.extras}>
              {extras.map(({ p, side, kind }) => (
                <View key={p.id} style={s.extra} wrap={false}>
                  {photoData[p.id] ? (
                    <View style={s.extraFrame}>
                      {/* eslint-disable-next-line jsx-a11y/alt-text */}
                      <Image style={s.img} src={photoData[p.id]} />
                    </View>
                  ) : (
                    <View style={s.extraEmpty}>
                      <Text style={s.emptyText}>Photo on file — could not be printed</Text>
                    </View>
                  )}
                  <Text style={s.shotCap}>
                    <Text style={s.extraSide}>{side}</Text>
                    {` · ${kind} · ${fmtShort(p.takenAt)}`}
                  </Text>
                </View>
              ))}
            </View>
          </>
        )}

        {/* Footer */}
        <View style={s.footer} fixed>
          <Text>SirReel Studio Services · every photo carries the date and time it was taken (Pacific)</Text>
          <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  )
}

// @react-pdf's DocumentProps isn't exported in a form that composes
// cleanly here; the route only needs the element to be renderable.
type DocumentPropsLike = Record<string, unknown>
