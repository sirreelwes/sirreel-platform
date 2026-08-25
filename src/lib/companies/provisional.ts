/**
 * Provisional ("company TBC") companies.
 *
 * An inbound lead often arrives with a person and a request but no
 * production company — Wes 2026-08-25: "how can I send a quick reply if I
 * don't know the company? The agent should be able to enter that info if
 * he has it, or ask the client to fill it out if not."
 *
 * Job.companyId is non-nullable all the way down, so "unknown" has to be
 * represented by something. It's a PER-JOB placeholder named after the
 * contact rather than one shared "Unknown" company: a shared row would
 * pile unrelated jobs under a single client in the CRM, which is worse
 * than the gap it papers over.
 *
 * The suffix is the marker. Anything that needs to know "we don't really
 * have a company here" asks isProvisionalCompanyName() rather than
 * inventing its own test — notably Quick Reply, which offers to ask the
 * client for it, and which would otherwise see a non-empty name and stay
 * quiet.
 *
 * Replaced for real via PATCH /api/jobs/[id]/company once the client says
 * who they are.
 */

export const PROVISIONAL_COMPANY_SUFFIX = '(company TBC)'

export function makeProvisionalCompanyName(input: {
  contactName?: string | null
  jobName?: string | null
}): string {
  const base =
    (input.contactName || '').trim() ||
    (input.jobName || '').trim() ||
    'Unnamed lead'
  return `${base} ${PROVISIONAL_COMPANY_SUFFIX}`
}

export function isProvisionalCompanyName(name: string | null | undefined): boolean {
  return !!name && name.trim().endsWith(PROVISIONAL_COMPANY_SUFFIX)
}
