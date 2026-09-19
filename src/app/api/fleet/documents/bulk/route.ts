/**
 * POST /api/fleet/documents/bulk — file a folder of DOT paperwork at once.
 *
 * Two passes over the SAME pure rules (lib/fleet/paperworkImport):
 *   plan   (JSON, filenames only) — propose a unit, a kind and a date per
 *          file. Writes nothing, and deliberately takes NO BYTES: the review
 *          table re-plans on every dropdown change, and shipping 60 scans up
 *          the wire each time someone corrects a row is the difference
 *          between a usable screen and one nobody waits for.
 *   commit (multipart)            — write the rows the operator confirmed.
 *
 * The plan pass is not advisory decoration: commit re-plans from the
 * operator's corrections and files ONLY rows that come back `ready`, so a
 * client whose page reads "Cube 27 · plate 8ABC123" cannot be looking at the
 * scan from Cargo 25 because a filename was odd. Anything unresolved is
 * reported back untouched for a person to fix.
 *
 * Registrations land in the Asset slot; BIT scans become BitInspection rows
 * and stamp the current-certificate pointer through the same rule the
 * single-file route uses (shouldStampCurrentBit) — so a folder containing
 * three years of certificates for one truck files all three and publishes the
 * newest, whatever order the files arrive in.
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireDispatchAccess } from '@/lib/fleet/requireDispatchAccess'
import { uploadPrivateImage } from '@/lib/blob/uploadPrivateImage'
import { shouldStampCurrentBit } from '@/lib/fleet/vehicleDocs'
import { planPaperworkImport, planSummary, type PlanInput } from '@/lib/fleet/paperworkImport'

export const dynamic = 'force-dynamic'

const MAX_BYTES = 25 * 1024 * 1024
/** A folder, not a migration. Keeps one request inside a lambda's lifetime. */
const MAX_FILES = 60

interface Correction {
  index: number
  unitId?: string | null
  kind?: string | null
  inspectionDate?: string | null
  expiresAt?: string | null
  /** Operator unticked it — leave this file alone. */
  skip?: boolean
}

/** What the plan pass needs to know about a file, without its bytes. */
interface NamedFile {
  filename: string
  isPdf: boolean
}

/** A review-table date, or null. The pure planner has already validated the
 *  shape; this is the last stop before a Date goes to the DB. */
function isoOrNull(iso: string | null): Date | null {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null
  const d = new Date(`${iso}T00:00:00.000Z`)
  return Number.isNaN(d.getTime()) ? null : d
}

export async function POST(req: NextRequest) {
  const auth = await requireDispatchAccess()
  if (!auth.ok) return auth.response

  const isMultipart = (req.headers.get('content-type') || '').includes('multipart/form-data')

  let mode = 'plan'
  let named: NamedFile[] = []
  let files: File[] = []
  let corrections: Correction[] = []

  if (isMultipart) {
    const form = await req.formData().catch(() => null)
    if (!form) return NextResponse.json({ error: 'could not read the upload' }, { status: 400 })
    mode = String(form.get('mode') ?? 'commit')
    files = form.getAll('files').filter((f): f is File => f instanceof File)
    named = files.map((f, i) => ({
      filename: f.name || `file-${i + 1}.pdf`,
      isPdf: f.type === 'application/pdf' || /\.pdf$/i.test(f.name || ''),
    }))
    const raw = form.get('corrections')
    if (typeof raw === 'string' && raw.trim()) {
      try {
        const parsed = JSON.parse(raw)
        if (Array.isArray(parsed)) corrections = parsed
      } catch {
        return NextResponse.json({ error: 'corrections must be JSON' }, { status: 400 })
      }
    }
  } else {
    const body = await req.json().catch(() => null)
    if (!body) return NextResponse.json({ error: 'JSON body required' }, { status: 400 })
    mode = 'plan'
    named = Array.isArray(body.files)
      ? body.files.map((f: { filename?: unknown; isPdf?: unknown }, i: number) => ({
          filename: String(f?.filename ?? `file-${i + 1}.pdf`),
          isPdf: f?.isPdf !== false,
        }))
      : []
    if (Array.isArray(body.corrections)) corrections = body.corrections
  }

  if (named.length === 0) return NextResponse.json({ error: 'no files' }, { status: 400 })
  if (named.length > MAX_FILES) {
    return NextResponse.json(
      { error: `${named.length} files at once; cap is ${MAX_FILES}. Drop them in batches.` },
      { status: 413 },
    )
  }
  const byIndex = new Map(corrections.map((c) => [c.index, c]))

  // Active VEHICLE units only — the same roster the Fleet page lists, so a
  // filename can never match a retired truck nobody expected to be a target.
  const units = await prisma.asset.findMany({
    where: { isActive: true, category: { department: 'VEHICLES' } },
    // categoryName only so the page can NAME the document it is about to
    // file — a passenger van's is a CHP BIT, a truck's the DOT annual.
    select: { id: true, unitName: true, category: { select: { name: true } } },
    orderBy: { unitName: 'asc' },
  })

  const inputs: PlanInput[] = named.map((f, i) => {
    const c = byIndex.get(i)
    return {
      filename: f.filename,
      isPdf: f.isPdf,
      unitId: c?.unitId ?? null,
      kind: c?.kind ?? null,
      inspectionDate: c?.inspectionDate ?? null,
      expiresAt: c?.expiresAt ?? null,
    }
  })
  const rows = planPaperworkImport(inputs, units)

  if (mode !== 'commit') {
    const unitList = units.map((u) => ({ id: u.id, unitName: u.unitName, categoryName: u.category?.name ?? null }))
    return NextResponse.json({ ok: true, mode: 'plan', summary: planSummary(rows), units: unitList, rows })
  }

  // ── commit ──────────────────────────────────────────────────────────────
  const filed: { index: number; filename: string; unitName: string; kind: string; isCurrent?: boolean; expiresAt?: string | null }[] = []
  const skipped: { index: number; filename: string; why: string }[] = []

  for (const row of rows) {
    if (byIndex.get(row.index)?.skip) {
      skipped.push({ index: row.index, filename: row.filename, why: 'skipped' })
      continue
    }
    if (!row.ready || !row.unitId || !row.kind) {
      skipped.push({ index: row.index, filename: row.filename, why: row.problems.join(', ') || 'not ready' })
      continue
    }

    const file = files[row.index]
    const buf = Buffer.from(await file.arrayBuffer())
    // Re-checked per file, not just by extension: the plan trusted the name.
    if (buf.subarray(0, 5).toString('latin1') !== '%PDF-' && file.type !== 'application/pdf') {
      skipped.push({ index: row.index, filename: row.filename, why: 'not a PDF' })
      continue
    }
    if (buf.length > MAX_BYTES) {
      skipped.push({ index: row.index, filename: row.filename, why: `over ${MAX_BYTES / 1024 / 1024} MB` })
      continue
    }

    try {
      if (row.kind === 'registration') {
        const { fileUrl } = await uploadPrivateImage({
          keyPrefix: 'vehicle-registrations',
          ownerId: row.unitId,
          filename: row.filename,
          contentType: 'application/pdf',
          data: buf,
        })
        await prisma.asset.update({
          where: { id: row.unitId },
          // The expiry is whatever the operator typed in the review table, or
          // null. It is never read off the filename — see PlannedRow.expiresAt
          // — so a folder imported without dates reads "on file · no expiry
          // recorded", which is true, and raises no renewal alert.
          data: { registrationUrl: fileUrl, registrationExpiresAt: isoOrNull(row.expiresAt) },
        })
        await prisma.auditLog.create({
          data: {
            userId: auth.userId,
            action: 'asset.registration_filed',
            entityType: 'Asset',
            entityId: row.unitId,
            newValues: { via: 'bulk', filename: row.filename },
          },
        }).catch(() => {})
      } else {
        const { fileUrl } = await uploadPrivateImage({
          keyPrefix: 'bit-inspections',
          ownerId: row.unitId,
          filename: row.filename,
          contentType: 'application/pdf',
          data: buf,
        })
        const inspectionDate = new Date(`${row.inspectionDate}T00:00:00.000Z`)
        const created = await prisma.bitInspection.create({
          data: { assetId: row.unitId, inspectionDate, pdfBlobKey: fileUrl, notes: null },
          select: { id: true },
        })
        const newestOther = await prisma.bitInspection.findFirst({
          where: { assetId: row.unitId, id: { not: created.id } },
          orderBy: { inspectionDate: 'desc' },
          select: { inspectionDate: true },
        })
        const isCurrent = shouldStampCurrentBit({
          newInspectionDate: inspectionDate,
          latestExistingDate: newestOther?.inspectionDate ?? null,
        })
        if (isCurrent) {
          await prisma.asset.update({
            where: { id: row.unitId },
            data: { bitCertificateUrl: fileUrl, bitCertificateExpiresAt: isoOrNull(row.expiresAt) },
          })
        }
        filed.push({
          index: row.index,
          filename: row.filename,
          unitName: row.unitName!,
          kind: row.kind,
          isCurrent,
          // A backfilled older certificate is filed to the history but is not
          // the current one, so its expiry is not the unit's expiry. Reported
          // so the screen can say the typed date was not kept.
          expiresAt: isCurrent ? row.expiresAt : null,
        })
        continue
      }
      filed.push({ index: row.index, filename: row.filename, unitName: row.unitName!, kind: row.kind, expiresAt: row.expiresAt })
    } catch (err) {
      console.error('[fleet bulk paperwork] failed on', row.filename, err)
      // One bad file must not lose the fifty that worked.
      skipped.push({ index: row.index, filename: row.filename, why: 'upload failed — retry this one' })
    }
  }

  return NextResponse.json({ ok: true, mode: 'commit', filedCount: filed.length, skippedCount: skipped.length, filed, skipped })
}
