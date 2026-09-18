/**
 * Offer the negotiated annual for signature, and invite the signer — the
 * LAPTOP entry point.
 *
 *   vercel env run -e production -- \
 *     npx tsx scripts/offer-annual-for-signature.ts \
 *       --key graduation-day-2026 --email haylea@example.com --name Haylea --write
 *
 * The write needs BLOB_READ_WRITE_TOKEN (the offer renders a PDF) and the
 * mailer, neither of which is in .env.local — hence `vercel env run`. From a
 * phone there is nothing to export: /admin/maintenance → "Offer the
 * negotiated annual for signature" runs the SAME function inside the Vercel
 * runtime, where both already are. That is the path this was built for; this
 * file exists so a laptop is never the only way and so the two can never
 * drift.
 *
 * The work is `offerAnnualToSigner()` in
 * src/lib/portal/offerAnnualToSigner.ts. This file is argv, the journal and
 * an exit code — nothing else. Add behaviour to the lib, or the phone loses
 * it.
 *
 * Flags:
 *   --key <agreement-key>   which negotiated agreement (required)
 *   --email <address>       who signs; omit to file the offers and mail nobody
 *   --name / --title        theirs, for the greeting and the contact row
 *   --no-invite             grant access without emailing them
 *   --alias "Registry Name=Exact DB Name"   repeatable
 *   --write                 do it; dry run otherwise
 *
 * Exit codes: 0 done · 1 failed · 2 refused with something to fix.
 */
import { mkdirSync, writeFileSync } from 'fs'
import path from 'path'
import { prisma } from '../src/lib/prisma'
import { offerAnnualToSigner, TaskRefused } from '../src/lib/portal/offerAnnualToSigner'
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
    console.log('Usage: --key <agreement-key> [--email <address> --name <name> --title <title>]')
    console.log('       [--no-invite] [--alias "Registry Name=Exact DB Name"] [--write]')
    console.log('Known keys:', NEGOTIATED_AGREEMENTS.map((a) => a.key).join(', '))
    process.exit(1)
  }

  const dryRun = !process.argv.includes('--write')
  const result = await offerAnnualToSigner({
    key,
    dryRun,
    aliases: aliases(),
    signerEmail: arg('email') ?? null,
    signerName: arg('name') ?? null,
    signerTitle: arg('title') ?? null,
    sendInvite: !process.argv.includes('--no-invite'),
    refresh: !process.argv.includes('--no-refresh'),
  })

  console.log()
  for (const line of result.log) console.log(line)

  if (!dryRun && (result.createdIds.length || result.touchedIds.length)) {
    // The laptop's version of the AuditLog row the web path writes: the
    // captured ids, so a cleanup can only ever delete by them.
    const dir = path.join(process.cwd(), 'journals')
    mkdirSync(dir, { recursive: true })
    const file = path.join(dir, `offer-annual-for-signature-${result.key}-${Date.now()}.json`)
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
