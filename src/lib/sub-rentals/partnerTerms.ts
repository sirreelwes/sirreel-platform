/**
 * The partner's terms in plain words — the "Your terms with SirReel" card on
 * their account page.
 *
 * Wes 2026-09-15, looking at California Rent A Car's page before it went to
 * Clifford Fields: "we haven't created the terms clearly for them." The page
 * had one sentence about the split and nothing about when they are paid,
 * cancellations, insurance, or who deals with the production — the things a
 * rental company asks first. Those answers lived only in a 16-clause PDF
 * that, for a prospect, isn't even filed yet.
 *
 * Every line here restates a clause of the Partner Vehicle / Equipment
 * Agreement and names it, so the page never promises more than the contract
 * says. tests/sub-rentals/partner-terms.test.ts reads the clause bodies and
 * fails if a number here (24 hours, 30 days, 10 business days) stops
 * matching them. Change the agreement and this together.
 *
 * Plain module (no Prisma) — the account view renders it on both the public
 * page and the HQ preview.
 */
import { partnerVocab } from '@/lib/sub-rentals/partnerKind'

export interface PartnerTerm {
  key: 'rates' | 'discounts' | 'payment' | 'bookings' | 'insurance' | 'listings'
  title: string
  body: string
  /** The agreement section it restates. */
  section: string
}

const pct = (n: number) => Math.round(n * 100) / 100

export function partnerTerms(args: { kind: string | null | undefined; sharePercent: number | null; maxSharePercent?: number | null }): PartnerTerm[] {
  const w = partnerVocab(args.kind)
  const eq = w.kind === 'EQUIPMENT'
  const share = args.sharePercent
  const max = args.maxSharePercent ?? null
  const extras = eq ? 'delivery and collection, fuel, cable and technician time' : 'delivery, mileage and cleaning'
  const back = eq ? 'is collected' : 'comes back'

  return [
    {
      key: 'rates',
      title: 'Rates',
      section: '8',
      body: share == null
        ? `You set the rate for each ${w.one}, and that is what the production pays. SirReel's share is agreed with you before anything is booked. Extra charges you list (${extras}) are paid to you in full.`
        : `You set the rate for each ${w.one}, and that is what the production pays. SirReel keeps ${pct(share)}% of the ${w.rateNoun} and you receive ${pct(100 - share)}%. Extra charges you list (${extras}) are paid to you in full.`,
    },
    {
      key: 'discounts',
      title: 'Discounts',
      section: '8',
      body: share != null && max != null && max > share
        ? `If a production needs a discount to book, it is shared equally with SirReel until SirReel's share reaches ${pct(max)}%; past that, SirReel covers the rest.`
        : `If a production needs a discount to book, it comes out of SirReel's share, not yours.`,
    },
    {
      key: 'payment',
      title: 'Getting paid',
      section: '8',
      body: `Invoice SirReel after each booking ${back}, with SirReel's booking number. You're paid 30 days after your invoice or 10 business days after the production pays SirReel, whichever is later. SirReel bills and collects from the production — you never invoice them.`,
    },
    {
      key: 'bookings',
      title: 'Bookings and cancellations',
      section: '2',
      body: `Nothing is held until you confirm a booking on this page. If SirReel cancels a confirmed booking less than 24 hours before the scheduled ${eq ? 'delivery' : 'pickup'}, you may charge one day at the booked rate.`,
    },
    {
      key: 'insurance',
      title: 'Insurance',
      section: '4',
      body: `During a booking your ${w.one} is covered by the production's insurance under SirReel's rental agreement, and SirReel checks the production's certificate before a booking is confirmed. You keep your own insurance on it and send SirReel a certificate.`,
    },
    {
      key: 'listings',
      title: `Your ${w.many}, your call`,
      section: '10',
      body: `You choose which ${w.many} SirReel offers and can pull any of them at any time; confirmed bookings are unaffected. SirReel never uses your name or logo with its clients without your permission.`,
    },
  ]
}
