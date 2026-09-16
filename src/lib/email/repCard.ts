/**
 * The rep card in client email — a face, a name, a title and a number,
 * above the button.
 *
 * Wes 2026-09-16: "candid photos of our sales agents … in the HQ emails",
 * then, once it was built: "for now let's just include the photos from who
 * we are page." So the card's photo is ONE source — the person's published
 * "Who we are" row (`TeamMember.photoUrl`), uploaded and curated on
 * /admin/who-we-are and linked to their HQ login there.
 *
 * WHY THAT AND NOT THE WEEKLY CANDID. The candid (`AgentWeeklyCandid`) is a
 * better picture for this — it is what Wes asked for originally — but it
 * only exists once a rep uploads one, and it goes stale by design. The
 * roster photos are already on file, already approved for the public site,
 * and do not rot. "For now" is doing real work in that sentence: the candid
 * plumbing is untouched and still carries the post-job thank-you, so
 * promoting it back to the card later is a change to `pickRepPhoto` and
 * nothing else.
 *
 * No published photo means NO CARD RENDERS. The card exists to carry a face;
 * without one it would only repeat the sign-off a few lines below it.
 *
 * Email HTML rules, same as the templates this renders into: table layout,
 * inline styles, absolute URLs, fixed width AND height on the img so a
 * blocked image holds its box instead of collapsing the row.
 */

import { PUBLIC_SITE_URL } from '@/lib/site/publicNav'

const ACCENT = '#0F7A93'

export interface RepPhotoSources {
  /** Their published Who-we-are row, only when it actually has a photo. */
  headshot: { id: string } | null
}

export type RepPhotoChoice = { source: 'headshot'; id: string } | null

/**
 * Which photo the card carries. One source today (see the header), kept as a
 * named function because TWO callers must agree about it: the composer, which
 * decides whether to draw the card at all, and `/api/public/agent-photo/[id]`,
 * which serves the bytes to the inbox. If they disagreed the email would
 * carry a broken-image icon.
 */
export function pickRepPhoto(sources: RepPhotoSources): RepPhotoChoice {
  return sources.headshot ? { source: 'headshot', id: sources.headshot.id } : null
}

/**
 * The absolute URL an inbox fetches. `v` pins WHICH photo, so a mail stays a
 * record of the picture it was sent with rather than silently changing when
 * the photo behind it is replaced and the client reopens the thread. Also
 * used by the thank-you, whose photo IS a weekly candid.
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
