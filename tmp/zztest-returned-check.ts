import { prisma } from '../src/lib/prisma'

async function main() {
  // Self-owned fixture: created here, ID captured, deleted by that ID.
  const company = await prisma.company.findFirst({ select: { id: true } })
  const agent = await prisma.user.findFirst({ where: { isActive: true }, select: { id: true, name: true } })
  if (!company || !agent) throw new Error('no company/agent to anchor fixture')

  const job = await prisma.job.create({
    data: {
      jobCode: `ZZTEST-RET-${process.pid}`,
      name: 'ZZTEST returned-semantics check',
      companyId: company.id,
      agentId: agent.id,
    },
    select: { id: true, returnedAt: true, returnedById: true },
  })
  console.log('created', job.id, 'returnedAt:', job.returnedAt, 'returnedById:', job.returnedById)

  const marked = await prisma.job.update({
    where: { id: job.id },
    data: { returnedAt: new Date(), returnedById: agent.id },
    select: { returnedAt: true, returnedBy: { select: { name: true } } },
  })
  console.log('marked:', marked.returnedAt?.toISOString(), 'by', marked.returnedBy?.name)

  const unmarked = await prisma.job.update({
    where: { id: job.id },
    data: { returnedAt: null, returnedById: null },
    select: { returnedAt: true, returnedById: true },
  })
  console.log('unmarked:', unmarked.returnedAt, unmarked.returnedById)

  await prisma.job.delete({ where: { id: job.id } }) // captured ID only
  console.log('deleted fixture', job.id)
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
