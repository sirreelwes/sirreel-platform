import { prisma } from '../src/lib/prisma'
import { discussClause } from '../src/lib/contracts/discussClause'

async function main() {
  const wes = await prisma.user.findUnique({ where: { email: 'wes@sirreel.com' }, select: { id: true } })
  const result = await discussClause({
    reviewId: 'ef015a5a-8b3c-4c2e-bcae-db7616b9c6c3',
    clauseKey: '7',
    changeIndex: 1, // §7 is changes[1] in the NEW aiResponse
    message:
      'ZZTEST verification. The client struck per-occurrence entirely. Can we live with aggregate-only if they raise the aggregate to $3M? If not, draft counter language holding the line at $2M aggregate / $1M per occurrence.',
    userId: wes!.id,
  })
  if (!result.ok) throw new Error(`${result.status}: ${result.error}`)
  console.log('user msg id:', result.userMessage.id)
  console.log('assistant msg id:', result.assistantMessage.id)
  console.log('has counter-draft tags:', result.assistantMessage.content.includes('<counter-draft>'))
  console.log('\n--- assistant reply ---\n' + result.assistantMessage.content)

  // Persistence check, then cleanup by captured IDs ONLY.
  const persisted = await prisma.reviewClauseMessage.findMany({
    where: { id: { in: [result.userMessage.id, result.assistantMessage.id] } },
    select: { id: true, role: true, clauseKey: true },
  })
  console.log('\npersisted rows:', persisted.length, persisted.map((p) => `${p.role}@${p.clauseKey}`).join(', '))
  await prisma.reviewClauseMessage.deleteMany({
    where: { id: { in: [result.userMessage.id, result.assistantMessage.id] } },
  })
  console.log('deleted fixture rows by captured ID')
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
