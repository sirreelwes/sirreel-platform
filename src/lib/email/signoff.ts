/**
 * How SirReel signs off to a client.
 *
 * Wes, 2026-09-01, on the COI fix-request: "the request fix email is
 * signed SirReel Production Vehicles in email and should only be The
 * SirReel Team or SirReel Studio Services."
 *
 * "SirReel Production Vehicles, Inc." is the LEGAL ENTITY. It belongs on
 * a certificate of insurance, a contract, and the schema.org record — and
 * it must keep appearing in COI requirement text, where naming anything
 * else would make the certificate invalid. It is not how we talk to a
 * client at the bottom of an email.
 *
 * Every other client-facing template already signs off as SirReel Studio
 * Services; two did not, and both were hand-written strings rather than a
 * shared value. This is that shared value, so the next one cannot drift.
 */
export const CLIENT_SIGNOFF = 'SirReel Studio Services'
