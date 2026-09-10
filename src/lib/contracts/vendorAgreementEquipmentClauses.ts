/**
 * SirReel Partner Equipment Agreement — the EQUIPMENT variant of the
 * partner contract, for a partner whose units are delivered and set up
 * rather than driven: generators, distro, HVAC, lifts, temporary lighting
 * (first: PowerTrip Rentals, 2026-09-10).
 *
 * Same skeleton, same mechanism and same numbers as the Partner Vehicle
 * Agreement (vendorAgreementClauses.ts): the partner rents the Unit to
 * SirReel, SirReel subleases it to the production under the SirReel Rental
 * Agreement, so on a booking the Unit IS "Equipment" under that agreement
 * and the production's insurance and indemnity reach it. What changes is
 * what a vehicle clause cannot say about a generator:
 *
 *   - Clause 1: no registration or roadworthiness; instead the certifications
 *     a generator or a lift actually carries (emissions, ANSI, load rating).
 *   - Clause 4: general liability and rented-equipment (inland marine)
 *     coverage on both sides, not auto liability; auto stays only on the
 *     partner's delivery trucks.
 *   - Clause 7: DELIVERY, SETUP AND SERVICE replaces DRIVERS. The partner's
 *     own crew delivers, positions, cables and collects; there is no driver
 *     on set, no hours log, and a delivery contact instead of a roster driver.
 *   - Clause 8: the ancillaries are delivery, fuel, cable and technician time.
 *
 * Everything else (cancellation, loss valuation, confidentiality,
 * marketing withdrawal, mutual indemnity, term, law) is word-for-word the
 * vehicle text so the two documents cannot drift on a shared term. Wes
 * should read this once before it goes to Evan; it is offered as SirReel's
 * standard, not as advice.
 */

import type { VendorAgreementClause } from './vendorAgreementClauses'

export const VENDOR_EQUIPMENT_AGREEMENT_TITLE = 'Partner Equipment Agreement'
export const VENDOR_EQUIPMENT_AGREEMENT_VERSION = '2026-09-10a'

export function vendorEquipmentAgreementTerms(sharePercent: number | null): { label: string; value: string }[] {
  if (sharePercent == null) return [{ label: 'SirReel’s share of the rental rate', value: 'As recorded on your partner page' }]
  const keep = Math.round((100 - sharePercent) * 100) / 100
  return [
    { label: 'SirReel’s share of the rental rate', value: `${sharePercent}%` },
    { label: 'Partner receives', value: `${keep}% of the listed rate, plus listed delivery, fuel and technician charges, paid within 30 days of the Unit’s return` },
  ]
}

export const VENDOR_EQUIPMENT_AGREEMENT_OPENING =
  'This Partner Equipment Agreement (the "Agreement") is between SirReel Production Vehicles, Inc. ("SirReel", "we", "us") and the partner named below ("Partner", "you"). SirReel rents production vehicles and equipment to film, television and commercial productions under its standard rental agreement (the "SirReel Rental Agreement"). You own or control generators, power distribution, heating and cooling, lifts, lighting and related equipment you are willing to make available to SirReel for those productions. This Agreement sets the terms under which SirReel rents your equipment and places it with its clients, so that each unit is covered the same way SirReel-owned equipment would be.'

export const VENDOR_EQUIPMENT_AGREEMENT_CLAUSES: VendorAgreementClause[] = [
  {
    ref: '1',
    title: 'Equipment Covered',
    body: 'This Agreement covers every generator, distribution package, HVAC unit, lift, light tower, cart and piece of related equipment you list on your SirReel partner page, and any other unit you make available to SirReel in writing (each a "Unit"). Listing a Unit is a standing offer to rent it to SirReel at the listed rates whenever it is available. You may add or remove Units and propose rate changes at any time; a rate change applies to bookings confirmed after SirReel accepts it, and never to a booking already confirmed. You represent that for each Unit you hold clear title or the owner’s written authority to rent it, that it carries every certification, permit and inspection the law requires for its use in California (including emissions and air-district requirements for engines and ANSI or manufacturer certification for lifts), and that it is safe and lawful to operate for its intended use.',
  },
  {
    ref: '2',
    title: 'Bookings',
    body: 'Each booking is a separate rental of a Unit from you to SirReel under this Agreement. A booking is confirmed when SirReel sends you the booking through your partner page and you confirm the Unit is held for those dates. The rental period runs from the time the Unit leaves your yard (or the point of origin agreed for that booking) until it is returned there and accepted by you. If SirReel cancels a confirmed booking less than 24 hours before the scheduled delivery, you may charge one day at the booked rate for that Unit, waived if you re-rent it for those dates. Cancellations are given in writing through the partner page or by email.',
  },
  {
    ref: '3',
    title: 'SirReel Is the Renter; Sublease to Production',
    body: 'During a booking SirReel is the renter of your Unit and you consent to SirReel subleasing it to its production client under the SirReel Rental Agreement. SirReel is solely responsible to the production and the production is solely responsible to SirReel; you have no contract with the production and will not look to it for payment. While it is on a booking your Unit is "Equipment" under the SirReel Rental Agreement and receives every protection that agreement gives SirReel-owned equipment, including the production’s indemnity and insurance obligations described in Section 4.',
  },
  {
    ref: '4',
    title: 'Insurance',
    body: 'Production’s insurance. The SirReel Rental Agreement requires every production to carry commercial general liability insurance and rented-equipment (inland marine) coverage for equipment in its care, custody and control, naming SirReel as additional insured and loss payee, on a primary and non-contributory basis, and to indemnify SirReel for loss of or damage to Equipment. Because your Unit is Equipment during the booking, that coverage and indemnity extend to it, and SirReel will pursue them first for any loss that occurs on a booking. SirReel’s insurance. SirReel maintains commercial general liability insurance and coverage for rented equipment in its care, custody and control, and will provide you a certificate on request. Your insurance. As the owner you keep your own commercial general liability insurance and property or inland-marine coverage on each Unit at all times, and commercial auto liability on every vehicle you use to deliver and collect Units, with SirReel Production Vehicles, Inc. named as additional insured on liability. The parties intend your coverage to sit behind the production’s and SirReel’s coverage for a loss during a booking, to the extent your policy allows. You will give SirReel a certificate of insurance when you sign this Agreement and each time a policy renews, and at least 30 days’ written notice of any cancellation or material change.',
  },
  {
    ref: '5',
    title: 'Loss or Damage',
    body: 'SirReel is responsible to you for loss of or damage to a Unit from the time it leaves your yard until it is returned, ordinary wear and tear excepted. Damage is valued at the reasonable cost of repair, not to exceed the Unit’s actual cash value immediately before the loss; a total loss or theft is valued at actual cash value. Loss of use is paid at the booked daily rate for the reasonable repair period, up to ten days. SirReel satisfies this responsibility first through the insurance and indemnity in Section 4 and you agree to cooperate with those claims, including making the Unit available for inspection and providing repair estimates and proof of ownership; SirReel remains responsible if those sources do not pay. Your delivery ticket and SirReel’s condition report at delivery are the baseline for the Unit’s condition, and either party may photograph the Unit at delivery and collection.',
  },
  {
    ref: '6',
    title: 'Condition, Maintenance and Compliance',
    body: 'You deliver each Unit clean, serviced, fueled, load-tested where applicable, with current certifications, required placards and permits, working safety devices and spill containment where the law or the location requires it, and you keep it that way between bookings. You are responsible for all scheduled maintenance and for repairs of mechanical failure not caused by misuse during a booking. If a Unit fails on a booking because of its condition, you will repair or replace it promptly at your cost through your service line, or SirReel may substitute another unit and reduce your charge for the time the Unit was out of service. SirReel pays for fuel consumed during the booking at pump price or the refuel rate listed on your partner page, for consumables listed there, and for cleaning beyond a normal wash and any citation incurred during the booking.',
  },
  {
    ref: '7',
    title: 'Delivery, Setup and Service',
    body: 'You deliver, position, connect, start and collect each Unit with your own personnel, who remain your employees or contractors: you are responsible for their training, licensing, wages, payroll taxes, workers’ compensation and safety compliance. SirReel does not supply operators or technicians, for your Units or for its own. For each booking you name a delivery contact on your partner page — a person SirReel can reach by mobile on the day — and SirReel gives you the delivery address, access notes and the time the production needs power or the Unit in place, as the production sets them. Delivery, setup, standby technician time and collection are charged only at the rates listed on your partner page. On site your personnel follow the production’s reasonable direction about where and when the work happens but take instruction about the Unit only from SirReel and you.',
  },
  {
    ref: '8',
    title: 'Rates and Payment',
    body: 'Your listed rate for a Unit is the rate the production pays. SirReel keeps the share of the rental rate stated in the Terms box on the first page of this Agreement and pays you the remainder, calculated on the rate listed for the Unit on your partner page at the time the booking is confirmed, plus any ancillary charges listed there (delivery and collection, fuel, cable and distribution, generator hours, technician time and the like), which are paid to you in full unless your partner page says otherwise. Nothing else is chargeable unless SirReel approves it in writing before it is incurred. You invoice SirReel after the Unit is collected, referencing SirReel’s booking number, and SirReel pays within 30 days of receiving a correct invoice. You will not invoice, quote or collect from a production for any Unit placed through SirReel.',
  },
  {
    ref: '9',
    title: 'Confidentiality and Non-Circumvention',
    body: 'Each party keeps the other’s pricing confidential: SirReel does not disclose your rates or the partner share to its clients, and you do not disclose SirReel’s client rates, production details, call times or locations to anyone who does not need them to perform a booking. For twelve months after any booking you will not solicit or accept a rental of equipment directly from the production company, its producers or its production department for the same production or a project you learned of through the booking, unless SirReel agrees in writing. Productions you already worked with before this Agreement, documented in writing to SirReel when you sign, are excluded.',
  },
  {
    ref: '10',
    title: 'Marketing Your Equipment',
    body: 'You choose which of your Units SirReel may offer to its clients. For each Unit you approve, you permit SirReel to describe and picture it to productions, on sirreel.com and in SirReel quotes, presented as equipment SirReel supplies, without naming you. That permission is yours to withdraw for any Unit at any time, from your partner page or by email, with no notice period and no reason required. SirReel stops offering the withdrawn Unit when the withdrawal is received and removes it from sirreel.com promptly; bookings already confirmed for it are unaffected unless you and SirReel agree otherwise. SirReel does not use your name, logo or trademarks in any client-facing material without your written permission.',
  },
  {
    ref: '11',
    title: 'Mutual Indemnity',
    body: 'Each party protects the other. You will defend and indemnify SirReel, its officers, employees, agents and clients against claims, damages, fines and costs, including reasonable attorneys’ fees, to the extent they arise from the title, certification or condition of a Unit, from your breach of this Agreement, or from the acts or omissions of personnel you supply, including in delivery, setup and collection. SirReel will defend and indemnify you, your officers, employees and agents against claims, damages, fines and costs, including reasonable attorneys’ fees, to the extent they arise from the use or operation of a Unit during a booking, from SirReel’s breach of this Agreement, or from the acts or omissions of SirReel’s personnel and clients, and SirReel may satisfy this through the production’s indemnity and insurance under the SirReel Rental Agreement. Where a claim arises from both parties’ conduct, each bears its proportionate share. Neither party is liable to the other for lost profits or consequential damages except for the loss-of-use amount in Section 5 and the indemnities in this Section.',
  },
  {
    ref: '12',
    title: 'Independent Parties',
    body: 'You and SirReel are independent contractors. Nothing in this Agreement makes either party the agent, partner, joint venturer or employer of the other, and neither may bind the other. You are not exclusive to SirReel and may rent your Units to others when they are not booked, subject to Sections 9 and 10.',
  },
  {
    ref: '13',
    title: 'Term and Termination',
    body: 'This Agreement begins on the date you sign it and runs for one year, then renews automatically for successive one-year terms. Either party may end it for any reason on 30 days’ written notice; bookings already confirmed for dates after the notice period continue under this Agreement unless both parties agree otherwise. SirReel may suspend bookings immediately if your insurance lapses, a Unit is found unsafe or uncertified, or you breach Section 9. Sections 4, 5, 9 and 11 survive termination for any booking that occurred while this Agreement was in effect.',
  },
  {
    ref: '14',
    title: 'Notices and Records',
    body: 'Your SirReel partner page is the record of Units, rates, bookings and delivery contacts under this Agreement, and notices posted there or sent to the email addresses each party keeps on file are effective when sent. Either party may update its contact information on the partner page or by email.',
  },
  {
    ref: '15',
    title: 'Governing Law and Disputes',
    body: 'This Agreement is governed by the laws of the State of California. Any dispute the parties cannot resolve between themselves will be brought in the state or federal courts located in Los Angeles County, California, and the prevailing party recovers its reasonable attorneys’ fees and costs.',
  },
  {
    ref: '16',
    title: 'Entire Agreement',
    body: 'This Agreement, together with the Unit listings, rates and booking records on your partner page, is the entire agreement between the parties about your equipment and replaces any earlier understanding. It may be changed only in a writing signed or electronically accepted by both parties. If any part is unenforceable the rest remains in effect. Electronic signatures and copies are as effective as originals.',
  },
]
