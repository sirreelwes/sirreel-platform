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

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

const FOOT_PARTNER = 'This link is your company’s account with SirReel — anyone you share it with can act for you on it. Reply to this email with any question.'

export function buildPartnerWelcome(a: {
  vendorName: string
  contactName: string | null
  accountUrl: string
  unitCount: number
  agreementWaiting: boolean
  senderName: string
  /** SirReel's share of the vehicle rental rate, when the deal is set. */
  sharePercent: number | null
}): { subject: string; html: string; text: string } {
  const first = (a.contactName ?? '').split(/\s+/)[0] || 'Hi'
  const greet = a.contactName ? `${esc(first)} —` : 'Hi —'
  const subject = `Your ${a.vendorName} account with SirReel`
  const asks: string[] = []
  const deal = a.sharePercent == null ? null : `Our deal, as agreed: your listed rate is what the production pays, SirReel keeps ${a.sharePercent}% of the vehicle rental rate, and you receive ${Math.round((100 - a.sharePercent) * 100) / 100}%. Your page shows what that comes to for each unit.`
  if (a.agreementWaiting) asks.push('<strong>Read and sign the Partner Vehicle Agreement.</strong> It is the rental agreement between us, and it is what puts your vehicles under our client contract and insurance while they are on a SirReel job.')
  asks.push(`<strong>Check your vehicle list and rates.</strong> ${a.unitCount === 0 ? 'Add every vehicle you want SirReel to be able to book, with your daily, weekly and monthly rates.' : `We have ${a.unitCount} of your vehicles listed — add the rest, and correct any rate that is off.`} Rate changes come to us to accept and never touch a booking already confirmed.`)
  asks.push('<strong>Add your drivers.</strong> Enter each driver’s email and they fill in their own profile and license. When we book one of your vehicles with a driver, you assign them from that list and they get their own page with the location and call time.')
  asks.push('<strong>Confirm your contact details and lot address.</strong> Your lot is the point of origin for every booking, so mileage and driver hours count from there.')
  const html = renderEmailShell({
    eyebrow: 'Partner account',
    heading: `Your account with SirReel`,
    preheader: 'Your vehicles, rates, drivers, agreement and every SirReel job in one place',
    bodyHtml: [
      p(`${greet} SirReel now runs its partner vehicles through one page per partner. Yours is below. Every job we put a ${esc(a.vendorName)} vehicle on shows up there with the dates, the driver, and anything still missing, and it is where your rates, your drivers and our agreement live.`),
      ...(deal ? [calloutBox(esc(deal))] : []),
      p('A few things to do the first time you open it:'),
      `<ol style="margin:0 0 14px;padding-left:20px;font-size:15px;line-height:1.55;color:#1f1d1a;">${asks.map((x) => `<li style="margin:0 0 8px;">${x}</li>`).join('')}</ol>`,
      calloutBox('Keep this link. It does not expire, and it is the same page every time — bookmark it rather than waiting for the next email.'),
      p(`— ${esc(a.senderName)}, SirReel`),
    ].join('\n'),
    cta: { label: 'Open your account', href: a.accountUrl },
    footNote: FOOT_PARTNER,
  })
  const text = renderEmailText([
    `${a.contactName ? `${first} —` : 'Hi —'} SirReel now runs its partner vehicles through one page per partner. Yours:`,
    a.accountUrl,
    '',
    ...(deal ? [deal, ''] : []),
    'The first time you open it:',
    ...asks.map((x, i) => `${i + 1}. ${x.replace(/<[^>]+>/g, '')}`),
    '',
    'Keep this link — it does not expire and it is the same page every time.',
    '',
    `— ${a.senderName}, SirReel`,
    '',
    FOOT_PARTNER,
  ])
  return { subject, html, text }
}

export async function sendVendorInvite(args: { vendorId: string; to: string; sender: { email: string; name: string | null } }): Promise<{ ok: boolean; reason?: string; url: string }> {
  const v = await prisma.vendor.findUnique({
    where: { id: args.vendorId },
    select: { id: true, name: true, contactName: true, isActive: true, partnerSharePercent: true, _count: { select: { subcontractedVehicles: true } }, agreements: { where: { deletedAt: null }, select: { signedAt: true }, take: 1 } },
  })
  if (!v || !v.isActive) throw Object.assign(new Error('Vendor not found'), { status: 404 })
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
  })
  const skip = new Set([to, args.sender.email.toLowerCase()])
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
