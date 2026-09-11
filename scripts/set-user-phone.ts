/**
 * Set (or clear) the phone on a staff User row. One-off, manual.
 *
 * Why this exists: User.phone has no edit surface in HQ, and the partner
 * introduction's sign-off now reads the sender's cell from it (Wes
 * 2026-09-11: "Add my cell and email address"). Until a profile page carries
 * the field, this is how it gets there.
 *
 * Run:
 *   export DATABASE_URL=$(grep '^DATABASE_URL=' .env.local | grep -v PRISMA | head -1 | cut -d'"' -f2)
 *   npx tsx scripts/set-user-phone.ts wes@sirreel.com "760-672-5522"
 *   npx tsx scripts/set-user-phone.ts wes@sirreel.com --clear
 *
 * Prints the row before and after. Refuses when the email has no User row —
 * this sets a phone, it does not create identities (see promote-user.ts).
 */

import { prisma } from '../src/lib/prisma'

async function main(): Promise<void> {
  const [email, value] = process.argv.slice(2)
  if (!email || (!value && !process.argv.includes('--clear'))) {
    console.error('usage: npx tsx scripts/set-user-phone.ts <email> "<phone>" | --clear')
    process.exit(2)
  }
  const clear = process.argv.includes('--clear')
  const phone = clear ? null : value.trim()
  if (phone !== null && phone.length > 30) throw new Error('phone is longer than the 30-character column')

  const before = await prisma.user.findUnique({ where: { email: email.toLowerCase() }, select: { id: true, name: true, email: true, phone: true } })
  if (!before) throw new Error(`no User row for ${email} — nothing changed`)
  console.log('before:', before)
  const after = await prisma.user.update({ where: { id: before.id }, data: { phone }, select: { id: true, name: true, email: true, phone: true } })
  console.log('after: ', after)
}

main()
  .then(() => process.exit(0))
  .catch((e) => { console.error(e); process.exit(1) })
