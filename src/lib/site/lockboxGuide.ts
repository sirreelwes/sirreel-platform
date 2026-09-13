/**
 * How to open a SirReel vehicle lock box — one source of truth.
 *
 * Origin (Wes, 2026-09-13): May, a contact on Miki's job, could not get the
 * lock box open. Jose typed the steps by hand and texted her a photo of the
 * keypad with the two buttons arrowed. Wes: "I think we should incorporate
 * this into AHA's capabilities." So AHA now sends the same photo and the
 * same words, and the photo lives at a public URL a text can carry.
 *
 * THE PHOTO IS PUBLIC ON PURPOSE. Twilio FETCHES an MMS attachment from the
 * URL we hand it, unauthenticated, from its own servers — a blob behind the
 * private proxy would 403 and the picture would silently not arrive. That is
 * safe here because the image is a keypad with arrows on it: it shows how a
 * lock box opens, never a code. No code, gate or lock box, may ever be
 * rendered on this page, baked into an image, or put in a caption. Codes come
 * only from verifyAndRelease, one at a time, in their own message.
 *
 * STEPS is Jose's wording, verbatim — he wrote it standing at the truck and
 * it is the sentence that worked.
 */

import { PUBLIC_SITE_URL } from '@/lib/site/publicNav'

/** Jose's instruction, as he typed it to May. */
export const LOCKBOX_STEPS = 'Start by sliding down the clear button, enter code and then push down at the top button to open.'

/** Path of the keypad photo under /public. Served by Next as a static file. */
export const LOCKBOX_PHOTO_PATH = '/help/lockbox-keypad.jpg'

/** Public page with the photo, the steps and what to try when it won't open. */
export const LOCKBOX_GUIDE_PATH = '/help/lockbox'

/**
 * Absolute URLs. Built from PUBLIC_SITE_URL rather than written out, for the
 * reason setupGuides.ts gives: a hardcoded sirreel.com link shipped once and
 * 404'd, because the apex still redirects to the old www.
 */
export function lockboxPhotoUrl(): string {
  return `${PUBLIC_SITE_URL}${LOCKBOX_PHOTO_PATH}`
}

export function lockboxGuideUrl(): string {
  return `${PUBLIC_SITE_URL}${LOCKBOX_GUIDE_PATH}`
}

/**
 * The caption that rides with the photo. Deliberately short — it is read on a
 * phone, under a picture, usually in the dark at the back of a truck — and it
 * carries the link so the message is still useful if the carrier strips the
 * media or the number turns out not to be MMS-capable.
 */
export function lockboxPhotoCaption(): string {
  return `${LOCKBOX_STEPS} Photo and more help: ${lockboxGuideUrl()}`
}

/** The text-only version, for a channel with no picture (web chat, or a
 *  failed MMS). Same words, same link, no promise of a photo. */
export function lockboxTextOnly(): string {
  return `${LOCKBOX_STEPS} Step-by-step with a photo: ${lockboxGuideUrl()}`
}

/**
 * What to try when the code is right and it still won't open. Rendered on the
 * page and summarised into the assistant's prompt, so the page and AHA can't
 * drift. Nothing here needs a code or a tool.
 */
export const LOCKBOX_TROUBLESHOOTING: Array<{ q: string; a: string }> = [
  {
    q: 'Nothing happens when I push the top button',
    a: 'The clear button — the sliding one in the middle — has to go down FIRST, every time. It wipes whatever was pressed before, including your own earlier tries. Slide it down, enter the code, then push the top button down.',
  },
  {
    q: 'I entered the code and it still will not open',
    a: 'Slide the clear button down and go again slowly, pressing each number until it clicks all the way down. A digit that does not click is the usual reason a correct code does not open the box.',
  },
  {
    q: 'The buttons feel stiff',
    a: 'These boxes live outside in the weather. Press harder than feels necessary, one button at a time, and listen for the click.',
  },
  {
    q: 'I am not sure I have the right code',
    a: 'Do not keep guessing. Text AHA at the number below with the unit you are at (for example "Cube 27") and it will confirm the code for your job.',
  },
  {
    q: 'Still stuck',
    a: 'Text AHA and say which unit you are at and what the box is doing. After hours, AHA can reach the on-call team for you.',
  },
]
