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
 * Built on @react-pdf/renderer and the shared PDF_BRAND palette, same
 * as the quote and invoice documents, so a client who gets one
 * recognises the other.
 */

import React from 'react'
import { Document, Page, Text, View, Image, StyleSheet } from '@react-pdf/renderer'
import { PDF_BRAND } from '@/lib/pdf/brand'
import type { InspectionReport, ReportSide } from '@/lib/fleet/inspectionReport'

/** Photo bytes as data URIs, keyed by InspectionPhoto id. */
export type PhotoData = Record<string, string>

const s = StyleSheet.create({
  page: { paddingTop: 34, paddingBottom: 44, paddingHorizontal: 34, fontSize: 9, color: PDF_BRAND.ink, fontFamily: 'Helvetica' },
  title: { fontSize: 16, fontFamily: 'Helvetica-Bold', color: PDF_BRAND.accent },
  sub: { fontSize: 9, color: PDF_BRAND.muted, marginTop: 3 },
  band: { backgroundColor: PDF_BRAND.accentFill, borderBottomWidth: 1, borderBottomColor: PDF_BRAND.accentDeep, paddingVertical: 4, paddingHorizontal: 6, marginTop: 16, marginBottom: 8 },
  bandText: { fontFamily: 'Helvetica-Bold', fontSize: 10, color: PDF_BRAND.accentDeep },
  row: { flexDirection: 'row' },
  col: { flex: 1 },
  metaCell: { flex: 1, paddingRight: 8 },
  label: { fontSize: 7, color: PDF_BRAND.faint, textTransform: 'uppercase', letterSpacing: 0.4 },
  value: { fontSize: 10, marginTop: 1 },
  pair: { flexDirection: 'row', marginBottom: 10, alignItems: 'flex-start' },
  pairLabel: { width: 70, fontSize: 9, fontFamily: 'Helvetica-Bold', paddingTop: 20 },
  shot: { flex: 1, paddingHorizontal: 4 },
  shotCap: { fontSize: 7, color: PDF_BRAND.faint, marginBottom: 2 },
  img: { width: '100%', height: 96, objectFit: 'cover', borderWidth: 1, borderColor: PDF_BRAND.ruleSoft },
  missing: { width: '100%', height: 96, borderWidth: 1, borderStyle: 'dashed', borderColor: PDF_BRAND.rule, alignItems: 'center', justifyContent: 'center' },
  missingText: { fontSize: 8, color: PDF_BRAND.faint },
  dmg: { flexDirection: 'row', paddingVertical: 3, borderBottomWidth: 1, borderBottomColor: PDF_BRAND.ruleSoft },
  foot: { position: 'absolute', bottom: 22, left: 34, right: 34, fontSize: 7, color: PDF_BRAND.faint, textAlign: 'center' },
})

const fmt = (iso: string | null | undefined) =>
  iso ? `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC` : '—'

function Meta({ side, heading }: { side: ReportSide | null; heading: string }) {
  return (
    <View style={s.col}>
      <Text style={{ ...s.label, marginBottom: 3 }}>{heading}</Text>
      {side ? (
        <>
          <Text style={s.value}>{side.condition.charAt(0) + side.condition.slice(1).toLowerCase()}</Text>
          <Text style={{ fontSize: 8, color: PDF_BRAND.muted, marginTop: 2 }}>
            Fuel {side.fuelLevel ?? '—'} · {side.mileage != null ? `${side.mileage.toLocaleString()} mi` : 'no odometer'}
          </Text>
          <Text style={{ fontSize: 7, color: PDF_BRAND.faint, marginTop: 2 }}>{fmt(side.at)}</Text>
          {side.inspector && <Text style={{ fontSize: 7, color: PDF_BRAND.faint }}>{side.inspector}</Text>}
        </>
      ) : (
        <Text style={{ fontSize: 9, color: PDF_BRAND.faint }}>Not recorded</Text>
      )}
    </View>
  )
}

function Shot({ photo, data, caption }: { photo: { id: string; takenAt: string } | null; data: PhotoData; caption: string }) {
  const src = photo ? data[photo.id] : undefined
  return (
    <View style={s.shot}>
      <Text style={s.shotCap}>
        {caption}
        {photo ? ` · ${fmt(photo.takenAt)}` : ''}
      </Text>
      {src ? (
        // eslint-disable-next-line jsx-a11y/alt-text
        <Image style={s.img} src={src} />
      ) : (
        <View style={s.missing}>
          {/* Two different facts, and conflating them would be a lie in
              a document written to settle arguments: nobody shot this
              angle, versus somebody did and the file cannot be read. */}
          <Text style={s.missingText}>{photo ? 'Photo unavailable' : 'No photo taken'}</Text>
        </View>
      )}
    </View>
  )
}

export function ConditionReportDocument({
  report,
  photoData,
}: {
  report: InspectionReport
  photoData: PhotoData
}): React.ReactElement<DocumentPropsLike> {
  const extras = [
    ...report.damagePhotos.out.map((p) => ({ p, side: 'At check-out' })),
    ...report.damagePhotos.back.map((p) => ({ p, side: 'At check-in' })),
    ...report.unpositioned.out.map((p) => ({ p, side: 'At check-out' })),
    ...report.unpositioned.back.map((p) => ({ p, side: 'At check-in' })),
  ]

  return (
    <Document title={`Condition report — Unit ${report.unitName} — ${report.bookingNumber}`}>
      <Page size="LETTER" style={s.page} wrap>
        <Text style={s.title}>Vehicle condition report</Text>
        <Text style={s.sub}>
          Unit {report.unitName} · {report.category}
          {report.makeModel ? ` · ${report.makeModel}` : ''}
          {report.licensePlate ? ` · ${report.licensePlate}` : ''}
        </Text>
        <Text style={s.sub}>
          {report.jobName} — {report.company} · {report.bookingNumber} · {report.startDate} to {report.endDate}
        </Text>

        <View style={s.band}>
          <Text style={s.bandText}>Condition</Text>
        </View>
        <View style={s.row}>
          <Meta side={report.out} heading="Out" />
          <Meta side={report.back} heading="Back" />
          <View style={s.col}>
            <Text style={{ ...s.label, marginBottom: 3 }}>Driven</Text>
            <Text style={s.value}>
              {report.milesDriven != null ? `${report.milesDriven.toLocaleString()} mi` : '—'}
            </Text>
          </View>
        </View>

        <View style={s.band}>
          <Text style={s.bandText}>Walk-around — out vs back</Text>
        </View>
        {report.pairs.map((pair) => (
          <View key={pair.position} style={s.pair} wrap={false}>
            <Text style={s.pairLabel}>{pair.label}</Text>
            <Shot photo={pair.out} data={photoData} caption="Out" />
            <Shot photo={pair.back} data={photoData} caption="Back" />
          </View>
        ))}

        {extras.length > 0 && (
          <>
            <View style={s.band}>
              <Text style={s.bandText}>Close-ups and additional photos</Text>
            </View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
              {extras.map(({ p, side }) => (
                <View key={p.id} style={{ width: '33%', padding: 3 }} wrap={false}>
                  <Text style={s.shotCap}>
                    {side} · {fmt(p.takenAt)}
                  </Text>
                  {photoData[p.id] ? (
                    // eslint-disable-next-line jsx-a11y/alt-text
                    <Image style={{ ...s.img, height: 80 }} src={photoData[p.id]} />
                  ) : (
                    <View style={{ ...s.missing, height: 80 }}>
                      <Text style={s.missingText}>unavailable</Text>
                    </View>
                  )}
                </View>
              ))}
            </View>
          </>
        )}

        <View style={s.band}>
          <Text style={s.bandText}>Damage</Text>
        </View>
        {report.out?.damage.length === 0 && report.newDamage.length === 0 && (
          <Text style={{ fontSize: 9, color: PDF_BRAND.muted }}>
            No damage recorded at either end.
          </Text>
        )}
        {(report.out?.damage ?? []).map((d) => (
          <View key={d.id} style={s.dmg}>
            <Text style={{ width: 92, fontSize: 8, color: PDF_BRAND.muted }}>Already present</Text>
            <Text style={{ flex: 1, fontSize: 9 }}>
              {d.location} — {d.damageType.replace('_', ' ').toLowerCase()}, {d.severity.toLowerCase()}
              {d.notes ? ` (${d.notes})` : ''}
            </Text>
          </View>
        ))}
        {report.newDamage.map((d) => (
          <View key={d.id} style={s.dmg}>
            <Text style={{ width: 92, fontSize: 8, fontFamily: 'Helvetica-Bold' }}>New on return</Text>
            <Text style={{ flex: 1, fontSize: 9 }}>
              {d.location} — {d.damageType.replace('_', ' ').toLowerCase()}, {d.severity.toLowerCase()}
              {d.notes ? ` (${d.notes})` : ''}
            </Text>
          </View>
        ))}

        <Text style={s.foot} fixed>
          SirReel Production Vehicles · every photo carries the date and time it was taken.
        </Text>
      </Page>
    </Document>
  )
}

// @react-pdf's DocumentProps isn't exported in a form that composes
// cleanly here; the route only needs the element to be renderable.
type DocumentPropsLike = Record<string, unknown>
