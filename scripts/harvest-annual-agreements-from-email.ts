#!/usr/bin/env tsx
/**
 * Replace the imported RECORD PDFs with the executed originals, pulled out
 * of the Cognito notification emails.
 *
 * The 61 annual agreements were imported on 2026-09-02 with a RECORD PDF —
 * our canonical clause text plus that submission's values — because the
 * signed originals were only in Cognito. They are also in EMAIL: Cognito
 * notifies "Annual Rental Agreement | <Company>" with the executed PDF
 * attached (23 in hello@, 23 in jose@).
 *
 * ── Why this does not search client domains ────────────────────────
 *
 * The COI harvest searches the CLIENT's domain, and doing that here would be
 * a serious mistake. A client domain yields PER-JOB rental agreements —
 * "FOX Sports - USFL Opening Day Tease - RA.pdf" is one job's paperwork, not
 * Fox Sports' annual master. Filing it as the master would replace a
 * year-long agreement with a single job's contract.
 *
 * The Cognito notification is unambiguous: it exists once per submission and
 * names the company in its own subject.
 *
 * ── Matching is pinned to the SUBMISSION, not just the company ─────
 *
 * A company can have several annual agreements over the years (MT. VERNON
 * has two; Fox Sports three). The subject carries no date, so company name
 * alone could attach 2025's executed PDF to the 2026 master. The email's
 * DATE must therefore land near the agreement's effective date — that is
 * the submission date, so the notification is within a day or two of it.
 * Anything outside the window is reported, never guessed at.
 *
 * Usage:
 *   vercel env run -e production -- npx tsx scripts/harvest-annual-agreements-from-email.ts
 *   ... --write
 */
import fs from 'fs'
import path from 'path'
import { put } from '@vercel/blob'
import { prisma } from '../src/lib/prisma'
import {
  getGmailClientForInbox,
  fetchGmailMessageFull,
  downloadAndUploadAttachment,
} from '../src/lib/email/persistGmailAttachments'

const WRITE = process.argv.includes('--write')
const INBOXES = ['hello@sirreel.com', 'jose@sirreel.com', 'info@sirreel.com', 'wes@sirreel.com']

/** The notification lands within a couple of days of the submission. */
const DATE_WINDOW_DAYS = 4

function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/\b(inc|llc|ltd|co|corp|company|incorporated|the|pictures|productions?)\b/g, '')
    .replace(/d\/b\/a.*/, '')
    .replace(/[^a-z0-9]/g, '')
    .trim()
}

interface Found {
  gmailMessageId: string
  inbox: string
  cognitoCompany: string
  sentAt: Date
  filename: string
  attachmentId: string
  size: number
  mimeType: string
}

async function collect(): Promise<Found[]> {
  const out: Found[] = []
  const seenSubjectDate = new Set<string>()

  for (const inbox of INBOXES) {
    let gmail
    try {
      gmail = getGmailClientForInbox(inbox)
    } catch {
      continue
    }
    const q = 'from:notifications@cognitoforms.com subject:"Annual Rental Agreement" has:attachment'
    let ids: string[] = []
    try {
      const r = await gmail.users.messages.list({ userId: 'me', q, maxResults: 200 })
      ids = (r.data.messages ?? []).map((m) => m.id!)
    } catch (e) {
      console.warn(`  ${inbox}: search failed`)
      continue
    }

    for (const id of ids) {
      const msg = await fetchGmailMessageFull(inbox, id)
      if (!msg) continue
      const headers = (msg.payload as unknown as { headers?: { name?: string; value?: string }[] })?.headers
      const subject = headers?.find((h) => h.name?.toLowerCase() === 'subject')?.value ?? ''
      const dateHdr = headers?.find((h) => h.name?.toLowerCase() === 'date')?.value
      const sentAt = dateHdr ? new Date(dateHdr) : null
      if (!sentAt || Number.isNaN(sentAt.getTime())) continue

      // "Annual Rental Agreement | Echobend Pictures"
      const m = subject.match(/annual rental agreement\s*\|\s*(.+)$/i)
      if (!m) continue
      const cognitoCompany = m[1].trim()

      // The SAME notification is in several inboxes. Collapse on
      // company+date rather than message id, which differs per mailbox.
      const key = `${normalize(cognitoCompany)}|${sentAt.toISOString().slice(0, 10)}`
      if (seenSubjectDate.has(key)) continue

      const pdf = msg.attachments.find((a) => a.filename?.toLowerCase().endsWith('.pdf'))
      if (!pdf) continue
      seenSubjectDate.add(key)

      out.push({
        gmailMessageId: id,
        inbox,
        cognitoCompany,
        sentAt,
        filename: pdf.filename,
        attachmentId: pdf.attachmentId,
        size: pdf.size,
        mimeType: pdf.mimeType,
      })
    }
  }
  return out
}

async function main() {
  // The Cognito name each filed master came from, via its entry marker.
  const lines = fs.readFileSync('tmp/annual-agreements.tsv', 'utf8').split('\n').filter((l) => l.trim())
  const entryToName = new Map<string, string>()
  for (const line of lines.slice(1)) {
    const c = line.split('\t')
    entryToName.set(c[0]?.trim(), c[1]?.trim())
  }

  const masters = await prisma.companyAgreement.findMany({
    where: { autoCoverJobs: true, deletedAt: null },
    select: {
      id: true, note: true, effectiveDate: true, originalFilename: true,
      company: { select: { name: true } },
    },
  })
  const targets = masters.map((m) => {
    const entry = m.note?.match(/\[cognito-entry:(\d+)\]/)?.[1] ?? null
    return {
      id: m.id,
      company: m.company!.name,
      cognitoName: entry ? entryToName.get(entry) ?? null : null,
      effectiveDate: m.effectiveDate,
      // A record PDF is what the import filed; anything else was uploaded
      // by a human and must not be overwritten.
      isRecord: /record\.pdf$/i.test(m.originalFilename),
    }
  })

  console.log('Scanning Cognito notifications…')
  const found = await collect()
  console.log(`Distinct annual-agreement notifications with a PDF: ${found.length}\n`)

  const matched: { t: (typeof targets)[number]; f: Found }[] = []
  const noMatch: Found[] = []
  const outOfWindow: { t: (typeof targets)[number]; f: Found; days: number }[] = []

  for (const f of found) {
    const cands = targets.filter(
      (t) => t.cognitoName && normalize(t.cognitoName) === normalize(f.cognitoCompany),
    )
    if (cands.length === 0) {
      noMatch.push(f)
      continue
    }
    // Pin to the submission by date — a company can hold several years'
    // agreements and the subject carries no year.
    let best: { t: (typeof targets)[number]; days: number } | null = null
    for (const t of cands) {
      if (!t.effectiveDate) continue
      const days = Math.abs(t.effectiveDate.getTime() - f.sentAt.getTime()) / 86400000
      if (!best || days < best.days) best = { t, days }
    }
    if (!best) {
      noMatch.push(f)
    } else if (best.days > DATE_WINDOW_DAYS) {
      outOfWindow.push({ t: best.t, f, days: Math.round(best.days) })
    } else {
      matched.push({ t: best.t, f })
    }
  }

  console.log(`Matched to a filed master: ${matched.length}`)
  console.log(`Out of date window (likely a different year's submission): ${outOfWindow.length}`)
  console.log(`No filed master for that company: ${noMatch.length}\n`)

  for (const { t, f } of matched) {
    console.log(
      `  ${t.company.padEnd(34)} <- "${f.filename}" (${f.sentAt.toISOString().slice(0, 10)})${t.isRecord ? '' : '  [NOT a record PDF — will SKIP]'}`,
    )
  }
  if (outOfWindow.length) {
    console.log('\n  --- out of window (reported, not applied) ---')
    for (const o of outOfWindow) {
      console.log(`  ${o.t.company.padEnd(34)} email ${o.f.sentAt.toISOString().slice(0, 10)} vs agreement ${o.t.effectiveDate?.toISOString().slice(0, 10)} (${o.days}d apart)`)
    }
  }
  if (noMatch.length) {
    console.log('\n  --- no filed annual master (older client, or not imported) ---')
    for (const f of noMatch.slice(0, 25)) {
      console.log(`  ${f.cognitoCompany}  (${f.sentAt.toISOString().slice(0, 10)})`)
    }
    if (noMatch.length > 25) console.log(`  … and ${noMatch.length - 25} more`)
  }

  if (!WRITE) {
    console.log('\nDRY RUN — nothing written. Re-run with --write.\n')
    return
  }

  const journal: unknown[] = []
  for (const { t, f } of matched) {
    // Never overwrite a PDF a human uploaded. Only the import's own record
    // PDFs are stand-ins waiting to be replaced.
    if (!t.isRecord) {
      console.log(`  SKIP ${t.company} — its file is not an import record`)
      continue
    }

    let blobKey = ''
    const dl = await downloadAndUploadAttachment({
      inbox: f.inbox,
      gmailMessageId: f.gmailMessageId,
      attachment: {
        filename: f.filename,
        mimeType: f.mimeType,
        attachmentId: f.attachmentId,
        size: f.size,
      },
      buildBlobKey: (att) => {
        blobKey = `company-agreements/executed/${t.id}-${att.filename.replace(/[^A-Za-z0-9._-]+/g, '_')}`
        return blobKey
      },
      put: (key, data, opts) => put(key, data, opts as never) as Promise<{ url: string }>,
    })
    if (!dl) {
      console.log(`  download failed: ${t.company}`)
      continue
    }

    const before = await prisma.companyAgreement.findUnique({
      where: { id: t.id },
      select: { fileKey: true, fileUrl: true, originalFilename: true, fileSize: true, note: true },
    })

    await prisma.companyAgreement.update({
      where: { id: t.id },
      data: {
        fileKey: blobKey,
        fileUrl: dl.fileUrl,
        originalFilename: f.filename,
        fileSize: dl.bytes,
        note:
          `${before?.note ?? ''} Executed original attached ${new Date().toISOString().slice(0, 10)} ` +
          `from the Cognito notification email of ${f.sentAt.toISOString().slice(0, 10)} ` +
          `(${f.inbox}, gmail ${f.gmailMessageId}); replaces the generated record PDF.`.trim(),
      },
    })
    // The superseded record blob is intentionally NOT deleted — same rule as
    // every other agreement write here: clear is not retract, and an audit
    // trail pointing at a deleted blob is worse than an orphan.
    journal.push({
      companyAgreementId: t.id,
      company: t.company,
      newFileKey: blobKey,
      replacedFileKey: before?.fileKey,
      replacedFilename: before?.originalFilename,
      gmailMessageId: f.gmailMessageId,
      inbox: f.inbox,
    })
    console.log(`  ATTACHED ${t.company} <- ${f.filename}`)
  }

  const out = path.join(process.cwd(), `journals/annual-ra-originals-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
  fs.writeFileSync(out, JSON.stringify(journal, null, 2))
  console.log(`\nAttached ${journal.length} executed originals.`)
  console.log(`Journal (each row keeps the replaced key, so it is reversible): ${out}\n`)
}

main().finally(() => prisma.$disconnect())
