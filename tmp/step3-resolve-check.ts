import { resolveJob } from '../src/lib/jobs/resolveJob'
import { prisma } from '../src/lib/prisma'

async function main() {
  const before = await prisma.job.count() + await prisma.company.count() + await prisma.person.count()
  // Exactly what NewHoldModal sends: picked company + editable dates
  const zenith = await prisma.company.findFirst({ where: { name: { contains: 'Zenith' } }, select: { id: true, name: true } })
  const r1 = await resolveJob({
    companyId: zenith?.id, dates: { start: '2026-07-20', end: '2026-07-24' }, sourceRef: 'gantt:+hold',
  })
  console.log('known company + dates →', r1.bucket, r1.candidates.map(c => `[${c.jobCode}] ${c.name} score=${c.score} companyId=${c.companyId ? 'SET' : 'NULL'} :: ${c.reasons.join(' | ')}`))
  // Unknown company → NO_MATCH, draft prefilled
  const r2 = await resolveJob({
    companyName: 'Totally Unknown Prods LLC', dates: { start: '2026-07-20', end: '2026-07-24' }, sourceRef: 'gantt:+hold',
  })
  console.log('unknown company →', r2.bucket, 'candidates:', r2.candidates.length, 'draft.companyName:', r2.draft.companyName)
  const after = await prisma.job.count() + await prisma.company.count() + await prisma.person.count()
  console.log('purity: row counts before/after =', before, '/', after, before === after ? 'PURE ✓' : 'MUTATED ✗')
}
main().finally(() => prisma.$disconnect())
