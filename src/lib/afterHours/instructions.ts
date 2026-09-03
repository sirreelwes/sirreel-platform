/**
 * After-hours equipment pickup / drop-off — the one place the facts live.
 *
 * ── What this replaces ──────────────────────────────────────────────────
 * A PDF. "Afer Hours EQ P:R.pdf" (the typo is in the filename), attached by
 * hand to client email — Jose sent it again on 2026-09-02. It carries the
 * lot address, the business hours, the Gate-1 code, the storage-container
 * code and four lines of instructions, all rendered into a picture, all
 * frozen at "V01/13/2023" in the corner. When the gate code is reprogrammed
 * every copy in every client's inbox is silently wrong, and every copy that
 * was ever right is still forwardable to anyone.
 *
 * So the facts live here as DATA, read fresh on every render:
 *   - the codes come from SiteSetting (the same rows the after-hours
 *     assistant and /admin/assistant already read and write), so
 *     reprogramming the gate is one edit and every surface follows;
 *   - the address / hours / phone come from the public-site constants;
 *   - the instructions are prose in one export, not baked into an image.
 *
 * ── Who may call `afterHoursPayload` ────────────────────────────────────
 * It returns access codes. It is NOT a public read. Every caller must have
 * already decided the audience is entitled:
 *   - the staff route, behind a staff session;
 *   - the portal route, behind a job portal session AND
 *     Job.afterHoursReleasedAt.
 * There is no third caller, and a new one is a security decision, not a
 * refactor. `afterHoursStandingInfo` is the safe half — everything except
 * the codes — for anywhere that wants to describe the arrangement without
 * releasing it.
 */

import { prisma } from '@/lib/prisma'
import { PUBLIC_CONTACT, PUBLIC_SITE_URL } from '@/lib/site/publicNav'
import { YARD_HOURS } from '@/lib/site/yardHours'

const SINGLETON = 'singleton'

/**
 * Yard hours. Defined in src/lib/site/yardHours.ts — which is prisma-free,
 * so the quote PDF and the client portal can read the same hours without
 * pulling this module's PrismaClient in with them. Kept exported under this
 * name because every after-hours caller already uses it.
 */
export const AFTER_HOURS_SCHEDULE = YARD_HOURS

/** The staffed line, and the hours a human actually answers it. */
export const AFTER_HOURS_SUPPORT = {
  phone: PUBLIC_CONTACT.phone,
  phoneHref: PUBLIC_CONTACT.phoneHref,
  staffedHours: '7:30 AM – 5:30 PM, Monday through Friday',
  /** The 24/7 assistant — it can verify a caller and release codes itself. */
  helpUrl: `${PUBLIC_SITE_URL}/help`,
} as const

export const AFTER_HOURS_LOCATION = {
  entity: PUBLIC_CONTACT.entity,
  street: '8500 Lankershim Blvd',
  cityStateZip: 'Sun Valley, CA 91352',
  /** Not the mailing address — the gate a driver actually drives to. */
  gateName: 'Gate 1, off Kewen Ave.',
  mapsUrl:
    'https://www.google.com/maps/search/?api=1&query=' +
    encodeURIComponent('8500 Lankershim Blvd, Sun Valley, CA 91352'),
} as const

/**
 * The standing arrival steps. Ordered as a driver meets them: get onto the
 * lot, find the container, open it. The two `code` steps render the value
 * only when the payload carries one — a step that says "the code is —" is
 * worse than no step, because a driver at 5:30 AM will read it as "there is
 * no code" rather than "nobody recorded it".
 */
export type AfterHoursStep =
  | { kind: 'text'; text: string }
  | { kind: 'code'; text: string; code: string | null; codeLabel: string }

export function afterHoursSteps(codes: {
  gateCode: string | null
  containerCode: string | null
}): AfterHoursStep[] {
  return [
    { kind: 'text', text: `Enter through ${AFTER_HOURS_LOCATION.gateName}` },
    {
      kind: 'code',
      text: 'Enter the gate code on the keypad, then hold #.',
      code: codes.gateCode,
      codeLabel: 'Gate code',
    },
    {
      kind: 'text',
      text: 'The storage container is directly to your left as you come through Gate 1.',
    },
    {
      kind: 'code',
      text: 'Open the container with the container code.',
      code: codes.containerCode,
      codeLabel: 'Storage container code',
    },
  ]
}

/** The two halves of the errand, kept apart because the mistakes differ. */
export const AFTER_HOURS_RULES = {
  droppingOff:
    'Take a photo of the equipment where you left it and send it to your SirReel rep. That photo is your receipt — it is how we date the return.',
  pickingUp:
    'Take only what is on your order. Double-check before you leave: anything else in the container belongs to another production that is counting on it being there.',
} as const

/** Everything about the arrangement EXCEPT the codes. Safe anywhere. */
export function afterHoursStandingInfo() {
  return {
    location: AFTER_HOURS_LOCATION,
    schedule: AFTER_HOURS_SCHEDULE,
    support: AFTER_HOURS_SUPPORT,
    rules: AFTER_HOURS_RULES,
  }
}

export interface AfterHoursPayload extends ReturnType<typeof afterHoursStandingInfo> {
  gateCode: string | null
  containerCode: string | null
  steps: AfterHoursStep[]
  /** True when both codes are on file. False means an operator has to fix
   *  something before this is worth sending to anybody. */
  complete: boolean
}

/**
 * The full payload, codes included. Read the module header before adding a
 * caller: this releases access codes and the entitlement check belongs to
 * the caller, not here.
 */
export async function afterHoursPayload(): Promise<AfterHoursPayload> {
  const s = await prisma.siteSetting.findUnique({
    where: { id: SINGLETON },
    select: { gateCode: true, containerCode: true },
  })
  const gateCode = s?.gateCode?.trim() || null
  const containerCode = s?.containerCode?.trim() || null
  return {
    ...afterHoursStandingInfo(),
    gateCode,
    containerCode,
    steps: afterHoursSteps({ gateCode, containerCode }),
    complete: !!gateCode && !!containerCode,
  }
}
