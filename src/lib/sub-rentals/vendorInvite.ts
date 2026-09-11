/**
 * Emailing a partner their ACCOUNT link (the /vendor/account/[token] page).
 * Minting a token is silent; this is the moment the partner actually hears
 * from us, so it is stamped on the vendor (portalInvitedAt / portalInvitedTo)
 * and the Portals tab reads that stamp rather than the mint time.
 *
 * Wes is CC'd through the sub-rental-conduit-cc channel like every other
 * partner-facing send; replies go to the staff member who pressed the button.
 */
import { prisma } from '@/lib/prisma'
import { sendAgreementEmail } from '@/lib/email/sendAgreementEmail'
import { channelRecipients } from '@/lib/email/notificationChannels'
import { renderEmailShell, renderEmailText, p, calloutBox } from '@/lib/email/templates/shell'
import { ensureVendorPortalToken, vendorAccountUrl } from './vendorAccount'
import { HQ_PRODUCT } from '@/lib/hq-white-label/product'
import { partnerVocab, type PartnerKindKey } from '@/lib/sub-rentals/partnerKind'
import { canSendPartnerWelcome, buildIntroDraft, type IntroDraft } from '@/lib/sub-rentals/welcomeSender'
import { vendorStage } from '@/lib/sub-rentals/partnerStage'

/** Partner mail wears the Utliiz turquoise, not SirReel gold — a foreshadow
 *  of the workspace the partner page points them to. */
const PARTNER_ACCENT = HQ_PRODUCT.defaultAccent
const EMAIL_FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif"

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

const FOOT_PARTNER = 'This link is your company’s account with SirReel — anyone you share it with can act for you on it. You will see SirReel job references and dates on it, never a production’s name; we keep our clients’ details private the same way we keep yours.'

export function buildPartnerWelcome(a: {
  vendorName: string
  contactName: string | null
  accountUrl: string
  unitCount: number
  agreementWaiting: boolean
  senderName: string
  /** SirReel's share of the vehicle rental rate, when the deal is set. */
  sharePercent: number | null
  /** How far SirReel's share may rise to keep a client (discount waterfall). */
  maxSharePercent?: number | null
  /** VEHICLES (drivers, hours, mileage) or EQUIPMENT (delivered and set up).
   *  Picks the nouns and swaps the driver ask for a delivery-contact ask. */
  kind?: PartnerKindKey
}): { subject: string; html: string; text: string } {
  const w = partnerVocab(a.kind)
  const first = (a.contactName ?? '').split(/\s+/)[0] || ''
  const greet = first ? `Hi ${esc(first)},` : 'Hi,'
  const greetText = first ? `Hi ${first},` : 'Hi,'
  const signUrl = `${a.accountUrl.replace(/\/$/, '')}/sign`
  const subject = `Your ${a.vendorName} account with SirReel — what it does and what we need from you`
  const keep = a.sharePercent == null ? null : Math.round((100 - a.sharePercent) * 100) / 100
  const deal = a.sharePercent == null
    ? null
    : `Our deal, in plain numbers: your listed rate is what the production pays. SirReel keeps ${a.sharePercent}% of the ${w.rateNoun} and you receive ${keep}%, invoiced to SirReel after each booking returns. Each ${w.one} on your page shows what that comes to per day. ${
        a.maxSharePercent != null && a.maxSharePercent > a.sharePercent
          ? `If a production needs a discount to book, it is shared equally with SirReel until SirReel's share reaches ${a.maxSharePercent}%; past that, SirReel covers the rest.`
          : `If a production needs a discount to book, it comes out of SirReel's share, not yours.`
      }`

  // Plain-text bullets are the source; HTML wraps them. Kept as data so the
  // two versions of the email cannot drift.
  const gives: string[] = w.drivers
    ? [
        'Every SirReel job that has one of your vehicles on it, with the dates, the vehicle, the driver, and anything still missing. You see our job reference and the dates, never the production’s name. That is deliberate: the production is our client and we keep the two sides apart, the same way we never give a production your details.',
        'A booking page for each vehicle on each job. That is where you confirm you are holding it, see the pickup location and call time once the production sets them, and name the driver.',
        'Your rates on file, and a way to propose a change. A change comes to us to accept and never touches a booking that is already confirmed.',
        'A switch on every vehicle for whether SirReel may offer it to productions. It is yours to turn off at any time, no notice and no reason needed; bookings already confirmed are not affected.',
        'Our agreement to read and sign, and the signed copy afterward.',
      ]
    : [
        'Every SirReel job that has one of your units on it, with the dates, the unit, your delivery contact, and anything still missing. You see our job reference and the dates, never the production’s name. That is deliberate: the production is our client and we keep the two sides apart, the same way we never give a production your details.',
        'A booking page for each unit on each job. That is where you confirm you are holding it, see the delivery location and call time once the production sets them, and tell us who is bringing it.',
        'Your rates on file, and a way to propose a change. A change comes to us to accept and never touches a booking that is already confirmed.',
        'A switch on every unit for whether SirReel may offer it to productions — on sirreel.com and in our quotes, presented as SirReel equipment. It is yours to turn off at any time, no notice and no reason needed; bookings already confirmed are not affected.',
        'Our agreement to read and sign, and the signed copy afterward.',
      ]
  const needs: string[] = []
  if (a.agreementWaiting) {
    needs.push(w.drivers
      ? `Read and sign the Partner Vehicle Agreement. It is short and in plain English: the rental agreement between ${a.vendorName} and SirReel, and what puts your vehicles under our client contract and our insurance while they are on a SirReel job. It protects both sides the same way (each of us covers our own conduct) and it says in writing that what you let us market is yours to withdraw at any time. Sign here: ${signUrl}`
      : `Read and sign the Partner Equipment Agreement. It is short and in plain English: the rental agreement between ${a.vendorName} and SirReel, and what puts your equipment under our client contract and our insurance while it is on a SirReel job. It protects both sides the same way (each of us covers our own conduct) and it says in writing that what you let us market is yours to withdraw at any time. Sign here: ${signUrl}`)
  }
  const listWhat = w.drivers ? 'vehicle' : 'unit'
  needs.push(a.unitCount === 0
    ? `Send us your ${w.drivers ? 'vehicle' : 'equipment'} list. Reply to this email with every ${listWhat} you want SirReel to be able to book, with a daily and weekly rate for each (monthly too if you have one)${w.drivers ? '' : ', plus your delivery, fuel and technician charges'}. We add them and they show up on your page.`
    : `Send us your ${w.drivers ? 'vehicle' : 'equipment'} list. Right now we have ${a.unitCount} of your ${a.unitCount === 1 ? listWhat : `${listWhat}s`} on the page. Reply to this email with the rest, with a daily and weekly rate for each (monthly too if you have one)${w.drivers ? '' : ', plus your delivery, fuel and technician charges'}. We add them and they show up on your page.`)
  // No COI ask here — Wes 2026-09-06: "I don't want it to hold up this week's
  // rental." The partner-coi-missing action item follows up after signing.
  needs.push(w.drivers
    ? 'Check your contact details and lot address on the page. Your lot is the point of origin for every booking, so driver hours and mileage count from there.'
    : 'Check your contact details and yard address on the page. Your yard is the point of origin for every booking, so delivery counts from there.')
  needs.push(w.drivers
    ? 'When we book a vehicle with a driver, name the driver on that booking page. You enter each driver’s email once, they fill in their own profile and license, and after that you just pick from the list. Each driver gets their own page with the location and call time, so nobody has to relay it by text.'
    : 'When we book a unit, put a delivery contact on that booking page — a name and a mobile — so we can reach whoever is on the truck if the address or the timing moves on the day.')
  const booking = w.drivers
    ? 'We quote one of your vehicles to a production. You get an email saying we have pitched it for those dates, which holds nothing. If the production accepts, you get a “please hold” email and confirm on the booking page. When the production books, you get an “it’s a go” email with your rate for the booking. Location and call time land on the booking page as the production sets them. After the vehicle comes back, you invoice SirReel for your share, referencing our booking number, and we pay within 30 days. You never invoice the production.'
    : 'We quote one of your units to a production. You get an email saying we have pitched it for those dates, which holds nothing. If the production accepts, you get a “please hold” email and confirm on the booking page. When the production books, you get an “it’s a go” email with your rate for the booking. The delivery address and the time they need it land on the booking page as the production sets them. After the unit is collected, you invoice SirReel for your share plus delivery, fuel and any technician time, referencing our booking number, and we pay within 30 days. You never invoice the production.'

  // Same block sans as the CTA button, explicitly — without a font-family
  // the label inherited the client's default serif (Wes 2026-09-06).
  const h3 = (t: string) => `<p style="margin:18px 0 6px;font-family:${EMAIL_FONT};font-size:12px;font-weight:800;letter-spacing:1.6px;text-transform:uppercase;color:${PARTNER_ACCENT};">${t}</p>`
  const ul = (items: string[]) => `<ul style="margin:0 0 6px;padding-left:20px;font-size:15px;line-height:1.55;color:#1f1d1a;">${items.map((x) => `<li style="margin:0 0 8px;">${esc(x)}</li>`).join('')}</ul>`
  const ol = (items: string[]) => `<ol style="margin:0 0 6px;padding-left:20px;font-size:15px;line-height:1.55;color:#1f1d1a;">${items.map((x) => `<li style="margin:0 0 8px;">${esc(x).replace(/(https?:\/\/\S+)/, '<a href="$1" style="color:#111;">$1</a>')}</li>`).join('')}</ol>`

  const html = renderEmailShell({
    eyebrow: 'Partner account',
    heading: 'Your account with SirReel',
    preheader: 'What your partner page does, and the few things we need from you',
    bodyHtml: [
      p(`${greet}`),
      p(w.drivers
        ? `We have moved our partner vehicles onto one page per partner, and ${esc(a.vendorName)}’s is ready. Everything about your vehicles on SirReel jobs now runs through it: your vehicle list and rates, our agreement, your drivers, and every booking.`
        : `SirReel runs one page per partner, and ${esc(a.vendorName)}’s is ready. Everything about your equipment on SirReel jobs runs through it: your equipment list and rates, our agreement, and every booking.`),
      p(`Your account page: <a href="${esc(a.accountUrl)}" style="color:#111;">${esc(a.accountUrl)}</a>`),
      calloutBox('That link is your login. There is no password. It does not expire, so bookmark it — and do not forward it outside your company, because anyone with it can act for you on it.', PARTNER_ACCENT),
      ...(deal ? [h3('Our deal'), p(esc(deal))] : []),
      h3('What the page gives you'),
      ul(gives),
      h3('What we need from you'),
      ol(needs),
      h3('How a booking works from here'),
      p(esc(booking)),
      p(`Reply to this email with any question.<br/>— ${esc(a.senderName)}, SirReel`),
    ].join('\n'),
    cta: { label: 'Open your account', href: a.accountUrl },
    footNote: FOOT_PARTNER,
    accent: PARTNER_ACCENT,
  })
  const text = renderEmailText([
    greetText,
    '',
    w.drivers
      ? `We have moved our partner vehicles onto one page per partner, and ${a.vendorName}’s is ready. Everything about your vehicles on SirReel jobs now runs through it: your vehicle list and rates, our agreement, your drivers, and every booking.`
      : `SirReel runs one page per partner, and ${a.vendorName}’s is ready. Everything about your equipment on SirReel jobs runs through it: your equipment list and rates, our agreement, and every booking.`,
    '',
    'Your account page:',
    a.accountUrl,
    '',
    'That link is your login. There is no password. It does not expire, so bookmark it — and do not forward it outside your company, because anyone with it can act for you on it.',
    ...(deal ? ['', 'OUR DEAL', deal] : []),
    '',
    'WHAT THE PAGE GIVES YOU',
    ...gives.map((x) => `- ${x}`),
    '',
    'WHAT WE NEED FROM YOU',
    ...needs.map((x, i) => `${i + 1}. ${x}`),
    '',
    'HOW A BOOKING WORKS FROM HERE',
    booking,
    '',
    'Reply to this email with any question.',
    `— ${a.senderName}, SirReel`,
    '',
    FOOT_PARTNER,
  ])
  return { subject, html, text }
}

/**
 * Render the introduction. ONE renderer for the preview and the send, so what
 * Wes approves on screen is byte-for-byte what leaves — a preview built by a
 * second code path is a preview of something else.
 */
export function renderPartnerWelcome(a: { vendorName: string; subject: string; body: string }): { html: string; text: string } {
  // His paragraphs, his line breaks — escaped, never interpreted as HTML.
  const paragraphs = a.body.trim().split(/\n{2,}/).map((para) => p(esc(para).replace(/\n/g, '<br />')))
  return {
    html: renderEmailShell({
      eyebrow: 'An introduction',
      heading: `SirReel & ${a.vendorName}`,
      preheader: a.subject,
      bodyHtml: paragraphs.join(''),
      accent: PARTNER_ACCENT,
    }),
    text: renderEmailText(a.body.trim().split('\n')),
  }
}

/**
 * THE INTRODUCTION — sent before the account link, by Wes, in his own words.
 *
 * Wes 2026-09-10: "I don't want to send a portal link without the initial
 * welcome email." A cold link to a page full of rates and agreements, from a
 * company you have not agreed to work with, reads as a mistake. This is the
 * mail that makes it make sense, so sendVendorInvite below refuses until it
 * has gone.
 *
 * The BODY IS HIS. `buildIntroDraft` offers a starting point; whatever he
 * actually typed is what sends, wrapped in the partner shell so it looks like
 * every other partner-facing mail. No account link here on purpose — the link
 * is the second conversation.
 */
export async function sendPartnerWelcome(args: {
  vendorId: string
  to: string
  subject: string
  body: string
  sender: { email: string; name: string | null }
}): Promise<{ ok: boolean; reason?: string }> {
  if (!canSendPartnerWelcome(args.sender.email)) {
    throw Object.assign(new Error('Only Wes sends the partner introduction.'), { status: 403 })
  }
  const v = await prisma.vendor.findUnique({
    where: { id: args.vendorId },
    select: { id: true, name: true, isActive: true, welcomeSentAt: true },
  })
  if (!v || !v.isActive) throw Object.assign(new Error('Vendor not found'), { status: 404 })

  const to = args.to.trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) throw Object.assign(new Error('Enter a valid email address.'), { status: 400 })
  const subject = args.subject.trim()
  const body = args.body.trim()
  if (!subject) throw Object.assign(new Error('The subject is empty.'), { status: 400 })
  if (!body) throw Object.assign(new Error('The message is empty.'), { status: 400 })

  const { html, text } = renderPartnerWelcome({ vendorName: v.name, subject, body })

  // CC'd like every other partner-facing send, and replies go to him.
  const cc = (await channelRecipients('sub-rental-conduit-cc')).filter(
    (e) => e && e.toLowerCase() !== to && e.toLowerCase() !== args.sender.email.toLowerCase(),
  )
  const res = await sendAgreementEmail({
    to: [to],
    cc: cc.length ? cc : undefined,
    replyTo: args.sender.email,
    subject,
    html,
    text,
    label: 'partner-welcome',
  }).catch((err: unknown) => ({ ok: false as const, reason: err instanceof Error ? err.message : 'send threw' }))
  if (!res.ok) return { ok: false, reason: 'reason' in res ? res.reason : 'not sent' }

  await prisma.vendor.update({
    where: { id: v.id },
    data: { welcomeSentAt: new Date(), welcomeSentTo: to, welcomeSubject: subject.slice(0, 300) },
  })
  return { ok: true }
}

/** The draft the compose box opens with. */
export async function partnerIntroDraft(vendorId: string, sender: { name: string; email?: string | null; phone?: string | null; title?: string | null }): Promise<IntroDraft> {
  const v = await prisma.vendor.findUnique({
    where: { id: vendorId },
    select: { name: true, contactName: true, partnerKind: true, partnerSharePercent: true, partnerMaxSharePercent: true },
  })
  if (!v) throw Object.assign(new Error('Vendor not found'), { status: 404 })
  return buildIntroDraft({
    vendorName: v.name,
    contactName: v.contactName,
    kind: v.partnerKind,
    senderName: sender.name,
    senderPhone: sender.phone ?? null,
    senderEmail: sender.email ?? null,
    senderTitle: sender.title ?? null,
    // The numbers go IN the mail when the deal is set — a term nobody wrote
    // down is a term that gets re-negotiated later.
    sharePercent: v.partnerSharePercent == null ? null : Number(v.partnerSharePercent),
  })
}

export async function sendVendorInvite(args: { vendorId: string; to: string; sender: { email: string; name: string | null } }): Promise<{ ok: boolean; reason?: string; url: string }> {
  const v = await prisma.vendor.findUnique({
    where: { id: args.vendorId },
    select: { id: true, name: true, contactName: true, isActive: true, welcomeSentAt: true, partnerSharePercent: true, partnerMaxSharePercent: true, partnerKind: true, _count: { select: { subcontractedVehicles: true } }, agreements: { where: { deletedAt: null }, select: { signedAt: true }, take: 1 } },
  })
  if (!v || !v.isActive) throw Object.assign(new Error('Vendor not found'), { status: 404 })
  // The introduction comes first (Wes 2026-09-10). A link to a page of rates
  // and agreements, from a company they have not agreed to work with, reads as
  // a mistake — sendPartnerWelcome is what makes it make sense.
  if (!v.welcomeSentAt) {
    throw Object.assign(
      new Error('Send the introduction first — this link only makes sense to someone who has already heard from us.'),
      { status: 409 },
    )
  }
  // And then THEY reply and Wes marks them (2026-09-11: "no company gets
  // onboarded until they reply and I mark it as a new partner"). Fails soft
  // to the introduction gate alone while the stage columns are not there.
  const stage = await vendorStage(v.id)
  if (stage && stage !== 'partner') {
    throw Object.assign(
      new Error('Mark them as a new partner first — the account link goes out after they reply to the introduction.'),
      { status: 409 },
    )
  }
  const to = args.to.trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) throw Object.assign(new Error('Enter a valid email address.'), { status: 400 })
  const token = await ensureVendorPortalToken(v.id)
  const url = vendorAccountUrl(token)
  const senderName = args.sender.name?.trim() || args.sender.email.split('@')[0]
  const mail = buildPartnerWelcome({
    vendorName: v.name,
    contactName: v.contactName,
    accountUrl: url,
    unitCount: v._count.subcontractedVehicles,
    agreementWaiting: v.agreements.length > 0 && !v.agreements[0].signedAt,
    senderName,
    sharePercent: v.partnerSharePercent == null ? null : Number(v.partnerSharePercent),
    maxSharePercent: v.partnerMaxSharePercent == null ? null : Number(v.partnerMaxSharePercent),
    kind: v.partnerKind,
  })
  // Only the recipient is deduped out of the CC list. The sender stays
  // when the channel names them: this mail leaves through Resend, not
  // their mailbox, so the CC is the only copy they ever see (Wes
  // 2026-09-06: "send the portal invite to David at King Kong and CC wes@").
  const skip = new Set([to])
  const cc = (await channelRecipients('sub-rental-conduit-cc')).filter((e) => e && !skip.has(e.toLowerCase()))
  const res = await sendAgreementEmail({
    to: [to],
    cc: cc.length ? cc : undefined,
    replyTo: args.sender.email,
    subject: mail.subject,
    html: mail.html,
    text: mail.text,
    label: 'vendor-account-invite',
  }).catch((err: unknown) => ({ ok: false as const, reason: err instanceof Error ? err.message : 'send threw' }))
  if (!res.ok) return { ok: false, reason: 'reason' in res ? res.reason : 'not sent', url }
  await prisma.vendor.update({ where: { id: v.id }, data: { portalInvitedAt: new Date(), portalInvitedTo: to } })
  return { ok: true, url }
}
