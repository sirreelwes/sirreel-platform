/**
 * Driver's-licence reader.
 *
 * WHAT THIS DOES: reads the printed data off the card with Claude vision
 * and returns it as structured fields, plus the one check that can be
 * made offline — whether the printed expiry date has passed.
 *
 * WHAT THIS DOES NOT DO — and cannot: tell you whether the licence is
 * VALID. Suspension, revocation and cancellation live with the issuing
 * state's DMV and are not on the card. A card can read perfectly and
 * still be suspended. Confirming real status needs a Motor Vehicle
 * Record check through a third-party service (Samba Safety, Checkr and
 * similar), which is a paid integration with consent obligations under
 * the DPPA. Nothing here should be presented to staff as "valid" —
 * the UI says "read OK" / "expired", never "valid".
 *
 * AND IT CAN MISREAD. On 2026-09-16 a Class A CDL good through 07/08/2029,
 * photographed sideways on top of a check-out sheet, came back expiring
 * 02/08/2025 with the date of birth's digits in the licence-number field.
 * Everything downstream therefore treats a read as a PROPOSAL: until a
 * human has looked, an expiry in the past reads as "check date", not
 * "expired", and staff can overrule any field
 * (POST /api/drivers/[id]/license-details). See licenseGate.ts.
 *
 * On the back barcode: US licences carry a PDF417 barcode encoding the
 * same fields (AAMVA standard). A real barcode DECODER (not a vision
 * model) can read it, which is useful mainly as a tamper cross-check —
 * printed front disagreeing with the encoded back is a red flag. We
 * store the back image so that check can be added later without asking
 * every driver to re-upload; we do not attempt to decode it here.
 */

import Anthropic from '@anthropic-ai/sdk'
import { REVIEW_MODEL } from '@/lib/ai/models'
import { parseAiJson } from '@/lib/ai/extractJson'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const LICENSE_PROMPT = `You are reading a US driver's license for a vehicle rental company's driver file.

Read ONLY what is printed on the card. Do not guess or infer missing values — use null for anything you cannot read clearly. A null costs someone thirty seconds of typing; a confident wrong read gets a driver with a valid license turned away at the gate.

How these photos arrive: taken on a phone, often ROTATED 90 or 180 degrees, at an angle, laid on top of other paperwork, with glare across the laminate. Work out the card's orientation first and read it the right way up. Read every value from its printed LABEL, never from where it sits on the card.

Labels to go by:
- DL (or DLN / LIC NO) — the license number. Not any other number on the card: US licenses also carry an audit/document number, and some states print the date of birth again as a bare 8-digit string under the photo. If the only candidate you can read is the date of birth's digits, the license number is not legible: return null.
- EXP — expiry. ISS (or the date beside a small "issued") — issue date. DOB — date of birth. Three dates that look alike; confirm each against its own label.
- CLASS, END (endorsements), RSTR (restrictions).

Cross-checks before you answer — if one fails, read that field again and return null if it is still not legible:
- Expiry must be AFTER the issue date. An expiry before the issue date means you have misread a digit or crossed two fields.
- Most US licenses expire on the holder's birthday, so the expiry usually shares its month and day with the date of birth. If yours does not, look again.
- A license someone is presenting is usually current. An expiry in the past is possible but uncommon — re-read it before reporting one.

Return ONLY valid JSON, no markdown:
{
  "readable": true/false,
  "isDriversLicense": true/false,
  "side": "front" | "back" | "unclear",
  "firstName": "",
  "lastName": "",
  "licenseNumber": "",
  "state": "two-letter state code",
  "dateOfBirth": "MM/DD/YYYY",
  "issueDate": "MM/DD/YYYY",
  "expiryDate": "MM/DD/YYYY",
  "licenseClass": "e.g. C, A, B",
  "endorsements": "",
  "restrictions": "",
  "isCommercial": true/false,
  "isRealId": true/false,
  "notes": "anything that looks off — damage, glare, obscured fields, rotation, signs of tampering, any cross-check above that you could not satisfy"
}`

export interface LicenseRead {
  readable: boolean
  isDriversLicense: boolean
  firstName: string | null
  lastName: string | null
  licenseNumber: string | null
  state: string | null
  dateOfBirth: string | null
  expiryDate: string | null
  licenseClass: string | null
  endorsements: string | null
  restrictions: string | null
  isCommercial: boolean | null
  notes: string | null
  [k: string]: unknown
}

/** MM/DD/YYYY -> Date, or null. Returns null on anything unparseable. */
export function parseCardDate(v: unknown): Date | null {
  if (typeof v !== 'string') return null
  const m = v.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (!m) return null
  const d = new Date(Number(m[3]), Number(m[1]) - 1, Number(m[2]))
  return Number.isNaN(d.getTime()) ? null : d
}

/**
 * Expiry check — the only real verification available offline.
 * Returns null when the card's expiry could not be read at all, so the
 * UI can say "unknown" rather than implying the licence is current.
 */
export function isExpired(expiryDate: unknown, now = new Date()): boolean | null {
  const d = parseCardDate(expiryDate)
  if (!d) return null
  // Licences are good through the end of the printed day.
  d.setHours(23, 59, 59, 999)
  return d.getTime() < now.getTime()
}

export async function readLicenseImage(args: {
  data: Buffer
  mimeType: string
}): Promise<LicenseRead> {
  const mediaType = args.mimeType.includes('png')
    ? 'image/png'
    : args.mimeType.includes('webp')
      ? 'image/webp'
      : 'image/jpeg'
  const response = await client.messages.create({
    model: REVIEW_MODEL,
    max_tokens: 1000,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image' as const,
            source: {
              type: 'base64' as const,
              media_type: mediaType as 'image/png' | 'image/jpeg' | 'image/webp',
              data: args.data.toString('base64'),
            },
          },
          { type: 'text' as const, text: LICENSE_PROMPT },
        ],
      },
    ],
  })
  const text = response.content[0].type === 'text' ? response.content[0].text : ''
  return parseAiJson<LicenseRead>(text, { tag: 'driver-license', stopReason: response.stop_reason })
}
