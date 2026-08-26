/**
 * TSX welcome email — two modes, same brand shell.
 *
 *   mode = 'welcome-only'        — first-touch welcome to TSX with
 *                                  no quote attached (e.g., generic
 *                                  intro after a referral / event).
 *   mode = 'welcome-with-quote'  — welcome + quote snapshot block
 *                                  with a portal-link CTA. The PDF is
 *                                  NOT attached — the portal page
 *                                  surfaces "Download quote PDF"
 *                                  inside, which is the lighter and
 *                                  more reliable path for big PDFs
 *                                  on phone inboxes.
 *
 * Visual treatment matches the thank-you template (`thankYouTemplate.ts`):
 *   - slate header (#0f172a) with SirReel logo left + a Bradley Hand
 *     "Welcome" badge on a -20° tilt right
 *   - warm body copy
 *   - quote snippet block (when present): gold left-border, big amber
 *     CTA button to the portal job URL
 *   - gold-rule-framed `T S X - T H E  S I R R E E L  E X P E R I E N C E`
 *     tagline above the footer
 *   - sign-off: `<agent name>` + `& Team SirReel` (no displayTitle)
 *
 * ⚠️  PLACEHOLDER COPY — NEEDS WES REVIEW BEFORE FIRST REAL SEND  ⚠️
 *     Look for `[[PLACEHOLDER]]` markers throughout for every spot
 *     that carries placeholder language.
 */

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

const ACCENT = '#D4A547'
const HEADER_BG = '#0f172a'
const TEXT = '#1f2937'
const MUTED = '#6b7280'
const CTA_BG = '#D97706' // amber-600, matches portal page buttons

export type TsxWelcomeMode = 'welcome-only' | 'welcome-with-quote' | 'availability'

/** Quick Reply availability-confirmation content, rendered in the SAME brand
 *  shell as the welcome/quote modes (one template, no fork). */
export interface TsxAvailabilityBlock {
  /** Job / production / client label for the opener + subject. */
  jobName: string
  /** Human date range for the subject, e.g. "Aug 12 – Aug 15, 2026". null
   *  when the inquiry dates couldn't be parsed. */
  dateRange: string | null
  /** The two-tier availability sentence picked from live fleet utilization
   *  (see src/lib/sales/quickReply.ts). This is the ONLY availability
   *  statement in the email — never counts, percentages, or category names. */
  availabilityMessage: string
  /** When true the message REPLACES the templated opener (the non-committal
   *  tier already opens with its own "Thanks for reaching out"). When false
   *  (positive tier) the opener stays and the message renders as its own
   *  paragraph. */
  messageReplacesOpener?: boolean
  /** The production supply-order link (orders.sirreel.com). */
  suppliesUrl: string
  /**
   * Set when the agent actually placed a soft hold (Wes 2026-08-25: "if the
   * agent chooses to hold, the email should reflect that"). The WINDOW; what
   * is being held is named by `requestedItems` below.
   */
  heldRange?: string | null
  /**
   * The vehicle/stage CATEGORIES the reply covers, pre-labelled ("2 × Cube
   * Truck"). Named to the client since 2026-08-26: "We've set your equipment
   * aside" told them nothing, and a client who asked for a liftgate has no
   * way to catch it if we heard something else.
   *
   * Still a category, never a unit — dispatch swaps trucks within a category
   * all the time, so naming one would be a promise we don't make. The
   * quantities are the client's own, echoed back; OUR fleet numbers stay
   * rep-only, as does which categories are tight.
   */
  requestedItems?: string[]
  /** Supplies / gear riding along on the vehicle ("10 × Ratchet Strap"). */
  supplyItems?: string[]
  /** Fold a request for ONLY the missing field(s) into the reply. Set per
   *  field so we never ask for something we already have. */
  askForCompany?: boolean
  /** One-tap /details/<token> link for the ask. Email cannot carry working
   *  input fields (Gmail strips <form>), so the nearest thing is a link to
   *  a page with the two fields on it — the answer then arrives structured
   *  instead of as prose someone has to re-key. Null falls back to the
   *  plain "just reply with those" wording, which still works. */
  detailsUrl?: string | null
  askForJob?: boolean
  /** Rep's own message — REPLACES the templated opener prose while the
   *  greeting, the tier availability message + supply CTA, and the sign-off
   *  stay intact. Plain text; newlines become paragraph breaks. */
  customBody?: string | null
}

export interface TsxWelcomeQuoteBlock {
  /** Order number — surfaces in the snapshot block. */
  orderNumber: string
  /** Job / show / project name. */
  jobName: string
  /** Pickup date ISO; null when undecided at quote time. */
  startDate: string | null
  /** Return date ISO; null when undecided at quote time. */
  endDate: string | null
  /** Pre-tax subtotal. Optional — when null the snapshot only shows the total. */
  subtotal: number | null
  /** Grand total including tax. */
  total: number
  /** Tokenized portal URL — the big "View quote" CTA goes here. May
   *  be `null` in preview mode (the template collapses the CTA and
   *  shows a "secured at send time" annotation in its place). */
  portalUrl: string | null
}

export interface TsxWelcomeTemplateInput {
  mode: TsxWelcomeMode
  clientFirstName: string | null
  clientFullName: string | null
  agentName: string
  agentEmail: string
  agentPhone: string | null
  /** Optional single-line personal note from the rep — renders above
   *  the body in the same italic-with-gold-border style as the
   *  thank-you's personal note. */
  personalNote: string | null
  /** Required when mode='welcome-with-quote'. Ignored otherwise. */
  quote: TsxWelcomeQuoteBlock | null
  /** Required when mode='availability'. Ignored otherwise. */
  availability?: TsxAvailabilityBlock | null
}

export interface RenderedEmail {
  subject: string
  html: string
  text: string
}

function fmtUsd(n: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(n)
}

function fmtDate(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (!Number.isFinite(d.getTime())) return ''
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })
}

function rangeLine(start: string | null, end: string | null): string {
  const s = fmtDate(start)
  const e = fmtDate(end)
  if (s && e) return `${s} – ${e}`
  if (s) return s
  if (e) return e
  return 'Dates TBD'
}

export function buildTsxWelcomeEmail(input: TsxWelcomeTemplateInput): RenderedEmail {
  // First-name only, from whichever field is present. Always take the first
  // whitespace token (so a full name passed as clientFirstName still yields
  // just the first name). Fall back to "there" for empty OR email-looking
  // input — never render "Hi ," or "Hi <email>,". Capitalize a fully-lowercase
  // token (colin → Colin) while preserving mixed case (McDonald, O'Brien).
  const rawName = (input.clientFirstName?.trim() || input.clientFullName?.trim() || '')
  const firstToken = rawName.split(/\s+/)[0] || ''
  const first =
    firstToken && !firstToken.includes('@')
      ? (firstToken === firstToken.toLowerCase()
          ? firstToken.charAt(0).toUpperCase() + firstToken.slice(1)
          : firstToken)
      : 'there'
  const safeFirst = escapeHtml(first)
  const safeAgentName = escapeHtml(input.agentName)
  const safeNote = input.personalNote?.trim() ? escapeHtml(input.personalNote.trim()) : null
  const safePhone = input.agentPhone ? escapeHtml(input.agentPhone) : null

  const withQuote = input.mode === 'welcome-with-quote' && !!input.quote
  const withAvailability = input.mode === 'availability' && !!input.availability
  const q = input.quote
  const av = input.availability

  // Subject — reviewed by Wes 2026-08-23.
  //
  // The quote subject says SIRREEL, not TSX (Wes, from a live client
  // reply reading "Re: Your TSX quote for The Watch Party"): TSX is the
  // name of the client PORTAL experience, and a quote is not a portal
  // thing. A subject line is also often the first words a new client
  // ever reads from us — it has to be the name they recognize. The
  // follow-up cadence templates already said "SirReel quote"; this was
  // the one outlier. The welcome-only subject keeps TSX on purpose —
  // that email exists to introduce the portal brand.
  const subject = withAvailability
    ? `Re: ${av!.jobName} — availability${av!.dateRange ? ` for ${av!.dateRange}` : ''}`
    : withQuote
      ? `Your SirReel quote for ${q!.jobName}`
      : `Welcome to TSX — The SirReel Experience`

  // [[PLACEHOLDER]] body copy — Wes review.
  const greeting = `Hi ${safeFirst},`
  const welcomeOpener = `Thanks for reaching out — really glad we get to work on this one with you. <strong>TSX (The SirReel Experience)</strong> is how we describe everything beyond just the rental: the warehouse crew that preps your gear, the fleet that shows up clean and on time, the team you can text at 11pm when something on set changes.`
  const quoteOpener = `Thanks for reaching out — really glad we get to work on this with you. I put together a first pass on your quote; it's waiting for you on your client portal along with everything else we'll need for the job.`
  const availabilityOpener = `Thanks for reaching out about <strong>${escapeHtml(av?.jobName ?? '')}</strong> — happy to help get this on the calendar.`
  // Custom-message mode: the rep's own prose REPLACES the templated opener —
  // but the greeting, tier availability message + supply CTA, and sign-off
  // all stay. Plain text → HTML paragraphs.
  const customBody = withAvailability ? av!.customBody?.trim() || null : null
  const customBodyHtml = customBody
    ? customBody.split(/\n{2,}/).map((para) => escapeHtml(para.trim()).replace(/\n/g, '<br/>')).filter(Boolean).join('</p><p style="font-size: 16px; color: ' + TEXT + '; margin: 12px 0 0; line-height: 1.6;">')
    : null
  // ORDER (Wes, 2026-08-12): the standard sentence opens EVERY quick reply,
  // and the rep's own words follow it. It used to be the other way round —
  // the rep's prose became the opener and the templated line landed
  // underneath, which read as an afterthought and produced a doubled
  // greeting whenever a rep began with "Hi <name>".
  // The rep's text is the WHOLE body when present — they are handed the
  // standard wording prefilled and may edit or delete any of it. With nothing
  // written, the standard line renders, so the box and the sent email match.
  const opener = withAvailability
    ? (customBodyHtml ?? escapeHtml(av!.availabilityMessage))
    : withQuote ? quoteOpener : welcomeOpener

  // No longer a separate paragraph — customBody IS the opener above.
  const repBodyHtml: string | null = null

  // The tier line no longer needs a paragraph of its own — it IS the opener.
  const showAvailabilityMessage = false

  const closer = withAvailability
    ? '' // the tier message carries its own next step
    : withQuote
      ? `Take a look when you have a minute. If anything's off — vehicle count, dates, supplies, anything — just hit reply and I'll get it sorted.`
      : `When you're ready to book something, just send me the details and I'll spin up a quote.`

  const personalNoteBlock = safeNote
    ? `
      <tr>
        <td style="padding: 0 32px 16px;">
          <p style="font-size: 16px; line-height: 1.6; color: ${TEXT}; margin: 0; font-style: italic; border-left: 3px solid ${ACCENT}; padding-left: 12px;">${safeNote}</p>
        </td>
      </tr>`
    : ''

  const quoteBlock = withQuote
    ? `
      <tr>
        <td style="padding: 16px 32px 4px;">
          <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="border: 1px solid #e5e7eb; border-radius: 12px; overflow: hidden;">
            <tr>
              <td style="padding: 20px 24px; border-bottom: 1px solid #f3f4f6;">
                <div style="font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase; color: ${MUTED}; margin: 0 0 6px;">Your quote</div>
                <div style="font-size: 18px; font-weight: 600; color: ${TEXT}; margin: 0 0 4px;">${escapeHtml(q!.jobName)}</div>
                <div style="font-size: 13px; color: ${MUTED}; margin: 0;">Order ${escapeHtml(q!.orderNumber)} · ${escapeHtml(rangeLine(q!.startDate, q!.endDate))}</div>
              </td>
            </tr>
            <tr>
              <td style="padding: 16px 24px;">
                ${q!.subtotal != null
                  ? `<div style="font-size: 13px; color: ${MUTED}; margin: 0 0 2px;">Subtotal <span style="float: right; color: ${TEXT};">${escapeHtml(fmtUsd(q!.subtotal))}</span></div>`
                  : ''}
                <div style="font-size: 16px; font-weight: 700; color: ${TEXT}; margin: 6px 0 0;">Total <span style="float: right;">${escapeHtml(fmtUsd(q!.total))}</span></div>
              </td>
            </tr>
            <tr>
              <td align="center" style="padding: 4px 24px 24px;">
                ${q!.portalUrl
                  ? `<a href="${escapeHtml(q!.portalUrl)}" style="display: inline-block; background-color: ${CTA_BG}; color: #ffffff; padding: 14px 28px; border-radius: 8px; text-decoration: none; font-weight: 700; font-size: 15px;">View quote &amp; portal &rarr;</a>
                     <p style="font-size: 11px; color: ${MUTED}; margin: 10px 0 0;">Includes a Download Quote PDF button inside.</p>`
                  : `<div style="display: inline-block; background-color: #f3f4f6; color: ${MUTED}; padding: 14px 28px; border-radius: 8px; font-weight: 600; font-size: 14px;">Portal link added at send time</div>`}
              </td>
            </tr>
          </table>
        </td>
      </tr>`
    : ''

  // Availability block — the tier message (when not already the opener) + a
  // styled supply-order CTA button (not a raw URL). No per-category counts —
  // that detail is rep-only, in EmailReviewModal.
  // Hold acknowledgement — sits directly under the opener, before the
  // ask-for-details prompt, so the reassurance lands before the request.
  //
  // "Write my own email" is the rep's WHOLE email (Wes 2026-08-26): their
  // words, then the gear/vehicle button, and nothing else. The templated
  // hold read-back and the production-company ask are ours, not theirs —
  // leaving them stapled underneath a hand-written note made the email read
  // like two people wrote it.
  const repWroteIt = withAvailability && !!customBody
  const heldRange = withAvailability && !repWroteIt ? av!.heldRange?.trim() || null : null
  const requestedItems = withAvailability && !repWroteIt ? (av!.requestedItems ?? []).filter((s) => s.trim()) : []
  const supplyItems = withAvailability && !repWroteIt ? (av!.supplyItems ?? []).filter((s) => s.trim()) : []
  // One line reads as a sentence; several read as a list. Either way the
  // categories are spelled out — see `requestedItems` above.
  const itemsInline = requestedItems.map((i) => `<strong>${escapeHtml(i)}</strong>`).join(', ')
  const itemsList = `<ul style="margin: 8px 0 0; padding-left: 20px; font-size: 16px; color: ${TEXT}; line-height: 1.6;">${requestedItems
    .map((i) => `<li style="margin: 0 0 2px;">${escapeHtml(i)}</li>`)
    .join('')}</ul>`
  const suppliesLine = supplyItems.length
    ? `<p style="font-size: 15px; color: ${TEXT}; margin: 8px 0 0; line-height: 1.6;">Coming on the vehicle: <strong>${escapeHtml(
        supplyItems.join(', '),
      )}</strong>.</p>`
    : ''
  const heldSentence = heldRange
    ? requestedItems.length === 0
      ? `We&rsquo;ve set your equipment aside for <strong>${escapeHtml(heldRange)}</strong> while you decide.`
      : requestedItems.length === 1
        ? `We&rsquo;ve set aside your ${itemsInline} for <strong>${escapeHtml(heldRange)}</strong> while you decide.`
        : `We&rsquo;ve set the following aside for <strong>${escapeHtml(heldRange)}</strong> while you decide:${itemsList}`
    : // No hold placed — still read the request back, so a client who asked
      // for something we didn't hear can correct it in one reply instead of
      // discovering it on the quote.
      requestedItems.length === 0
      ? ''
      : requestedItems.length === 1
        ? `Here&rsquo;s what I have from your note: ${itemsInline}.`
        : `Here&rsquo;s what I have from your note:${itemsList}`
  const heldBlock = heldSentence || suppliesLine
    ? `<tr>
        <td style="padding: 12px 32px 0;">
          ${heldSentence ? `<p style="font-size: 16px; color: ${TEXT}; margin: 0; line-height: 1.6;">${heldSentence}</p>` : ''}
          ${suppliesLine}
        </td>
      </tr>`
    : ''

  const availabilityBlock = withAvailability
    ? `
      ${heldBlock}
      ${showAvailabilityMessage
        ? `<tr>
        <td style="padding: 8px 32px 4px;">
          <p style="font-size: 16px; color: ${TEXT}; margin: 0; line-height: 1.6;">${escapeHtml(av!.availabilityMessage)}</p>
        </td>
      </tr>`
        : ''}
      ${(av!.askForCompany || av!.askForJob) && !repWroteIt
        ? `<tr>
        <td style="padding: 14px 32px 0;">
          <p style="font-size: 15px; color: ${TEXT}; margin: 0; line-height: 1.6; border-left: 3px solid ${ACCENT}; padding-left: 12px;">One quick thing for our files — what's the ${
            av!.askForCompany && av!.askForJob
              ? '<strong>production company</strong> and <strong>project name</strong>'
              : av!.askForCompany
                ? '<strong>production company</strong>'
                : '<strong>project name</strong>'
          } for this booking? ${
            av!.detailsUrl
              ? `<a href="${escapeHtml(av!.detailsUrl)}" style="color: ${CTA_BG}; font-weight: 700; text-decoration: underline;">Add ${av!.askForCompany && av!.askForJob ? 'them' : 'it'} here</a> &mdash; or just reply to this email.`
              : `Just reply with th${av!.askForCompany && av!.askForJob ? 'ose' : 'at'} and I'll get everything set up.`
          }</p>
        </td>
      </tr>`
        : ''}
      <tr>
        <td align="center" style="padding: 16px 32px 4px;">
          <!-- The button used to read "Gear and Vehicle Request", which
               confused clients who had JUST made one (Wes 2026-08-26). The
               lead-in says what it is actually for: adding MORE. -->
          <p style="font-size: 15px; color: ${TEXT}; margin: 0 0 10px; line-height: 1.6;">Need more gear or vehicles lined up?</p>
          <a href="${escapeHtml(av!.suppliesUrl)}" style="display: inline-block; background-color: ${CTA_BG}; color: #ffffff; padding: 14px 28px; border-radius: 8px; text-decoration: none; font-weight: 700; font-size: 15px;">Add gear or vehicles &rarr;</a>
        </td>
      </tr>`
    : ''

  const signOff = `${safeAgentName}<br/><span style="color: ${MUTED}; font-size: 14px;">&amp; Team SirReel</span>`

  // Header badge ("Welcome!") — shown on welcome/quote emails; suppressed on
  // the availability (Quick Reply) email, which is a reply, not a welcome. The
  // logo spans the full header width when the badge is gone.
  const showHeaderBadge = !withAvailability
  const headerLogoWidth = showHeaderBadge ? '60%' : '100%'
  const headerBadgeCell = showHeaderBadge
    ? `<td valign="middle" align="right" style="width: 40%;">
                    <span style="
                      display: inline-block;
                      font-family: 'Bradley Hand ITC', 'Bradley Hand', 'Segoe Print', 'Marker Felt', 'Comic Sans MS', cursive;
                      font-size: 22px;
                      font-weight: 700;
                      color: ${ACCENT};
                      transform: rotate(-20deg);
                      -webkit-transform: rotate(-20deg);
                      -ms-transform: rotate(-20deg);
                      text-shadow: 0 1px 0 rgba(0,0,0,0.25);
                      line-height: 1;
                      padding: 0 4px;
                      white-space: nowrap;
                    ">Welcome!</span>
                  </td>`
    : ''

  // TSX tagline — identical small-caps treatment as the thank-you
  // template; same widths and offsets so the two emails feel like
  // they live in the same envelope system.
  const bigCap = (c: string) => `<span style="font-size:13px;">${c}</span>`
  const smCap = (c: string) => `<span style="font-size:10px;">${c}</span>`
  const wordGap = '<span style="display:inline-block;width:10px;">&nbsp;</span>'
  const dashGap = `<span style="font-size:11px;color:rgba(212,165,71,0.6);margin:0 6px;">&ndash;</span>`
  const tsxTagline = [
    bigCap('T'), bigCap('S'), bigCap('X'),
    dashGap,
    bigCap('T'), smCap('H'), smCap('E'),
    wordGap,
    bigCap('S'), smCap('I'), smCap('R'), bigCap('R'), smCap('E'), smCap('E'), smCap('L'),
    wordGap,
    bigCap('E'), smCap('X'), smCap('P'), smCap('E'), smCap('R'), smCap('I'), smCap('E'), smCap('N'), smCap('C'), smCap('E'),
  ].join('')

  const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(subject)}</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f3f4f6; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;">
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color: #f3f4f6;">
    <tr>
      <td align="center" style="padding: 24px 12px;">
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="600" style="max-width: 600px; background-color: #ffffff; border-radius: 14px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.04);">
          <tr>
            <td style="background-color: ${HEADER_BG}; padding: 20px 32px;">
              <!-- Logo left + optional hand-script badge on the right
                   (welcome/quote only; suppressed on the Quick Reply /
                   availability email). -->
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                <tr>
                  <td valign="middle" align="left" style="width: ${headerLogoWidth};">
                    <img
                      src="https://hq.sirreel.com/sirreel-logo-white.png"
                      alt="SirReel"
                      style="height: 28px; width: auto; display: block;"
                    />
                  </td>
                  ${headerBadgeCell}
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding: 28px 32px 4px;">
              <p style="font-size: 17px; color: ${TEXT}; margin: 0 0 12px; line-height: 1.5;">${greeting}</p>
              <p style="font-size: 16px; color: ${TEXT}; margin: 0 0 12px; line-height: 1.6;">${opener}</p>
              ${repBodyHtml ? `<p style="font-size: 16px; color: ${TEXT}; margin: 0 0 12px; line-height: 1.6;">${repBodyHtml}</p>` : ''}
            </td>
          </tr>
          ${personalNoteBlock}
          ${quoteBlock}
          ${availabilityBlock}
          ${closer
            ? `<tr>
            <td style="padding: 16px 32px 4px;">
              <p style="font-size: 16px; color: ${TEXT}; margin: 0 0 24px; line-height: 1.6;">${closer}</p>
            </td>
          </tr>`
            : ''}
          <tr>
            <td style="padding: 0 32px 28px;">
              <p style="font-size: 16px; color: ${TEXT}; margin: 0; line-height: 1.5;">
                — ${signOff}
              </p>
              ${safePhone ? `<p style="font-size: 13px; color: ${MUTED}; margin: 6px 0 0;">${safePhone}</p>` : ''}
            </td>
          </tr>
          <tr>
            <td style="padding: 18px 32px 0;">
              <div style="height: 1px; line-height: 1px; font-size: 0; background-color: ${ACCENT};">&nbsp;</div>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding: 8px 32px 6px;">
              <p style="
                font-family: 'Helvetica Neue', 'Segoe UI', Helvetica, Arial, sans-serif;
                font-weight: 300;
                letter-spacing: 0.32em;
                color: ${ACCENT};
                margin: 0;
                line-height: 1.4;
              ">${tsxTagline}</p>
            </td>
          </tr>
          <tr>
            <td style="padding: 6px 32px 0;">
              <div style="height: 1px; line-height: 1px; font-size: 0; background-color: ${ACCENT};">&nbsp;</div>
            </td>
          </tr>
          <tr>
            <td style="padding: 12px 32px 18px;">
              <p style="font-size: 11px; color: ${MUTED}; margin: 0; line-height: 1.4;">
                ${withQuote
                  ? `Order ${escapeHtml(q!.orderNumber)} · ${escapeHtml(rangeLine(q!.startDate, q!.endDate))}`
                  : ''}
              </p>
              <p style="font-size: 11px; color: ${MUTED}; margin: 4px 0 0; line-height: 1.4;">
                8500 Lankershim Blvd, Sun Valley CA 91352 · (888) 477-7335
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`

  // Plain-text alternative. Mirrors the HTML semantics for clients
  // that strip HTML or for accessibility readers.
  const textParts: string[] = [
    `Hi ${first},`,
    '',
    withAvailability
      ? (customBody ?? av!.availabilityMessage)
      : withQuote
        ? `Thanks for reaching out — really glad we get to work on this with you. I put together a first pass on your quote; it's waiting for you on your client portal along with everything else we'll need for the job.`
        : `Thanks for reaching out — really glad we get to work on this one with you. TSX (The SirReel Experience) is how we describe everything beyond just the rental: the warehouse crew that preps your gear, the fleet that shows up clean and on time, the team you can text at 11pm when something on set changes.`,
  ]
  if (safeNote && input.personalNote) {
    textParts.push('', input.personalNote.trim())
  }
  if (withAvailability) {
    // Same order as the HTML: hold reassurance, then the ask.
    if (heldRange) {
      textParts.push(
        '',
        requestedItems.length === 0
          ? `We've set your equipment aside for ${heldRange} while you decide.`
          : requestedItems.length === 1
            ? `We've set aside your ${requestedItems[0]} for ${heldRange} while you decide.`
            : `We've set the following aside for ${heldRange} while you decide:`,
      )
      if (requestedItems.length > 1) textParts.push(...requestedItems.map((i) => `  - ${i}`))
    } else if (requestedItems.length > 0) {
      textParts.push('', `Here's what I have from your note:`, ...requestedItems.map((i) => `  - ${i}`))
    }
    if (supplyItems.length > 0) {
      textParts.push('', `Coming on the vehicle: ${supplyItems.join(', ')}.`)
    }
    if (showAvailabilityMessage) {
      textParts.push('', av!.availabilityMessage)
    }
    if ((av!.askForCompany || av!.askForJob) && !repWroteIt) {
      const askField =
        av!.askForCompany && av!.askForJob
          ? 'production company and project name'
          : av!.askForCompany
            ? 'production company'
            : 'project name'
      const reply = av!.askForCompany && av!.askForJob ? 'those' : 'that'
      textParts.push('', `One quick thing for our files — what's the ${askField} for this booking?`)
      // Plain-text readers get the URL spelled out, then the reply fallback —
      // both paths work, so neither is presented as the only one.
      if (av!.detailsUrl) {
        textParts.push(`Add ${av!.askForCompany && av!.askForJob ? 'them' : 'it'} here: ${av!.detailsUrl}`)
        textParts.push(`Or just reply with ${reply} and I'll get everything set up.`)
      } else {
        textParts.push(`Just reply with ${reply} and I'll get everything set up.`)
      }
    }
    textParts.push('', `Need more gear or vehicles lined up?`, `Add gear or vehicles: ${av!.suppliesUrl}`)
  }
  if (withQuote) {
    textParts.push(
      '',
      `Your quote:`,
      `  ${q!.jobName}`,
      `  Order ${q!.orderNumber} · ${rangeLine(q!.startDate, q!.endDate)}`,
      ...(q!.subtotal != null ? [`  Subtotal: ${fmtUsd(q!.subtotal)}`] : []),
      `  Total: ${fmtUsd(q!.total)}`,
      '',
      q!.portalUrl
        ? `View on the portal: ${q!.portalUrl}`
        : `Portal link will be added at send time.`,
    )
  }
  textParts.push(
    '',
    withAvailability
      ? '' // the tier message carries its own next step
      : withQuote
        ? `Take a look when you have a minute. If anything's off — vehicle count, dates, supplies, anything — just hit reply and I'll get it sorted.`
        : `When you're ready to book something, just send me the details and I'll spin up a quote.`,
    '',
    `— ${input.agentName}`,
    `& Team SirReel`,
    ...(input.agentPhone ? [input.agentPhone] : []),
    '',
    `TSX — The SirReel Experience`,
    `8500 Lankershim Blvd, Sun Valley CA 91352 · (888) 477-7335`,
  )

  return { subject, html, text: textParts.join('\n') }
}
