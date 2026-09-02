#!/usr/bin/env tsx
/**
 * Find clients' certificates of insurance in synced email and file them at
 * the COMPANY, so an annual account's COI carries forward to every job.
 *
 * Wes, 2026-09-02: "I'll have to seek out all the COIs from email." He does
 * not have to. HQ already syncs 84,649 messages across 11 inboxes, and the
 * certificates are sitting in them as attachments.
 *
 * ── Why the obvious approach fails ─────────────────────────────────
 *
 * Searching SUBJECT lines for "COI" found candidates for 5 of 62 annual
 * accounts. Certificates arrive as attachments on threads titled anything at
 * all — measured 2026-09-02, FIGS' certificate came in on "Re: 7/31 FIGS BCA
 * SHOOT DELIVERY" as "SirReel Studio Rentals.pdf". Subject is the wrong
 * signal; the attachment is the signal.
 *
 * So this asks Gmail the question directly, per client domain:
 *     from:<domain> has:attachment filename:pdf
 * and narrows with insurance vocabulary, which Gmail matches against PDF
 * CONTENT as well as filenames.
 *
 * ── What decides whether a PDF is a certificate ────────────────────
 *
 * Not the filename. That same FIGS thread also carried gear lists and
 * receipts, and Live Nation's PDF was a lookbook. The classifier is the
 * EXISTING COI AI review (src/lib/coi/reviewCoi.ts): it reads the document
 * and reports the named insured, expiry and limits — or reports nothing,
 * which is how we know it was never a certificate.
 *
 * ── What this never does ───────────────────────────────────────────
 *
 * APPROVE anything. Every certificate lands humanDecision=PENDING for the
 * review desk at /admin/cois. Carry-forward requires APPROVED, so nothing
 * reaches a job until a person says so. An automated harvest that also
 * approved its own findings would put "insured" on jobs on the strength of a
 * filename search.
 *
 * Idempotent on the Gmail attachment: a certificate already filed from the
 * same message+filename is skipped, so re-running adds only what is new.
 *
 * Usage:
 *   vercel env run -e production -- npx tsx scripts/harvest-cois-from-email.ts
 *   vercel env run -e production -- npx tsx scripts/harvest-cois-from-email.ts --write
 *   ... --company "Fox Sports"     limit to one account
 *   ... --limit 5                  cap accounts processed (dry runs)
 */
import fs from 'fs'
import path from 'path'
import { put } from '@vercel/blob'
import { prisma } from '../src/lib/prisma'
import {
  getGmailClientForInbox,
  fetchGmailMessageFull,
  downloadAndUploadAttachment,
  type GmailAttachmentMeta,
} from '../src/lib/email/persistGmailAttachments'
import { runCoiAiReview } from '../src/lib/coi/reviewCoi'
import { coiCheckWriteFields } from '../src/lib/coi/checks'

const WRITE = process.argv.includes('--write')
const ONLY_COMPANY = argValue('--company')
const LIMIT = Number(argValue('--limit') || '0')

function argValue(flag: string): string | null {
  const i = process.argv.indexOf(flag)
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : null
}

/** Inboxes that actually carry client traffic, busiest first. */
const INBOXES = [
  'jose@sirreel.com',
  'oliver@sirreel.com',
  'hello@sirreel.com',
  'info@sirreel.com',
  'billing@sirreel.com',
  'wes@sirreel.com',
]

const FREEMAIL = new Set([
  'gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'icloud.com',
  'aol.com', 'me.com', 'msn.com', 'comcast.net',
])

/**
 * Insurance vocabulary. Gmail matches these against extracted PDF text as
 * well as filenames, which is what makes "SirReel Studio Rentals.pdf"
 * findable — the certificate names us as the holder inside the document.
 */
const INSURANCE_TERMS =
  '(certificate OR insurance OR COI OR ACORD OR liability OR insured OR policy)'

function domainOf(email: string | null | undefined): string | null {
  const m = (email || '').trim().toLowerCase().match(/@([^\s>@]+)$/)
  return m ? m[1] : null
}

/** Obvious non-certificates, skipped before we pay for an AI read. */
const OBVIOUS_NON_COI =
  /(receipt|invoice|quote|estimate|lookbook|deck|menu|call\s*sheet|schedule|signature|w-?9|rental\s*agreement|cc\s*auth|authorization)/i

/**
 * OUR OWN documents, bounced back on a reply.
 *
 * The dry run surfaced "0 - King Kong - #setlife sample COI copy.pdf" and
 * "1 KING KONG & #setlife COI Sample certificate.pdf" as candidates on
 * SETLIFE's thread. Those are the SAMPLE certificates SirReel sends clients
 * to show them what we need — they quote back on the reply chain, and they
 * parse as perfectly valid certificates because they are.
 *
 * Filing one as a client's own COI would put "insured" on that account on
 * the strength of a document we wrote, insuring somebody else. The
 * named-insured check would probably catch it later; not filing it is
 * better than relying on that.
 */
const OUR_OWN_DOCUMENT = /(sample|example|template|blank|king\s*kong|kkpv)/i

interface Candidate {
  inbox: string
  gmailMessageId: string
  subject: string
  attachment: GmailAttachmentMeta
}

async function candidatesForDomain(domain: string): Promise<Candidate[]> {
  const out: Candidate[] = []
  const seen = new Set<string>()

  for (const inbox of INBOXES) {
    let gmail
    try {
      gmail = getGmailClientForInbox(inbox)
    } catch {
      continue
    }
    const q = `from:${domain} has:attachment filename:pdf ${INSURANCE_TERMS}`
    let ids: string[] = []
    try {
      const res = await gmail.users.messages.list({ userId: 'me', q, maxResults: 25 })
      ids = (res.data.messages ?? []).map((m) => m.id!).filter(Boolean)
    } catch (e) {
      console.warn(`    ${inbox}: search failed — ${(e as Error).message.split('\n')[0].slice(0, 70)}`)
      continue
    }

    for (const id of ids) {
      if (seen.has(id)) continue
      seen.add(id)
      const msg = await fetchGmailMessageFull(inbox, id)
      if (!msg) continue
      const headers = (msg.payload as unknown as { headers?: { name?: string; value?: string }[] })
        ?.headers
      const subject =
        headers?.find((h) => h.name?.toLowerCase() === 'subject')?.value ?? ''
      for (const att of msg.attachments) {
        if (!att.filename?.toLowerCase().endsWith('.pdf')) continue
        if (OBVIOUS_NON_COI.test(att.filename)) continue
        if (OUR_OWN_DOCUMENT.test(att.filename)) continue
        out.push({ inbox, gmailMessageId: id, subject, attachment: att })
      }
    }
  }
  return out
}

async function main() {
  // Domains come from the COGNITO submissions — the Company table's own
  // website/billingEmail columns are empty across the book, which is the
  // dead end recorded in the CRM outreach work. Different inputs here.
  const lines = fs.readFileSync('tmp/annual-agreements.tsv', 'utf8').split('\n').filter((l) => l.trim())
  const now = Date.now()
  const cognito = new Map<string, Set<string>>()
  for (const line of lines.slice(1)) {
    const c = line.split('\t')
    const m = c[13]?.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/)
    if (!m || Date.UTC(+m[3], +m[1] - 1, +m[2]) < now) continue
    const set = cognito.get(c[1]?.trim()) ?? new Set<string>()
    for (const e of [c[10], c[17]]) {
      const d = domainOf(e)
      if (d && !FREEMAIL.has(d)) set.add(d)
    }
    cognito.set(c[1]?.trim(), set)
  }

  // Only accounts already filed as auto-covering annuals — this exists to
  // give those accounts a certificate, not to trawl the whole book.
  const masters = await prisma.companyAgreement.findMany({
    where: { autoCoverJobs: true, deletedAt: null },
    select: { companyId: true, note: true, company: { select: { id: true, name: true } } },
  })

  // Map each filed master back to the Cognito name it came from, via the
  // entry marker in its note — the alias joins live there, so this does not
  // have to re-guess them.
  const entryToCognitoName = new Map<string, string>()
  for (const line of lines.slice(1)) {
    const c = line.split('\t')
    entryToCognitoName.set(c[0]?.trim(), c[1]?.trim())
  }

  let targets = masters
    .map((m) => {
      const entry = m.note?.match(/\[cognito-entry:(\d+)\]/)?.[1]
      const cognitoName = entry ? entryToCognitoName.get(entry) : undefined
      const domains = cognitoName ? [...(cognito.get(cognitoName) ?? [])] : []
      return { companyId: m.companyId, name: m.company!.name, cognitoName, domains }
    })
    .filter((t) => t.domains.length > 0)

  if (ONLY_COMPANY) {
    targets = targets.filter((t) => t.name.toLowerCase().includes(ONLY_COMPANY.toLowerCase()))
  }
  if (LIMIT > 0) targets = targets.slice(0, LIMIT)

  console.log(`Annual accounts with a searchable domain: ${targets.length}`)
  console.log(WRITE ? 'MODE: WRITE\n' : 'MODE: DRY RUN — nothing written\n')

  const filed: unknown[] = []
  let scanned = 0
  let notCerts = 0
  let dupes = 0
  let expiredFound = 0

  for (const t of targets) {
    // Already holding a live approved certificate? Then there is nothing to
    // find — skip before spending a Gmail search on it.
    const live = await prisma.coiCheck.findFirst({
      where: {
        companyId: t.companyId, deletedAt: null,
        humanDecision: 'APPROVED', policyExpiryDate: { gte: new Date() },
      },
      select: { id: true },
    })
    if (live) {
      console.log(`${t.name}: already has a live approved COI — skipped`)
      continue
    }

    console.log(`${t.name}  [${t.domains.join(', ')}]`)
    const raw: Candidate[] = []
    for (const d of t.domains) raw.push(...(await candidatesForDomain(d)))

    // The SAME attachment arrives on several inboxes and several replies —
    // Rave Collective's certificate showed up six times in the dry run.
    // Collapse on the filename so we pay for one AI read, not six, and the
    // review desk shows one row rather than a wall of identical ones.
    // "(1)" / "(2)" copy suffixes are stripped so those collapse too.
    const byName = new Map<string, Candidate>()
    for (const c of raw) {
      const key = c.attachment.filename
        .toLowerCase()
        .replace(/\s*\(\d+\)/g, '')
        .replace(/\s+/g, ' ')
        .trim()
      if (!byName.has(key)) byName.set(key, c)
    }
    const cands = [...byName.values()]
    if (cands.length === 0) {
      console.log('    no candidate PDFs')
      continue
    }
    if (raw.length !== cands.length) {
      console.log(`    ${raw.length} attachments -> ${cands.length} distinct`)
    }

    for (const c of cands) {
      scanned++
      const already = await prisma.coiCheck.findFirst({
        where: {
          companyId: t.companyId,
          deletedAt: null,
          originalFilename: c.attachment.filename,
        },
        select: { id: true },
      })
      if (already) {
        dupes++
        continue
      }

      if (!WRITE) {
        console.log(`    candidate: "${c.subject.slice(0, 45)}" -> ${c.attachment.filename}`)
        continue
      }

      // Captured so the row's fileKey is the key the blob ACTUALLY has.
      // A fileKey that only resembles the real one makes the stored document
      // unfindable the day someone needs to delete or re-fetch it.
      let blobKey = ''
      const dl = await downloadAndUploadAttachment({
        inbox: c.inbox,
        gmailMessageId: c.gmailMessageId,
        attachment: c.attachment,
        buildBlobKey: (att) => {
          blobKey = `coi/harvest/${t.companyId}/${c.gmailMessageId}-${att.filename.replace(/[^A-Za-z0-9._-]+/g, '_')}`
          return blobKey
        },
        put: (key, data, opts) => put(key, data, opts as never) as Promise<{ url: string }>,
      })
      if (!dl) continue

      // ── The classifier ────────────────────────────────────────
      //
      // BOTH a named insured and an expiry are required, not either. The
      // first write run filed four `1880Contract_*.pdf` vendor contracts
      // because the AI found a party name on them and called that the
      // insured. A certificate without a policy period is not a certificate
      // you can act on — you cannot say what it covers or until when — so
      // demanding the expiry is both the honest test and the one that
      // rejects contracts, receipts and gear lists.
      const ai = await runCoiAiReview(dl.buf, 'application/pdf')
      const fields = coiCheckWriteFields(ai)
      if (!fields.namedInsured || !fields.policyExpiryDate) {
        notCerts++
        console.log(`    not a certificate: ${c.attachment.filename}`)
        continue
      }

      // ── Already expired ───────────────────────────────────────
      //
      // Carry-forward requires an UNEXPIRED policy, so an expired
      // certificate can never reach a job — filing it only fills the review
      // desk with documents nobody can act on, and creates the chance
      // somebody approves one by mistake. The first run turned up eleven,
      // one of them from 2020. Reported, not filed; the email still has it
      // if the history is ever wanted.
      if (fields.policyExpiryDate.getTime() < Date.now()) {
        expiredFound++
        console.log(
          `    expired ${fields.policyExpiryDate.toISOString().slice(0, 10)}: ${c.attachment.filename}`,
        )
        continue
      }

      const row = await prisma.coiCheck.create({
        data: {
          fileKey: blobKey,
          fileUrl: dl.fileUrl,
          originalFilename: c.attachment.filename,
          fileSize: dl.bytes,
          mimeType: 'application/pdf',
          companyId: t.companyId,
          source: 'EMAIL_HARVEST',
          // PENDING, always. Carry-forward requires APPROVED, so nothing
          // reaches a job until a person decides at /admin/cois.
          humanDecision: 'PENDING',
          ...fields,
        },
        select: { id: true },
      })
      filed.push({
        coiCheckId: row.id,
        companyId: t.companyId,
        company: t.name,
        filename: c.attachment.filename,
        gmailMessageId: c.gmailMessageId,
        inbox: c.inbox,
        namedInsured: fields.namedInsured,
        expiry: fields.policyExpiryDate?.toISOString().slice(0, 10) ?? null,
      })
      console.log(
        `    FILED ${c.attachment.filename} — insured "${fields.namedInsured}" exp ${fields.policyExpiryDate?.toISOString().slice(0, 10) ?? '?'}`,
      )
    }
  }

  console.log(
    `\nCandidates seen: ${scanned} · already filed: ${dupes} · not certificates: ${notCerts} · expired (skipped): ${expiredFound}`,
  )
  if (!WRITE) {
    console.log('\nDRY RUN — nothing written. Re-run with --write.\n')
    return
  }
  const out = path.join(process.cwd(), `tmp/coi-harvest-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
  fs.writeFileSync(out, JSON.stringify(filed, null, 2))
  console.log(`\nFiled ${filed.length} PENDING certificates. Review at /admin/cois.`)
  console.log(`Journal (reversible by captured id): ${out}\n`)
}

main().finally(() => prisma.$disconnect())
