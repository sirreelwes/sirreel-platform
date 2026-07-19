import type { Prisma } from '@prisma/client'
import { randomInt } from 'crypto'

/**
 * Random, high-entropy after-hours authentication code for a Job.
 *
 * This is the code the client sees on their Portal v2 job page and reads
 * to the SirReel Assistant to help release the gate / lockbox code. It is
 * DELIBERATELY not the sequential `jobCode` (SR-JOB-NNNN), which is
 * guessable and therefore unfit as a shared secret.
 *
 * Format: `XXXX-XXXX` from a 30-char alphabet that omits the read-aloud
 * ambiguous glyphs (0/O, 1/I/L) — a driver dictates it over the phone or
 * types it half-asleep, so legibility matters more than raw length.
 * 30^8 ≈ 6.6e11 combinations; collisions are astronomically unlikely, and
 * the DB unique index is the backstop. We still probe for a clash and
 * regenerate so a create never fails on the 1-in-a-trillion case.
 */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'

function randomCode(): string {
  let s = ''
  for (let i = 0; i < 8; i++) s += ALPHABET[randomInt(ALPHABET.length)]
  return `${s.slice(0, 4)}-${s.slice(4)}`
}

/**
 * Generate a code guaranteed unused at call time. Accepts the singleton
 * client or a transaction client (mirrors `nextJobCode`).
 */
export async function generateAssistantAuthCode(
  client: Prisma.TransactionClient,
): Promise<string> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const code = randomCode()
    const clash = await client.job.findUnique({
      where: { assistantAuthCode: code },
      select: { id: true },
    })
    if (!clash) return code
  }
  throw new Error('generateAssistantAuthCode: no unique code after 8 attempts')
}
