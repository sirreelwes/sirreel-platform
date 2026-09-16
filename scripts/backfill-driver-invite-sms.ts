/**
 * Backfill SmsMessage.driverAssignmentId for invites texted BEFORE the
 * column existed (2026-09-15 — Garren and Liberace on SR-JOB-0273).
 *
 * Matches conservatively and by CAPTURED ID only: an outbound invite-shaped
 * message, on the thread for the number the invite says it went to, within
 * two minutes of invitedAt. Anything ambiguous is left alone and reported.
 *
 *   npx tsx scripts/backfill-driver-invite-sms.ts [--write]
 */
import { prisma } from '@/lib/prisma'
import { toE164 } from '@/lib/sms/sendSms'

const WRITE = process.argv.includes('--write')
const WINDOW_MS = 2 * 60 * 1000

async function main() {
  const das = await prisma.driverAssignment.findMany({
    where: { smsSentTo: { not: null } },
    select: { id: true, smsSentTo: true, invitedAt: true, driver: { select: { firstName: true, lastName: true } } },
  })
  console.log(`texted invites on file: ${das.length}`)

  for (const da of das) {
    const phone = toE164(da.smsSentTo || '')
    if (!phone) { console.log(`  skip ${da.id} — unusable number ${da.smsSentTo}`); continue }
    const hits = await prisma.smsMessage.findMany({
      where: {
        direction: 'OUTBOUND',
        thread: { phone },
        body: { contains: '/drive/' },
        createdAt: { gte: new Date(da.invitedAt.getTime() - WINDOW_MS), lte: new Date(da.invitedAt.getTime() + WINDOW_MS) },
      },
      select: { id: true, status: true, driverAssignmentId: true, createdAt: true },
    })
    const unlinked = hits.filter((h) => !h.driverAssignmentId)
    const who = `${da.driver.firstName} ${da.driver.lastName}`.trim()
    if (hits.length === 0) { console.log(`  none for ${who} (${phone}) — leaving alone`); continue }
    if (unlinked.length !== 1) {
      console.log(`  ${who}: ${hits.length} candidates, ${unlinked.length} unlinked — ambiguous, leaving alone`)
      continue
    }
    const m = unlinked[0]
    console.log(`  ${who} (${phone}) -> message ${m.id} [${m.status}]${WRITE ? ' — LINKING' : ''}`)
    if (WRITE) {
      await prisma.smsMessage.update({ where: { id: m.id }, data: { driverAssignmentId: da.id } })
    }
  }
  if (!WRITE) console.log('\ndry run — re-run with --write')
}

main().finally(() => prisma.$disconnect())
