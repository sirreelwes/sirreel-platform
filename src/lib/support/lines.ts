/**
 * The two numbers a client can use, and what each one is actually good for.
 *
 * Wes 2026-09-12, reading a client portal: "Text AHA (After Hours Assistant)
 * 24/7 and the number. The 888 line is really only during hours." The portal
 * had been labelling the office line "After-hours", which is the one promise
 * it cannot keep — a client locked out at 11pm called it and reached nobody.
 *
 * AHA answers texts around the clock (src/lib/sms/threads.ts). Its number is
 * the Twilio number in TWILIO_FROM_NUMBER, read at request time so the portal
 * cannot drift from the number that actually receives the message; the
 * constant below is only the fallback for a dev box with no Twilio env.
 *
 * SERVER-SIDE. Client components take these as props from a payload — never
 * import this into a `'use client'` file, or the env read lands in the bundle.
 */

/** Business hours. A human answers; nobody does at night. */
export const OFFICE_LINE = '(888) 477-7335'

/** Fallback only — production reads TWILIO_FROM_NUMBER. */
const AHA_SMS_FALLBACK = '(747) 335-1665'

/** (747) 335-1665 from +17473351665; anything unexpected is left alone. */
export function formatUsPhone(raw: string): string {
  const d = raw.replace(/\D/g, '')
  const ten = d.length === 11 && d.startsWith('1') ? d.slice(1) : d
  if (ten.length !== 10) return raw
  return `(${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6)}`
}

/** The number to text AHA on, as a person would write it. */
export function ahaSmsNumber(): string {
  const env = process.env.TWILIO_FROM_NUMBER
  return env ? formatUsPhone(env) : AHA_SMS_FALLBACK
}

export interface SupportLines {
  /** Text AHA — 24/7. */
  aha: string
  /** Call the office — business hours. */
  office: string
}

export function supportLines(): SupportLines {
  return { aha: ahaSmsNumber(), office: OFFICE_LINE }
}
