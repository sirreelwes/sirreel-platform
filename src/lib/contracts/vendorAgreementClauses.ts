/**
 * SirReel Partner Vehicle Agreement — the B2B contract between SirReel and
 * a partner who owns vehicles we place on productions (King Kong PV and any
 * other vendor on the sub-rental roster).
 *
 * Wes 2026-09-05: "a simple b2b contract between vendor and SirReel. This
 * functions as a rental agreement to make sure the vehicle we provide to
 * production is covered under our rental agreement with the client and our
 * insurance."
 *
 * The mechanism, in one breath: the partner rents the vehicle to SirReel,
 * SirReel subleases it to the production under the SirReel Rental Agreement,
 * so during a booking the partner's vehicle IS "Equipment" under that
 * agreement — which is what puts the production's insurance (which names
 * SirReel additional insured / loss payee for owned, hired and rented
 * vehicles) and SirReel's own coverage over it. Clauses 3 and 4 carry that
 * chain; everything else is ordinary rental hygiene.
 *
 * This text is canonical. The PDF (VendorAgreementDocument.tsx) renders it
 * verbatim; a partner signs it through /vendor/account/[token]/sign, which
 * appends a signature page. Edit the words here, never in the renderer.
 *
 * Where the client agreement (contractClauses.ts) sets a number we mirror it
 * so the two documents do not contradict each other: 24-hour cancellation,
 * one day's rate on a late cancel, 30 days' notice on insurance changes,
 * California law.
 */

export interface VendorAgreementClause {
  ref: string
  title: string
  body: string
}

export const VENDOR_AGREEMENT_TITLE = 'Partner Vehicle Agreement'
export const VENDOR_AGREEMENT_VERSION = '2026-09-05'

export const VENDOR_AGREEMENT_SIRREEL = {
  legalName: 'SirReel Production Vehicles, Inc.',
  dba: 'SirReel',
  address: '8500 Lankershim Blvd, Sun Valley, CA 91352',
  signerName: 'Wes Bailey',
  signerTitle: 'CEO',
} as const

export const VENDOR_AGREEMENT_OPENING =
  'This Partner Vehicle Agreement (the "Agreement") is between SirReel Production Vehicles, Inc. ("SirReel", "we", "us") and the partner named below ("Partner", "you"). SirReel rents production vehicles to film, television and commercial productions under its standard rental agreement (the "SirReel Rental Agreement"). You own or control vehicles you are willing to make available to SirReel for those productions. This Agreement sets the terms under which SirReel rents your vehicles and places them with its clients, so that each vehicle is covered the same way a SirReel-owned vehicle would be.'

export const VENDOR_AGREEMENT_CLAUSES: VendorAgreementClause[] = [
  {
    ref: '1',
    title: 'Vehicles Covered',
    body: 'This Agreement covers every vehicle, trailer and piece of related equipment you list on your SirReel partner page, and any other vehicle you make available to SirReel in writing (each a "Vehicle"). Listing a Vehicle is a standing offer to rent it to SirReel at the listed rates whenever it is available. You may add or remove Vehicles and propose rate changes at any time; a rate change applies to bookings confirmed after SirReel accepts it, and never to a booking already confirmed. You represent that for each Vehicle you hold clear title or the owner’s written authority to rent it, that its registration is current, and that it is roadworthy and lawful to operate for its intended use.',
  },
  {
    ref: '2',
    title: 'Bookings',
    body: 'Each booking is a separate rental of a Vehicle from you to SirReel under this Agreement. A booking is confirmed when SirReel sends you the booking through your partner page and you confirm the Vehicle is held for those dates. The rental period runs from the time the Vehicle leaves your lot (or the point of origin agreed for that booking) until it is returned there and accepted by you. If SirReel cancels a confirmed booking less than 24 hours before the scheduled pickup, you may charge one day at the booked rate for that Vehicle, waived if you re-rent it for those dates. Cancellations are given in writing through the partner page or by email.',
  },
  {
    ref: '3',
    title: 'SirReel Is the Renter; Sublease to Production',
    body: 'During a booking SirReel is the renter of your Vehicle and you consent to SirReel subleasing it to its production client under the SirReel Rental Agreement. SirReel is solely responsible to the production and the production is solely responsible to SirReel; you have no contract with the production and will not look to it for payment. While it is on a booking your Vehicle is "Equipment" under the SirReel Rental Agreement and receives every protection that agreement gives SirReel-owned equipment, including the production’s indemnity and insurance obligations described in Section 4.',
  },
  {
    ref: '4',
    title: 'Insurance',
    body: 'Production’s insurance. The SirReel Rental Agreement requires every production to carry commercial auto liability and hired-vehicle physical damage insurance covering owned, non-owned, hired and rented vehicles, naming SirReel as additional insured and loss payee, on a primary and non-contributory basis, and to indemnify SirReel for loss of or damage to Equipment. Because your Vehicle is Equipment during the booking, that coverage and indemnity extend to it, and SirReel will pursue them first for any loss that occurs on a booking. SirReel’s insurance. SirReel maintains commercial auto liability insurance, including hired and non-owned coverage, and physical damage coverage for vehicles in its care, custody and control, and will provide you a certificate on request. Your insurance. As the registered owner you keep your own auto liability and physical damage insurance on each Vehicle at all times, with SirReel Production Vehicles, Inc. named as additional insured on liability. The parties intend your coverage to sit behind the production’s and SirReel’s coverage for a loss during a booking, to the extent your policy allows. You will give SirReel a certificate of insurance when you sign this Agreement and each time a policy renews, and at least 30 days’ written notice of any cancellation or material change.',
  },
  {
    ref: '5',
    title: 'Loss or Damage',
    body: 'SirReel is responsible to you for loss of or damage to a Vehicle from the time it leaves your lot until it is returned, ordinary wear and tear excepted. Damage is valued at the reasonable cost of repair, not to exceed the Vehicle’s actual cash value immediately before the loss; a total loss or theft is valued at actual cash value. Loss of use is paid at the booked daily rate for the reasonable repair period, up to ten days. SirReel satisfies this responsibility first through the insurance and indemnity in Section 4 and you agree to cooperate with those claims, including making the Vehicle available for inspection and providing repair estimates and title documents; SirReel remains responsible if those sources do not pay. SirReel’s condition report at check-out is the baseline for the Vehicle’s condition, and you may attend the check-out to review it.',
  },
  {
    ref: '6',
    title: 'Condition, Maintenance and Compliance',
    body: 'You deliver each Vehicle clean, fueled, mechanically sound, with current registration, required placards and permits, working safety equipment and any inspection or emissions certificate the law requires, and you keep it that way between bookings. You are responsible for all scheduled maintenance and for repairs of mechanical failure not caused by misuse during a booking. If a Vehicle fails on a booking because of its mechanical condition, you will repair or replace it promptly at your cost, or SirReel may substitute another vehicle and reduce your charge for the time the Vehicle was out of service. SirReel returns each Vehicle with the same fuel level it left with, or reimburses fuel at pump price, and pays for cleaning beyond a normal wash, tolls, and traffic or parking citations incurred during the booking.',
  },
  {
    ref: '7',
    title: 'Drivers',
    body: 'A Vehicle may be driven by drivers SirReel approves, which may include SirReel staff, the production’s qualified drivers as permitted by the SirReel Rental Agreement, or drivers you supply. Every driver must be properly licensed for the Vehicle and insured under the coverage in Section 4. Drivers you supply remain your employees or contractors: you are responsible for their licensing, medical cards where required, wages, payroll taxes, workers’ compensation and hours-of-service compliance, and SirReel pays you the driver rate agreed for the booking. Driver time is measured portal to portal from your lot, recorded on the partner page, and paid in the increments shown there. On set your driver follows the production’s reasonable direction about the work but takes instruction about the Vehicle only from SirReel and you.',
  },
  {
    ref: '8',
    title: 'Rates and Payment',
    body: 'SirReel pays you the rate listed for the Vehicle on your partner page at the time the booking is confirmed, less the partner discount recorded for that Vehicle in SirReel’s system, plus any ancillary fees listed there (delivery, mileage, generator hours, cleaning and the like) and any driver time under Section 7. Nothing else is chargeable unless SirReel approves it in writing before it is incurred. You invoice SirReel after the Vehicle is returned, referencing SirReel’s booking number, and SirReel pays within 30 days of receiving a correct invoice. You will not invoice, quote or collect from a production for any Vehicle placed through SirReel.',
  },
  {
    ref: '9',
    title: 'Confidentiality and Non-Circumvention',
    body: 'Each party keeps the other’s pricing confidential: SirReel does not disclose your rates or the partner discount to its clients, and you do not disclose SirReel’s client rates, production details, call times or locations to anyone who does not need them to perform a booking. For twelve months after any booking you will not solicit or accept a rental of vehicles directly from the production company, its producers or its transportation department for the same production or a project you learned of through the booking, unless SirReel agrees in writing. Productions you already worked with before this Agreement, documented in writing to SirReel when you sign, are excluded.',
  },
  {
    ref: '10',
    title: 'Indemnity',
    body: 'You will defend and indemnify SirReel, its officers, employees, agents and clients against claims, damages, fines and costs, including reasonable attorneys’ fees, arising from the title, registration or mechanical condition of a Vehicle, from your breach of this Agreement, or from the acts or omissions of drivers and personnel you supply. SirReel will defend and indemnify you against claims arising from the use or operation of a Vehicle during a booking, except to the extent caused by a matter you indemnify above, and SirReel may satisfy this through the production’s indemnity and insurance under the SirReel Rental Agreement. Neither party is liable to the other for lost profits or consequential damages except for the loss-of-use amount in Section 5 and the indemnities in this Section.',
  },
  {
    ref: '11',
    title: 'Independent Parties',
    body: 'You and SirReel are independent contractors. Nothing in this Agreement makes either party the agent, partner, joint venturer or employer of the other, and neither may bind the other. You are not exclusive to SirReel and may rent your Vehicles to others when they are not booked, subject to Section 9.',
  },
  {
    ref: '12',
    title: 'Term and Termination',
    body: 'This Agreement begins on the date you sign it and runs for one year, then renews automatically for successive one-year terms. Either party may end it for any reason on 30 days’ written notice; bookings already confirmed for dates after the notice period continue under this Agreement unless both parties agree otherwise. SirReel may suspend bookings immediately if your insurance lapses, a Vehicle is found unsafe or unregistered, or you breach Section 9. Sections 4, 5, 9 and 10 survive termination for any booking that occurred while this Agreement was in effect.',
  },
  {
    ref: '13',
    title: 'Notices and Records',
    body: 'Your SirReel partner page is the record of Vehicles, rates, bookings, driver assignments and hours under this Agreement, and notices posted there or sent to the email addresses each party keeps on file are effective when sent. Either party may update its contact information on the partner page or by email.',
  },
  {
    ref: '14',
    title: 'Governing Law and Disputes',
    body: 'This Agreement is governed by the laws of the State of California. Any dispute the parties cannot resolve between themselves will be brought in the state or federal courts located in Los Angeles County, California, and the prevailing party recovers its reasonable attorneys’ fees and costs.',
  },
  {
    ref: '15',
    title: 'Entire Agreement',
    body: 'This Agreement, together with the Vehicle listings, rates and booking records on your partner page, is the entire agreement between the parties about your Vehicles and replaces any earlier understanding. It may be changed only in a writing signed or electronically accepted by both parties. If any part is unenforceable the rest remains in effect. Electronic signatures and copies are as effective as originals.',
  },
]

/** Fixed pre-signature text the partner adopts on their sign page. Generic
 *  on purpose: the same sign page also executes a hand-uploaded PDF whose
 *  title may differ from this document's. */
export const VENDOR_AGREEMENT_ACK =
  'I have read the partner agreement above and agree to its terms on behalf of my company. By typing my name and clicking Sign, I am providing my electronic signature, which has the same legal effect as a handwritten signature under the U.S. ESIGN Act and California UETA.'
