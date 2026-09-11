/**
 * The sender's number as a verification factor — text channel only.
 *
 * Wes 2026-09-10: a driver texting from "the driver's number that is on
 * file and that is listed on a current job" should not need the job code.
 * Possession of the phone that HQ has on file for that job is stronger
 * evidence than a typed name, which the legacy unit+name path already
 * accepts. It still needs the vehicle (VIN last 4 or unit number) so
 * exactly one lockbox is released, and the number is checked ONLY against
 * the drivers and contacts on the live assignment the truck belongs to —
 * a number on file for a different job unlocks nothing.
 *
 * "Contacts" is deliberate (Wes, same day): the production team on the job
 * — producer, PM, coordinator, transpo — count too, so a PM texting from
 * their number on file can get a truck's codes on behalf of their driver.
 *
 * Pure: compares the last ten digits, which is how every US number on file
 * ends up regardless of how it was typed ("(818) 515-2389", "+18185152389").
 */
export function phoneTail(raw: string | null | undefined): string | null {
  const digits = (raw ?? '').replace(/\D/g, '')
  if (digits.length < 10) return null
  return digits.slice(-10)
}

/** Is the sender one of the numbers on file? Empty or short candidates never match. */
export function phoneOnFile(sender: string | null | undefined, candidates: Array<string | null | undefined>): boolean {
  const s = phoneTail(sender)
  if (!s) return false
  return candidates.some((c) => phoneTail(c) === s)
}
