import type { Prisma } from '@prisma/client'

/**
 * Compute the next sequential job code (`SR-JOB-NNNN`).
 *
 * Robust against malformed / non-matching codes already in the table —
 * RentalWorks imports (`TEST-LANK-39743`), legacy rows, and the historical
 * `SR-JOB-0NaN` "poison" row produced by the old generator. It takes the
 * MAX numeric suffix across VALID `SR-JOB-<digits>` codes only and ignores
 * everything else, so one bad row can no longer wedge the sequence.
 *
 * The old logic read the single most-recently-created job and did
 * `parseInt(code.replace('SR-JOB-',''))+1`; once the latest job was
 * `SR-JOB-0NaN` that yielded `SR-JOB-0001` every time → unique-constraint
 * collisions → "create failed" on every new-job hold.
 *
 * Accepts either the singleton client or a transaction client. Callers
 * should still wrap the subsequent `job.create` in the existing
 * unique-constraint retry to absorb concurrent inserts.
 */
export async function nextJobCode(client: Prisma.TransactionClient): Promise<string> {
  const rows = await client.job.findMany({
    where: { jobCode: { startsWith: 'SR-JOB-' } },
    select: { jobCode: true },
  })
  let max = 0
  for (const { jobCode } of rows) {
    const m = /^SR-JOB-(\d+)$/.exec(jobCode)
    if (m) {
      const n = parseInt(m[1], 10)
      if (n > max) max = n
    }
  }
  return `SR-JOB-${String(max + 1).padStart(4, '0')}`
}
