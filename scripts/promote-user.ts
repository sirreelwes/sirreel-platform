/**
 * Grant an email the same role an existing user holds. One-off, manual.
 *
 * Why this exists: HQ's NextAuth has NO adapter (no PrismaAdapter anywhere in
 * src/), so signing in does NOT create a User row. A brand-new address —
 * wes@vermardesign.com after the domain allowlist lands — authenticates fine
 * and then falls through src/lib/permissions.ts:274
 * (`ROLE_PERMISSIONS[user.role] || ROLE_PERMISSIONS.CLIENT`) to CLIENT, the
 * lowest tier. There is no row to promote and no admin UI that would let the
 * new identity grant itself one, because that UI requires admin.
 *
 * So this creates the row when it is missing and updates the role when it is
 * not. It copies role/location/dataScope/salesOnly from a reference user
 * (default wes@sirreel.com) rather than hardcoding ADMIN, so the new identity
 * matches the old one exactly.
 *
 * It does NOT merge the two User records. wes@sirreel.com keeps its history,
 * its assignments and its audit trail; the VerMar address is a separate
 * identity that happens to carry the same permissions.
 *
 * Run:
 *   export DATABASE_URL=$(grep '^DATABASE_URL=' .env.local | grep -v PRISMA | head -1 | cut -d'"' -f2)
 *   npx tsx scripts/promote-user.ts wes@vermardesign.com
 *
 * Optional flags:
 *   --from=<email>   reference user to copy from (default wes@sirreel.com)
 *   --name="Wes"     name for a newly created row (default: local-part)
 *   --dry-run        print what would change, write nothing
 */

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

function arg(flag: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${flag}=`))
  return hit ? hit.slice(flag.length + 3) : undefined
}

async function main(): Promise<void> {
  const target = process.argv.slice(2).find((a) => !a.startsWith('--'))?.trim().toLowerCase()
  const reference = (arg('from') ?? 'wes@sirreel.com').trim().toLowerCase()
  const dryRun = process.argv.includes('--dry-run')

  if (!target) {
    console.error('Usage: npx tsx scripts/promote-user.ts <email> [--from=wes@sirreel.com] [--name="Wes"] [--dry-run]')
    process.exit(1)
  }
  if (target === reference) {
    console.error(`Refusing to run: target and reference are the same address (${target}).`)
    process.exit(1)
  }

  const source = await prisma.user.findFirst({
    where: { email: { equals: reference, mode: 'insensitive' } },
    select: { email: true, role: true, location: true, dataScope: true, salesOnly: true },
  })
  if (!source) {
    console.error(`No User row for the reference address ${reference}. Nothing to copy from.`)
    process.exit(1)
  }

  const existing = await prisma.user.findFirst({
    where: { email: { equals: target, mode: 'insensitive' } },
    select: { id: true, email: true, role: true, salesOnly: true, dataScope: true },
  })

  console.log(`reference ${source.email} → role=${source.role} location=${source.location} dataScope=${source.dataScope} salesOnly=${source.salesOnly}`)
  console.log(existing
    ? `target    ${existing.email} exists → role=${existing.role} (will update)`
    : `target    ${target} has no row → will create`)

  if (dryRun) {
    console.log('\n--dry-run: nothing written.')
    return
  }

  if (existing) {
    const updated = await prisma.user.update({
      where: { id: existing.id },
      data: {
        role: source.role,
        location: source.location,
        dataScope: source.dataScope,
        salesOnly: source.salesOnly,
      },
      select: { id: true, email: true, role: true },
    })
    console.log(`\nUpdated ${updated.email} → ${updated.role}`)
  } else {
    const name = arg('name') ?? target.split('@')[0]
    const created = await prisma.user.create({
      data: {
        email: target,
        name,
        role: source.role,
        location: source.location,
        dataScope: source.dataScope,
        salesOnly: source.salesOnly,
      },
      select: { id: true, email: true, role: true },
    })
    console.log(`\nCreated ${created.email} → ${created.role}`)
  }

  console.log('\nNOTE: individual-email allowlists are separate from role and are')
  console.log('NOT changed by this script. To carry them over, set these in Vercel:')
  console.log(`  HR_ALLOWLIST=${target}`)
  console.log(`  DEDUP_ALLOWLIST=${target}`)
  console.log('WRITE_OFF_AUTHORIZED in src/app/api/collections/aging-review/route.ts')
  console.log('has no env override — it needs a code change to include this address.')
}

main()
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
