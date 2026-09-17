/**
 * Email for the production-company (account) portal — three templates that
 * share one shell:
 *
 *   1. the INVITE staff send when they grant account access,
 *   2. the EVENT notice (job started / invoice paid / job closed),
 *   3. the SHARE an executive forwards to their own production teams.
 *
 * ── The share is not from us ───────────────────────────────────────────
 * (3) is the odd one and the one to be careful with. It leaves our domain
 * on a client's instruction, to recipients we have never verified, and it
 * says so in the body: the sender is named, and the reply goes to THEM,
 * not to a SirReel inbox. Anything else would make SirReel look like it
 * cold-mailed a stranger's coordinator — and would land their reply in the
 * wrong building.
 *
 * The share carries NO rates and NO invoice figures. An executive forwards
 * it to a dozen people and it goes on from there; a negotiated rate in a
 * forwarded mail is a rate card in the wild.
 */

import {
  renderEmailShell,
  renderEmailText,
  p,
  detailTable,
  calloutBox,
  bulletList,
} from '@/lib/email/templates/shell'

/**
 * WHAT WE BUILT, said the way Wes says it.
 *
 * Wes 2026-09-16 on the tone: "something we have added for them that
 * requires nothing from them. It's casual. It's, we know you need XYZ and
 * here's what we've done to solve that."
 *
 * So most lines are PAIN FIRST, then the fix — not a feature and its
 * benefit. The lead-in names a headache the reader has personally had on a
 * show; the sentence after it is what we did about it. Nothing in here asks
 * them to install, sign up, configure or learn anything, because that is the
 * whole point: it is already on their account.
 *
 * Two lead-ins are Wes's own words rather than that pattern (2026-09-16, on
 * reading the draft): the after-hours line opens on the claim he actually
 * makes to clients — "we are the most responsive team in the business" —
 * with AHA covering the hours the team is asleep, and the partner line is
 * his, verbatim. Where his phrasing and the pattern disagree, his phrasing
 * wins: it is his voice the client is buying.
 *
 * AHA is named to clients on purpose — the portal job page already says
 * "After hours, text AHA" — and described as an assistant rather than a
 * person, with no pronoun, because it always tells people it is automated.
 *
 * Plain words, contractions, no vendor nouns ("solution", "platform",
 * "seamless"). If a line could appear in any rental company's brochure, it
 * is the wrong line.
 *
 * Every claim is shipped and client-visible — an executive who forwards this
 * must not be contradicted by their coordinator a week later. Nothing
 * internal (pick lists, our dashboards) and nothing with a number on it; see
 * the rates note below.
 *
 * One place, so the pitch cannot drift between the email, a deck and the
 * site.
 */
export const SIRREEL_CAPABILITIES: ReadonlyArray<string> = [
  "<strong>Nobody should have to call for a status.</strong> Every show gets its own page now — dates, paperwork, pickup details, who to call. Your coordinator opens a link. No login, no account to set up.",
  "<strong>Signing the same contract every show got old.</strong> So we put one agreement on your account instead. Every job after that is a one-pager that files under it — nothing to re-read, nothing to re-sign.",
  "<strong>COIs always go wrong at the worst possible moment.</strong> We read every certificate the minute it lands and tell you if something's off — usually days ahead, instead of at the gate on load-in morning. We'll tell your broker the number to insure for, too.",
  "<strong>We're the most responsive team in the business.</strong> And for the few hours we're catching sleep before the next day, AHA — our after-hours assistant — picks up. Your crew can text at any hour and get a driver into a truck or a lock box on the spot, instead of leaving a voicemail.",
  "<strong>Find everything you need in one place.</strong> If we don't own it, we get it from our partners — quoted, delivered and billed by us. Your team places one order and reconciles one invoice.",
  "<strong>\u201cDid that come back?\u201d shouldn't be a debate.</strong> Radios, generators and the rest get scanned going out and scanned coming in, so what happened is a record instead of an argument.",
]

/**
 * The rates line — the reason this variant exists (Wes 2026-09-16:
 * "highlights that they are being offered these rates for their teams").
 *
 * NO FIGURES, EVER. This is a one-to-one invite, but email forwards, and the
 * share template at the bottom of this file already holds the line for the
 * same reason: "a negotiated rate in a forwarded mail is a rate card in the
 * wild." What the mail says is that the deal EXISTS and that it reaches every
 * team under the account; the numbers stay behind the portal sign-in.
 */
function ratesCallout(companyName: string): string {
  return calloutBox(
    `<strong>And your rates come with it.</strong> What we worked out with ` +
      `${esc(companyName)} applies to every production your company books &mdash; not just ` +
      `the show that earned it. Add whoever you like to the account; they book at the same ` +
      `rates without having to ask.`,
  )
}

/** Plain-text twin of the callout above, so both halves say the same thing. */
function ratesLine(companyName: string): string {
  return (
    `And your rates come with it. What we worked out with ${companyName} applies to every ` +
    `production your company books, not just the show that earned it. Add whoever you like ` +
    `to the account; they book at the same rates without having to ask.`
  )
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// ── 1. Invite ──────────────────────────────────────────────────────────

export interface CompanyPortalInviteInput {
  firstName: string
  companyName: string
  portalUrl: string
  repName: string
  repEmail: string | null
  /** Rendered only when the account actually has one. */
  annualAgreementTitle?: string | null
  /**
   * An annual master OFFERED in the portal, not yet signed. Wes 2026-09-06:
   * the invite is how the executive learns it is waiting for them.
   */
  pendingAnnual?: { title: string; signUrl: string } | null
  /**
   * Everyone ELSE with access to this account, by name. Empty means the
   * recipient is the only one — and the mail says so, because "no password"
   * on its own reads as "anyone with the link" (Wes 2026-09-06: "even though
   * there is no password, only Ding Ding can currently access").
   */
  otherPeople?: { name: string; title: string | null }[]
  /**
   * Set when a COLLEAGUE added them from inside the portal rather than a
   * rep. The mail then opens with who did it — the recipient knows that
   * person, and it answers "why am I getting this" in the first line.
   */
  addedByName?: string | null
  /**
   * The rep's own words (2026-09-11 — "preview and modify the invite").
   * Replaces the greeting, the opener, the who-has-access line and the
   * updates line; the annual-agreement callout, the portal button and the
   * sign-off stay, because those are facts about the account. Seeded from
   * defaultCompanyPortalInviteBody so an edit starts from the real copy.
   */
  customBody?: string | null
  /**
   * Which invite this is (Wes 2026-09-16: "a version of the invite … that
   * gives a high-level, bullet-pointed overview of the innovation").
   *
   *   'standard' — the original: you have access, here is how it works.
   *   'overview' — the same access, opened with what SirReel has built and
   *                the fact that the account's rates reach every team. For
   *                an executive being brought on rather than a coordinator
   *                who already knows us.
   *
   * Defaults to 'standard', so every existing caller is unchanged.
   */
  variant?: 'standard' | 'overview'
  /**
   * Whether this company actually has negotiated rates on file. The rates
   * highlight is the point of the overview variant, but promising a deal to
   * an account that has not been given one would be a lie the first quote
   * exposes — so no rates row, no rates line.
   */
  hasNegotiatedRates?: boolean
}

function joinNames(people: { name: string; title: string | null }[]): string {
  const bits = people.map((p) => (p.title ? `${p.name} (${p.title})` : p.name))
  if (bits.length <= 1) return bits.join('')
  return `${bits.slice(0, -1).join(', ')} and ${bits[bits.length - 1]}`
}

/** The templated prose as plain text — what the compose box is seeded with,
 *  and what `customBody` replaces when the rep edits it. */
export function defaultCompanyPortalInviteBody(i: CompanyPortalInviteInput): string {
  const others = i.otherPeople ?? []
  if (i.variant === 'overview') {
    // The bullets and the rates line are NOT in this seed on purpose: they
    // are facts about SirReel and about the account, not the rep's prose to
    // retype, so the renderer inserts them after whatever prose survives an
    // edit — exactly how the annual-agreement callout already behaves. A
    // placeholder marker here would ship to the client verbatim the moment
    // somebody edited the box.
    return [
      `${i.firstName},`,
      ``,
      i.addedByName
        ? `${i.addedByName} put you on the SirReel account for ${i.companyName}. It's already on — there's nothing for you to set up.`
        : `You're on the SirReel account for ${i.companyName} now. It's already on — there's nothing for you to set up.`,
      ``,
      `We've built a fair bit this year, mostly from watching productions run into the same few headaches. The short version:`,
      ``,
      `Your account page pulls it together — every show your teams have with us, who's running each one, the invoices, the agreements. Nothing to install and nothing to learn; it's just there when you want it.`,
      ``,
      others.length === 0
        ? `Sign in with this email address; there's no password. Access is by invitation, not by link — right now you're the only person who can open this account. Add colleagues under People with access and they'll get an email like this one.`
        : `Sign in with this email address; there's no password. Access is by invitation, not by link — the people who can open this account are you and ${joinNames(others)}. Add colleagues under People with access and they'll get an email like this one.`,
    ].join('\n')
  }
  const opener = i.addedByName
    ? `${i.addedByName} added you to the ${i.companyName} account at SirReel — a single page showing every show your teams have with us, who's leading each one, the invoices, and the agreements on file.`
    : `You now have account-level access to SirReel for ${i.companyName} — a single page showing every show your teams have with us, who's leading each one, the invoices, and the agreements on file.`
  const accessLine =
    others.length === 0
      ? `Sign in with this email address; there's no password. Access is by invitation, not by link — right now you're the only person who can open this account. If you'd like colleagues to see it too, add them under People with access in your portal and they'll get an email like this one.`
      : `Sign in with this email address; there's no password. Access is by invitation, not by link — the people who can open this account are you and ${joinNames(others)}. To add colleagues, use People with access in your portal and they'll get an email like this one.`
  return [
    `${i.firstName},`,
    ``,
    opener,
    ``,
    accessLine,
    ``,
    `You can also choose which updates you want — job starts, invoices paid, shows closing out — from the bottom of the page.`,
  ].join('\n')
}

/** Rep-written prose → escaped paragraphs, blank lines preserved. */
function proseHtml(prose: string): string {
  return prose
    .split(/\n{2,}/)
    .map((para) => p(esc(para).replace(/\n/g, '<br />')))
    .join('')
}

export function renderCompanyPortalInvite(i: CompanyPortalInviteInput): {
  subject: string
  html: string
  text: string
} {
  const overview = i.variant === 'overview'
  const subject = overview
    ? `A few things we've set up for ${i.companyName}`
    : `Your ${i.companyName} account portal at SirReel`
  const others = i.otherPeople ?? []
  const custom = (i.customBody ?? '').trim()

  // The two blocks that make this variant what it is. Inserted by the
  // RENDERER, never by the rep's prose, so an edited message still carries
  // them — same rule the annual-agreement callout follows.
  const capabilities = overview ? bulletList([...SIRREEL_CAPABILITIES]) : ''
  const rates = overview && i.hasNegotiatedRates ? ratesCallout(i.companyName) : ''

  const overviewOpener = i.addedByName
    ? `<strong>${esc(i.addedByName)}</strong> put you on the SirReel account for <strong>${esc(i.companyName)}</strong>. It's already on — there's nothing for you to set up.`
    : `You're on the SirReel account for <strong>${esc(i.companyName)}</strong> now. It's already on — there's nothing for you to set up.`

  const overviewIntro = `We've built a fair bit this year, mostly from watching productions run into the same few headaches. The short version:`

  const accountLine = `Your account page pulls it together — every show your teams have with us, who's running each one, the invoices, the agreements. Nothing to install and nothing to learn; it's just there when you want it.`

  const opener = i.addedByName
    ? `<strong>${esc(i.addedByName)}</strong> added you to the <strong>${esc(i.companyName)}</strong> account at SirReel — a single page showing every show your teams have with us, who's leading each one, the invoices, and the agreements on file.`
    : `You now have account-level access to SirReel for <strong>${esc(i.companyName)}</strong> — a single page showing every show your teams have with us, who's leading each one, the invoices, and the agreements on file.`

  const accessLine =
    others.length === 0
      ? `Sign in with this email address; there's no password. Access is by invitation, not by link — right now you're the only person who can open this account. If you'd like colleagues to see it too, add them under <strong>People with access</strong> in your portal and they'll get an email like this one.`
      : `Sign in with this email address; there's no password. Access is by invitation, not by link — the people who can open this account are you and ${esc(joinNames(others))}. To add colleagues, use <strong>People with access</strong> in your portal and they'll get an email like this one.`

  const annualCallout =
    i.pendingAnnual
      ? calloutBox(
          `Your <strong>${esc(i.pendingAnnual.title)}</strong> is ready for your signature in the portal. Once signed, it runs every show your company books; each job is then confirmed with a one-page addendum that logs it under the annual, so nobody re-signs the full agreement per show. You'll choose the damage-waiver (LCDW) election for the account as part of signing. <a href="${esc(i.pendingAnnual.signUrl)}" style="color:#0c0c0d;font-weight:700;">Sign the annual agreement</a>`,
        )
      : i.annualAgreementTitle
        ? calloutBox(
            `Your annual agreement, <strong>${esc(i.annualAgreementTitle)}</strong>, runs every show your company books. Each job is confirmed with a one-page addendum that logs it under the annual, so nobody re-signs the full agreement per show.`,
          )
        : ''
  const body = custom
    ? [proseHtml(custom), capabilities, rates, annualCallout].join('')
    : overview
      ? [
          p(`${esc(i.firstName)},`),
          p(overviewOpener),
          p(overviewIntro),
          capabilities,
          rates,
          p(accountLine),
          annualCallout,
          p(accessLine),
        ].join('')
      : [
          p(`${esc(i.firstName)},`),
          p(opener),
          annualCallout,
          p(accessLine),
          p(
            `You can also choose which updates you want — job starts, invoices paid, shows closing out — from the bottom of the page.`,
          ),
        ].join('')

  const html = renderEmailShell({
    heading: overview ? "A few things we've set up" : 'Your account portal',
    eyebrow: i.companyName,
    preheader: overview
      ? `It's already on — nothing for you to set up.`
      : `Every ${i.companyName} show with SirReel, in one place.`,
    bodyHtml: body,
    cta: { label: 'Open your account portal', href: i.portalUrl },
    footNote: i.repEmail
      ? `Questions? ${esc(i.repName)} — ${esc(i.repEmail)}`
      : `Questions? Reply to this email.`,
  })

  // The text half carries the same two blocks, tags stripped — a plain-text
  // reader must not get a shorter pitch than the HTML one.
  const capabilitiesText = overview
    ? SIRREEL_CAPABILITIES.map((line) => `  - ${line.replace(/<[^>]+>/g, '')}`)
    : []

  const text = renderEmailText([
    ...(custom
      ? [custom]
      : [
          `${i.firstName},`,
          '',
          overview
            ? i.addedByName
              ? `${i.addedByName} put you on the SirReel account for ${i.companyName}. It's already on — there's nothing for you to set up.\n\nWe've built a fair bit this year, mostly from watching productions run into the same few headaches. The short version:`
              : `You're on the SirReel account for ${i.companyName} now. It's already on — there's nothing for you to set up.\n\nWe've built a fair bit this year, mostly from watching productions run into the same few headaches. The short version:`
            : i.addedByName
              ? `${i.addedByName} added you to the ${i.companyName} account at SirReel — every show your teams have with us, the invoices, and the agreements on file.`
              : `You now have account-level access to SirReel for ${i.companyName} — every show your teams have with us, the invoices, and the agreements on file.`,
        ]),
    ...(capabilitiesText.length ? ['', ...capabilitiesText] : []),
    ...(rates ? ['', ratesLine(i.companyName)] : []),
    ...(overview && !custom ? ['', accountLine] : []),
    '',
    `Open your account portal: ${i.portalUrl}`,
    '',
    ...(i.pendingAnnual
      ? [
          `Your ${i.pendingAnnual.title} is ready for your signature in the portal. Once signed, it runs every show your company books; each job is then confirmed with a one-page addendum that logs it under the annual. You'll choose the damage-waiver (LCDW) election as part of signing.`,
          `Sign it here: ${i.pendingAnnual.signUrl}`,
          '',
        ]
      : []),
    ...(custom
      ? []
      : [
          others.length === 0
            ? `Sign in with this email address; there's no password. Access is by invitation, not by link — right now you're the only person who can open this account. To add colleagues, use "People with access" in your portal.`
            : `Sign in with this email address; there's no password. Access is by invitation, not by link — the people who can open this account are you and ${joinNames(others)}. To add colleagues, use "People with access" in your portal.`,
        ]),
    i.repEmail ? `\nQuestions? ${i.repName} — ${i.repEmail}` : '',
  ])

  return { subject, html, text }
}

// ── 2. Event notice ────────────────────────────────────────────────────

export interface CompanyPortalNoticeInput {
  firstName: string
  companyName: string
  portalUrl: string
  headline: string
  eyebrow: string
  /** Label/value rows — kept short; this is a nudge, not a report. */
  rows: { label: string; value: string }[]
  bodyLine: string
  ctaLabel: string
  ctaHref: string
}

export function renderCompanyPortalNotice(i: CompanyPortalNoticeInput): {
  subject: string
  html: string
  text: string
} {
  const subject = `${i.headline} — ${i.companyName}`

  const html = renderEmailShell({
    heading: i.headline,
    eyebrow: i.eyebrow,
    preheader: i.bodyLine,
    bodyHtml: [
      p(`${esc(i.firstName)},`),
      p(esc(i.bodyLine)),
      detailTable(i.rows),
    ].join(''),
    cta: { label: i.ctaLabel, href: i.ctaHref },
    footNote: 'You can change or turn off these updates from your account portal.',
  })

  const text = renderEmailText([
    `${i.firstName},`,
    '',
    i.bodyLine,
    '',
    ...i.rows.map((r) => `${r.label}: ${r.value}`),
    '',
    `${i.ctaLabel}: ${i.ctaHref}`,
    '',
    'You can change or turn off these updates from your account portal.',
  ])

  return { subject, html, text }
}

/**
 * A weekly roll-up of several notices into one mail — the WEEKLY cadence.
 * Same shell; the difference is that the reader gets one interruption
 * instead of nine.
 */
export function renderCompanyPortalDigest(i: {
  firstName: string
  companyName: string
  portalUrl: string
  items: { headline: string; detail: string }[]
}): { subject: string; html: string; text: string } {
  const subject = `This week at SirReel — ${i.companyName}`

  const list = i.items
    .map(
      (it) =>
        `<tr><td style="padding:8px 0;border-top:1px solid #e2ddd0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.5;color:#3d392f;"><strong>${esc(it.headline)}</strong><br><span style="color:#8a8272;">${esc(it.detail)}</span></td></tr>`,
    )
    .join('')

  const html = renderEmailShell({
    heading: 'This week at SirReel',
    eyebrow: i.companyName,
    preheader: `${i.items.length} update${i.items.length === 1 ? '' : 's'} across your shows.`,
    bodyHtml: [
      p(`${esc(i.firstName)},`),
      p(`Here's what moved on your account this week.`),
      `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 18px;">${list}</table>`,
    ].join(''),
    cta: { label: 'Open your account portal', href: i.portalUrl },
    footNote: 'You can change or turn off these updates from your account portal.',
  })

  const text = renderEmailText([
    `${i.firstName},`,
    '',
    `Here's what moved on your account this week.`,
    '',
    ...i.items.map((it) => `• ${it.headline} — ${it.detail}`),
    '',
    `Open your account portal: ${i.portalUrl}`,
  ])

  return { subject, html, text }
}

// ── 3. Share with the client's own production teams ────────────────────

export interface CompanyPortalShareInput {
  /** The executive doing the sharing. Named in the body — this is from them. */
  senderName: string
  senderEmail: string
  recipientName: string | null
  companyName: string
  message: string | null
  /** Terms lines — annual agreement, standing waiver, rep. NO rates. */
  termsRows: { label: string; value: string }[]
  services: { name: string; blurb: string; href: string }[]
  /** Absolute base, e.g. https://hq.sirreel.com */
  siteBase: string
}

export function renderCompanyPortalShare(i: CompanyPortalShareInput): {
  subject: string
  html: string
  text: string
} {
  const subject = `${i.senderName} shared your SirReel account details — ${i.companyName}`

  const serviceList = i.services
    .map(
      (s) =>
        `<tr><td style="padding:10px 0;border-top:1px solid #e2ddd0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.55;color:#3d392f;"><a href="${esc(i.siteBase)}${esc(s.href)}" style="color:#0c0c0d;font-weight:700;text-decoration:none;">${esc(s.name)}</a><br><span style="color:#8a8272;">${esc(s.blurb)}</span></td></tr>`,
    )
    .join('')

  const body = [
    p(`${i.recipientName ? `${esc(i.recipientName)},` : 'Hi,'}`),
    p(
      `<strong>${esc(i.senderName)}</strong> at ${esc(i.companyName)} asked us to send you this — how the ${esc(i.companyName)} account works with SirReel, and what we can do for your team.`,
    ),
    i.message ? calloutBox(esc(i.message).replace(/\n/g, '<br>')) : '',
    i.termsRows.length
      ? `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:12px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#8a8272;margin:0 0 8px;">Your account</div>${detailTable(i.termsRows)}`
      : '',
    `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:12px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#8a8272;margin:14px 0 2px;">What we can do</div>`,
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 18px;">${serviceList}</table>`,
    p(
      `To book anything here, or to ask a question, reply to ${esc(i.senderName)} or get in touch with us directly.`,
    ),
  ].join('')

  const html = renderEmailShell({
    heading: `${i.companyName} × SirReel`,
    eyebrow: 'Shared with you',
    preheader: `${i.senderName} shared how the ${i.companyName} account works with SirReel.`,
    bodyHtml: body,
    cta: { label: 'See the fleet', href: `${i.siteBase}/vehicles` },
    footNote: `Sent at the request of ${esc(i.senderName)} (${esc(i.senderEmail)}). Replies go to them.`,
  })

  const text = renderEmailText([
    i.recipientName ? `${i.recipientName},` : 'Hi,',
    '',
    `${i.senderName} at ${i.companyName} asked us to send you this — how the ${i.companyName} account works with SirReel, and what we can do for your team.`,
    ...(i.message ? ['', i.message] : []),
    ...(i.termsRows.length ? ['', 'YOUR ACCOUNT', ...i.termsRows.map((r) => `${r.label}: ${r.value}`)] : []),
    '',
    'WHAT WE CAN DO',
    ...i.services.map((s) => `• ${s.name} — ${s.blurb} (${i.siteBase}${s.href})`),
    '',
    `Sent at the request of ${i.senderName} (${i.senderEmail}). Replies go to them.`,
  ])

  return { subject, html, text }
}
