/**
 * Stage C — AI role inference over contacts the regex mapper can't reach.
 *
 * Three passes, cheapest first. Nothing reaches Haiku that a free pass
 * could have answered.
 *
 *   PASS 1  stored rawTitle → mapper. (Already covered by
 *           scripts/backfillContactRoles.ts; re-checked here so a run of
 *           this script alone is still correct.)
 *
 *   PASS 2  titles sitting in cached `EmailMessage.extractedData` from
 *           the Pipeline extractor, which nothing ever copied onto the
 *           Person. 27 contacts at the time of writing — free.
 *
 *   PASS 3  Haiku reads the contact's actual mail. This is the one that
 *           gets at what Wes asked for: a role stated in prose, by them
 *           or by someone else on the thread, that no regex reaches.
 *
 * Safeguards on pass 3 (see src/lib/crm/inferRoleFromMail.ts):
 *   - the model must return a VERBATIM quote, and this script verifies
 *     it appears in the text we sent before believing anything
 *   - confidence < 0.75 is discarded
 *   - UNKNOWN is explicitly encouraged in the prompt
 *   - only enum roles accepted; OTHER is never written
 *
 * Calibration gate (default ON): process CALIBRATION_LIMIT contacts,
 * print every verdict with its evidence, then STOP without writing so a
 * human can read what the model actually concluded. --continue skips
 * the gate. --write is still required to change anything.
 *
 * Run:
 *   export DATABASE_URL=$(grep '^DATABASE_URL=' .env.local | grep -v PRISMA | head -1 | cut -d'"' -f2)
 *   export ANTHROPIC_API_KEY=$(grep '^ANTHROPIC_API_KEY=' .env.local | head -1 | cut -d'"' -f2)
 *   npx tsx scripts/backfillContactRolesAi.ts                    # calibration, no writes
 *   npx tsx scripts/backfillContactRolesAi.ts --continue         # full dry run
 *   npx tsx scripts/backfillContactRolesAi.ts --continue --write # apply
 */

import './_loadProdEnv'
import { PrismaClient, PersonRole } from '@prisma/client'
import Anthropic from '@anthropic-ai/sdk'
import { writeFileSync, mkdirSync } from 'node:fs'
import { mapTitleToRole } from '../src/lib/crm/roleMapping'
import { inferRoleFromMail, type RoleInferenceResult } from '../src/lib/crm/inferRoleFromMail'

const prisma = new PrismaClient()
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const WRITE = process.argv.includes('--write')
const CONTINUE = process.argv.includes('--continue')
const limitArg = process.argv.indexOf('--limit')
const CLI_LIMIT = limitArg >= 0 ? Number(process.argv[limitArg + 1]) : null
const CALIBRATION_LIMIT = 60

/** ~5 req/sec, matching the existing capture backfill's throttle. */
const THROTTLE_MS = 200
const MIN_BODY_CHARS = 40
const MAX_EXCERPTS_PER_PERSON = 4

const bareAddress = (a: string) => (a.match(/<([^>]+)>/)?.[1] ?? a).toLowerCase().trim()
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function main() {
  const mode = WRITE ? 'APPLYING' : 'DRY RUN (no writes)'
  console.log(`=== ${mode} ===`)
  if (!CONTINUE) console.log(`Calibration gate ON — stopping after ${CALIBRATION_LIMIT}. Pass --continue to run wide.\n`)

  const others = await prisma.person.findMany({
    where: { role: PersonRole.OTHER },
    select: { id: true, firstName: true, lastName: true, email: true, rawTitle: true },
  })
  const byEmail = new Map(others.map((o) => [o.email.toLowerCase(), o]))
  console.log(`Contacts at role=OTHER: ${others.length}`)

  const applied: { id: string; email: string; to: string; via: string; evidence: string | null }[] = []

  // ── PASS 1 — stored title ────────────────────────────────────────
  const pass1 = others.filter((o) => o.rawTitle && mapTitleToRole(o.rawTitle) !== 'OTHER')
  console.log(`\nPASS 1 (stored title, free): ${pass1.length}`)
  for (const p of pass1) {
    const role = mapTitleToRole(p.rawTitle)
    if (WRITE) await prisma.person.update({ where: { id: p.id }, data: { role: role as PersonRole } })
    applied.push({ id: p.id, email: p.email, to: role, via: 'stored-title', evidence: p.rawTitle })
    byEmail.delete(p.email.toLowerCase())
  }

  // ── Gather mail once, for both remaining passes ──────────────────
  console.log('\nScanning inbound mail…')
  const msgs = await prisma.emailMessage.findMany({
    where: { direction: 'inbound', duplicateOfId: null },
    select: { fromAddress: true, bodyText: true, snippet: true, extractedData: true, sentAt: true },
    orderBy: { sentAt: 'desc' },
  })

  const excerptsByPerson = new Map<string, string[]>()
  const cachedTitleByPerson = new Map<string, string>()
  for (const m of msgs) {
    const person = byEmail.get(bareAddress(m.fromAddress))
    if (!person) continue

    const ed = m.extractedData as { contact?: { title?: string | null } } | null
    const t = ed?.contact?.title?.trim()
    if (t && !cachedTitleByPerson.has(person.id)) cachedTitleByPerson.set(person.id, t)

    const body = (m.bodyText ?? m.snippet ?? '').trim()
    if (body.length < MIN_BODY_CHARS) continue
    const bucket = excerptsByPerson.get(person.id) ?? []
    if (bucket.length < MAX_EXCERPTS_PER_PERSON) {
      bucket.push(body)
      excerptsByPerson.set(person.id, bucket)
    }
  }

  // ── PASS 2 — cached extraction title ─────────────────────────────
  const pass2: typeof others = []
  for (const [personId, title] of cachedTitleByPerson) {
    if (mapTitleToRole(title) === 'OTHER') continue
    const person = others.find((o) => o.id === personId)
    if (person && byEmail.has(person.email.toLowerCase())) pass2.push(person)
  }
  console.log(`PASS 2 (title already in a cached extraction, free): ${pass2.length}`)
  for (const p of pass2) {
    const title = cachedTitleByPerson.get(p.id) as string
    const role = mapTitleToRole(title)
    if (WRITE) {
      await prisma.person.update({
        where: { id: p.id },
        // Fill rawTitle too — it was parsed months ago and never copied
        // across, which is why the mapper never saw it.
        data: { role: role as PersonRole, ...(p.rawTitle ? {} : { rawTitle: title }) },
      })
    }
    applied.push({ id: p.id, email: p.email, to: role, via: 'cached-extraction', evidence: title })
    byEmail.delete(p.email.toLowerCase())
  }

  // ── PASS 3 — Haiku reads the mail ────────────────────────────────
  const candidates = [...byEmail.values()].filter((p) => (excerptsByPerson.get(p.id)?.length ?? 0) > 0)
  const limit = CLI_LIMIT ?? (CONTINUE ? candidates.length : CALIBRATION_LIMIT)
  const batch = candidates.slice(0, limit)

  console.log(`\nPASS 3 (Haiku): ${candidates.length} candidates, processing ${batch.length}`)
  console.log('Every verdict below carries the verbatim quote it rests on.\n')

  const stats = { resolved: 0, unknown: 0, lowConfidence: 0, unverifiable: 0, badRole: 0, error: 0 }
  const titlesOnly: { email: string; title: string }[] = []

  for (const [i, person] of batch.entries()) {
    const excerpts = excerptsByPerson.get(person.id) ?? []
    const name = `${person.firstName} ${person.lastName}`.trim()
    let verdict: RoleInferenceResult
    try {
      verdict = await inferRoleFromMail({ name, email: person.email, excerpts }, anthropic)
    } catch {
      stats.error += 1
      continue
    }
    await sleep(THROTTLE_MS)

    if (verdict.title && !person.rawTitle) titlesOnly.push({ email: person.email, title: verdict.title })

    if (verdict.role === 'UNKNOWN') {
      switch (verdict.rejectedReason) {
        case 'low-confidence': stats.lowConfidence += 1; break
        case 'unverifiable-quote': stats.unverifiable += 1; break
        case 'bad-role': stats.badRole += 1; break
        case 'error': stats.error += 1; break
        default: stats.unknown += 1
      }
      continue
    }

    stats.resolved += 1
    const quote = (verdict.evidence ?? '').replace(/\s+/g, ' ').slice(0, 96)
    console.log(`  ${String(i + 1).padStart(4)}. ${name.padEnd(24)} ${verdict.role.padEnd(24)} ${verdict.confidence.toFixed(2)}`)
    console.log(`        "${quote}"`)

    if (WRITE) {
      await prisma.person.update({
        where: { id: person.id },
        data: {
          role: verdict.role as PersonRole,
          ...(person.rawTitle || !verdict.title ? {} : { rawTitle: verdict.title }),
        },
      })
    }
    applied.push({
      id: person.id, email: person.email, to: verdict.role,
      via: `ai:${verdict.confidence.toFixed(2)}`, evidence: verdict.evidence,
    })
  }

  console.log('\nPASS 3 OUTCOMES')
  console.log(`  role resolved                 : ${stats.resolved}`)
  console.log(`  model said UNKNOWN            : ${stats.unknown}`)
  console.log(`  discarded, low confidence     : ${stats.lowConfidence}`)
  console.log(`  discarded, quote not in source: ${stats.unverifiable}   <- hallucination guard`)
  console.log(`  discarded, role off-menu      : ${stats.badRole}`)
  console.log(`  errors                        : ${stats.error}`)

  if (titlesOnly.length > 0) {
    console.log(`\n  ${titlesOnly.length} contacts had a title in their mail but no confident role.`)
    titlesOnly.slice(0, 10).forEach((t) => console.log(`    ${t.email.padEnd(34)} "${t.title}"`))
  }

  console.log(`\nTOTAL RECLASSIFIED: ${applied.length}`)
  const byVia = new Map<string, number>()
  applied.forEach((a) => {
    const k = a.via.startsWith('ai:') ? 'ai' : a.via
    byVia.set(k, (byVia.get(k) ?? 0) + 1)
  })
  ;[...byVia.entries()].forEach(([k, n]) => console.log(`  ${String(n).padStart(4)}  ${k}`))

  if (!WRITE) {
    console.log('\nDry run — nothing written. Add --write to apply.')
    if (!CONTINUE) console.log('Calibration batch only. Add --continue to process all candidates.')
    return
  }

  mkdirSync('journals', { recursive: true })
  const path = `journals/role-ai-backfill-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
  writeFileSync(path, JSON.stringify({ previousRole: 'OTHER', changes: applied }, null, 2))
  console.log(`\nReversal record: ${path} — every row was OTHER before this run.`)
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1 })
  .finally(() => prisma.$disconnect())
