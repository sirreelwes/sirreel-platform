/**
 * The email that carries the counsel review link — ONE renderer, used by the
 * preview and by the send.
 *
 * Wes, 2026-09-18: "Where is the review of the email to Marell?" It did not
 * exist. The first cut composed the body inside the POST, so the only thing
 * on screen before sending was the note box — for a message going to the
 * client's LAWYER, which is the last message in HQ that should go out
 * unseen. Every other client-facing send has a review step.
 *
 * The rule this file exists to keep is the partner-welcome one: **the
 * preview IS the mail**, because both call this function. A preview
 * assembled separately from the send is a preview of a different email.
 *
 * And the LINK is added HERE, never by the editable note (`message`). A
 * reviewer trimming a paragraph must not be able to delete the thing the
 * email exists to deliver.
 */

import type { CounselReviewPacket } from '@/lib/contracts/counselReviewPacket'

export interface CounselReviewEmailInput {
  packet: Pick<CounselReviewPacket, 'title' | 'companyName'>
  /** The read-only review URL. Appended by this renderer. */
  url: string
  senderName: string
  recipientName?: string | null
  /** The staffer's own words, replacing the standard two paragraphs. */
  message?: string | null
}

export interface RenderedEmail {
  subject: string
  html: string
  text: string
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export function counselReviewSubject(packet: CounselReviewEmailInput['packet']): string {
  return `${packet.title} — ${packet.companyName}`
}

/** The standard body, when the staffer leaves the note blank. */
export function defaultCounselReviewBody(packet: CounselReviewEmailInput['packet']): string {
  return (
    `Here is the clean copy of the ${packet.title} for ${packet.companyName}, with your changes in place.\n\n` +
    `The page below has the whole agreement, and a button to download it as a Word file if you want to mark it up further. ` +
    `The Word copy is generated from the agreement text itself rather than converted from the PDF, so it should be clean to work in.`
  )
}

export function renderCounselReviewEmail(input: CounselReviewEmailInput): RenderedEmail {
  const { packet, url, senderName } = input
  const greeting = input.recipientName?.trim()
    ? `${input.recipientName.trim().split(/\s+/)[0]},`
    : 'Hello,'
  const body = (input.message?.trim() || defaultCounselReviewBody(packet)).trim()

  const paragraphs = body
    .split(/\n{2,}/)
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, '<br/>')}</p>`)
    .join('')

  return {
    subject: counselReviewSubject(packet),
    html:
      `<p>${escapeHtml(greeting)}</p>` +
      paragraphs +
      // Appended HERE — not in the note above.
      `<p><a href="${url}">Read the agreement and download a copy</a></p>` +
      `<p style="color:#666;font-size:12px">This link opens the current copy — if anything changes, the same link shows the corrected one.</p>` +
      `<p>${escapeHtml(senderName)}<br/>SirReel Studio Services</p>`,
    text:
      `${greeting}\n\n${body}\n\n${url}\n\n` +
      `This link opens the current copy — if anything changes, the same link shows the corrected one.\n\n` +
      `${senderName}\nSirReel Studio Services`,
  }
}
