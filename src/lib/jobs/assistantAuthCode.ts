import type { Prisma } from '@prisma/client'
import { randomInt } from 'crypto'

/**
 * Random after-hours authentication code for a Job.
 *
 * This is the code the client sees on their Portal v2 job page and reads to
 * the SirReel Assistant to help release the gate / lockbox code. It is
 * DELIBERATELY not the sequential `jobCode` (SR-JOB-NNNN), which is guessable
 * and therefore unfit as a shared secret.
 *
 * Format: a 5-digit number (10000–99999) — deliberately short and simple
 * because a driver reads it aloud or types it half-asleep after hours. That's
 * only ~90k combinations, which is acceptable ONLY because the code is never
 * the sole factor (always paired with VIN last-4 or the driver name), the
 * public assistant is rate-limited, and only an ACTIVE job can verify. The DB
 * unique index is the backstop; we probe for a clash and regenerate.
 */
function randomCode(): string {
  return String(randomInt(10000, 100000)) // 10000–99999 (no leading-zero ambiguity)
}

/**
 * Generate a code guaranteed unused at call time. Accepts the singleton
 * client or a transaction client (mirrors `nextJobCode`).
 */
export async function generateAssistantAuthCode(
  client: Prisma.TransactionClient,
): Promise<string> {
  for (let attempt = 0; attempt < 12; attempt++) {
    const code = randomCode()
    const clash = await client.job.findUnique({
      where: { assistantAuthCode: code },
      select: { id: true },
    })
    if (!clash) return code
  }
  throw new Error('generateAssistantAuthCode: no unique code after 12 attempts')
}
