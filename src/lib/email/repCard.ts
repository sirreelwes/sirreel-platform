/**
 * The rep card in client email — a face, a name, a title and a number,
 * above the button.
 *
 * Wes 2026-09-16: "candid photos of our sales agents … in the HQ emails."
 * The photo already exists in two places and this file is the one rule that
 * decides which one a client sees:
 *
 *   1. The rep's WEEKLY CANDID (`AgentWeeklyCandid`) while it is fresh —
 *      the rep's own photo of themselves, uploaded from the dashboard
 *      widget, and already the picture on the post-job thank-you. This is
 *      the one Wes asked for, so it wins while it is current.
 *   2. Their published "Who we are" HEADSHOT (`TeamMember.photoUrl`) —
 *      curated, admin-managed, and it does not go stale.
 *   3. A weekly candid of ANY age, when there is no headshot at all. An old
 *      candid still shows the person; nothing shows nobody.
 *   4. Nothing — and then NO CARD RENDERS. The card exists to carry a face;
 *      without one it would only repeat the sign-off six lines above it.
 *
 * The ladder is pure and lives here because TWO callers have to agree about
 * it: the composer (which decides whether to draw the card at all) and
 * `/api/public/agent-photo/[id]` (which serves the bytes to the inbox). If
 * they disagreed the email would carry a broken-image icon.
 *
 * Email HTML rules, same as the templates this renders into: table layout,
 * inline styles, absolute URLs, fixed width AND height on the img so a
 * blocked image holds its box instead of collapsing the row.
 */

import { PUBLIC_SITE_URL } from '@/lib/site/publicNav'

const ACCENT = '#0F7A93'

/**
 * How old a weekly candid may be and still outrank a curated headshot.
 * A "weekly" candid from last spring is not what Wes is describing, but it
 * is still a better picture of the person than their initials — hence rung
 * 3 of the ladder rather than a hard cutoff.
 */
export const CANDID_FRESH_DAYS = 45

export interface RepPhotoSources {
  /** The rep's most recent weekly candid, if any. */
  candid: { id: string; capturedAt: Date } | null
  /** Their published Who-we-are row, only when it actually has a photo. */
  headshot: { id: string } | null
}

export type RepPhotoChoice =
  | { source: 'candid'; id: string }
  | { source: 'headshot'; id: string }
  | null

/** The ladder. Pure — same answer in the composer and in the image route. */
export function pickRepPhoto(sources: RepPhotoSources, now: Date): RepPhotoChoice {
  const { candid, headshot } = sources
  if (candid) {
    const ageDays = (now.getTime() - candid.capturedAt.getTime()) / 86_400_000
    if (ageDays <= CANDID_FRESH_DAYS) return { source: 'candid', id: candid.id }
  }
  if (headshot) return { source: 'headshot', id: headshot.id }
  if (candid) return { source: 'candid', id: candid.id }
  return null
}

/**
 * The absolute URL an inbox fetches. `v` pins WHICH photo, so the mail stays
 * a record of the week it was sent rather than silently becoming next
 * month's candid when the client reopens the thread.
 */
export function agentPhotoEmailUrl(userId: string, photoId: string): string {
  return `${PUBLIC_SITE_URL}/api/public/agent-photo/${userId}?v=${encodeURIComponent(photoId)}`
}

export interface RepCard {
  name: string
  /** TeamMember.title, else User.displayTitle. Omitted when neither. */
  title: string | null
  phone: string | null
  email: string | null
  /** Absolute, public, raster. Null means: do not render the card. */
  photoUrl: string | null
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * The card, as one `<tr>` for a 600px email table. Returns '' when there is
 * no photo — callers can splice the result in unconditionally.
 *
 * The crop is a ROUNDED RECTANGLE, not a circle, on purpose: Outlook's Word
 * engine ignores border-radius, so a circle arrives square there and the
 * same mail reads as two different designs. 8px degrades to a square corner
 * nobody notices.
 */
export function repCardHtml(rep: RepCard | null): string {
  if (!rep || !rep.photoUrl) return ''
  const name = esc(rep.name)
  const contact: string[] = []
  if (rep.phone) {
    contact.push(
      `<a href="tel:${esc(rep.phone.replace(/[^\d+]/g, ''))}" style="color:#555555;text-decoration:none;">${esc(rep.phone)}</a>`,
    )
  }
  if (rep.email) {
    contact.push(
      `<a href="mailto:${esc(rep.email)}" style="color:#9a9a9a;text-decoration:none;">${esc(rep.email)}</a>`,
    )
  }

  return `
          <tr>
            <td style="padding:6px 36px 14px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#f3f8f9;border-left:3px solid ${ACCENT};">
                <tr>
                  <td style="padding:16px 18px;">
                    <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td width="72" style="width:72px;padding-right:16px;vertical-align:top;">
                          <img src="${esc(rep.photoUrl)}" alt="${name}" width="72" height="72" style="display:block;width:72px;height:72px;border:0;outline:none;text-decoration:none;border-radius:8px;" />
                        </td>
                        <td style="vertical-align:top;font-size:14px;line-height:1.55;color:#444444;">
                          <div style="font-size:10px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:${ACCENT};">Your SirReel rep</div>
                          <div style="margin-top:3px;font-size:16px;font-weight:700;color:#1a1a1a;">${name}</div>
                          ${rep.title ? `<div style="color:#777777;font-size:13px;">${esc(rep.title)}</div>` : ''}
                          ${contact.length ? `<div style="margin-top:5px;font-size:13px;">${contact.join('<span style="color:#cccccc;"> &nbsp;&middot;&nbsp; </span>')}</div>` : ''}
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>`
}
