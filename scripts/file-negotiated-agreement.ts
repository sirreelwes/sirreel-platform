/**
 * File a negotiated rental agreement as a company's annual master — the
 * LAPTOP entry point.
 *
 *   export DATABASE_URL=$(grep DATABASE_URL .env.local | grep -v PRISMA | cut -d'"' -f2)
 *   npx tsx scripts/file-negotiated-agreement.ts --key graduation-day-2026
 *   vercel env run -e production -- \
 *     npx tsx scripts/file-negotiated-agreement.ts --key graduation-day-2026 --write
 *
 * The write needs BLOB_READ_WRITE_TOKEN, which is deliberately not in
 * .env.local — hence `vercel env run` (same pattern as fetch-company-logos.ts).
 * From an iPad there is nothing to export: /admin/maintenance → "File a
 * negotiated agreement as the client's annual master" runs the SAME function
 * inside the Vercel runtime, where the token already is.
 *
 * The work itself is `fileNegotiatedAgreement()` in
 * src/lib/contracts/fileNegotiatedAgreement.ts. This file is argv, the
 * journal file and an exit code — nothing else. Add behaviour to the lib, or
 * the phone loses it.
 *
 * Flags:
 *   --key <agreement-key>            which negotiated agreement (required)
 *   --write                          actually file it; dry run otherwise
 *   --effective / --expires YYYY-MM-DD   override the agreed window for a one-off
 *   --alias "Registry Name=Exact DB Name"   repeatable; the agreement carries
 *                                    the confirmed ones already
 *   --no-refresh                     leave a master rendered from an OLDER
 *                                    version alone instead of superseding it
 *
 * Exit codes: 0 done · 1 failed · 2 refused with something to fix.
 */
import { mkdirSync, writeFileSync } from 'fs'
import path from 'path'
import { prisma } from '../src/lib/prisma'
import { fileNegotiatedAgreement, TaskRefused } from '../src/lib/contracts/fileNegotiatedAgreement'
import { NEGOTIATED_AGREEMENTS } from '../src/lib/contracts/negotiatedAgreement'

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i === -1 ? undefined : process.argv[i + 1]
}

/** `--alias "Party Giraffes=Party Giraffes, LLC"`, repeatable. */
function aliases(): Record<string, string> {
  const out: Record<string, string> = {}
  process.argv.forEach((a, i) => {
    if (a !== '--alias') return
    const raw = process.argv[i + 1] || ''
    const eq = raw.indexOf('=')
    if (eq > 0) out[raw.slice(0, eq).trim()] = raw.slice(eq + 1).trim()
  })
  return out
}

async function main() {
  const key = arg('key')
  if (!key) {
    console.log('Usage: --key <agreement-key> [--write] [--effective YYYY-MM-DD] [--expires YYYY-MM-DD]')
    console.log('       [--alias "Registry Name=Exact DB Name"] (repeatable)')
    console.log('Known keys:', NEGOTIATED_AGREEMENTS.map((a) => a.key).join(', '))
    process.exit(1)
  }

  const dryRun = !process.argv.includes('--write')
  const result = await fileNegotiatedAgreement({
    key,
    dryRun,
    effective: arg('effective') ?? null,
    expires: arg('expires') ?? null,
    aliases: aliases(),
    refresh: !process.argv.includes('--no-refresh'),
  })

  console.log()
  for (const line of result.log) console.log(line)

  if (!dryRun && (result.createdIds.length || result.touchedIds.length)) {
    // The journal is the laptop's version of the AuditLog row the web path
    // writes: the captured ids, so a cleanup can only ever delete by them.
    const dir = path.join(process.cwd(), 'journals')
    mkdirSync(dir, { recursive: true })
    const file = path.join(dir, `file-negotiated-agreement-${result.key}-${Date.now()}.json`)
    writeFileSync(file, JSON.stringify({ ...result, at: new Date().toISOString() }, null, 2))
    console.log(`\nJournal: ${file}`)
  }
  console.log()
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    if (e instanceof TaskRefused) {
      console.error(`\n${e.message}\n${e.fix}\n`)
      process.exit(2)
    }
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
