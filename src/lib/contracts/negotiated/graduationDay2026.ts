/**
 * The negotiated rental agreement — Graduation Day Productions' redline, as
 * agreed.
 *
 * TRANSCRIBED, NOT REWRITTEN. Every clause below is the client's counsel's
 * text, extracted from SirReel_Redlined_RentalAgreement_2026.pdf (5 pages,
 * produced 2026-05-15) by machine and not retyped. Wes, 2026-09-15: "We
 * already went back and forth with their lawyer and landed here... ideally we
 * just rebrand the document they submitted." So nothing here may be edited to
 * read more like our baseline — a word changed here is a term renegotiated
 * without telling anyone.
 *
 * ── How it differs from CANONICAL_CLAUSES ──────────────────────────────
 *  - Clause 15 (Subrogation) is DELETED. Their numbering keeps the gap:
 *    14 → 16. Clause 9's waiver of subrogation survives. Softened from
 *    critical to needs_review by Wes on 2026-09-15, so this is not a bar.
 *  - Clauses 22 (Rights in Recordings) and 23 (Waiver of Injunctive Relief)
 *    are THEIRS, added. Our 22–29 therefore sit at their 24–31.
 *  - Clauses 22, 23 and 24 carry a TRAILING PERIOD on the title; the other 27
 *    do not. That is their document, not a typo of ours: their counsel set
 *    those three as "Title. Body" on one line and the rest as a heading on
 *    its own line. The render normalised it away at first; Wes, 2026-09-15:
 *    "restore the periods." Their paper, their punctuation — matching it
 *    exactly costs nothing and leaves one less thing to explain if anyone
 *    ever lays the two documents side by side.
 *  - Reviewed against every CRITICAL rule in reviewPrompt.ts and clean: the
 *    consequential-damages cap survives (and extends to our own gross
 *    negligence), indemnity stays one-way and is not narrowed to third-party
 *    claims, all four insurance minimums stand with primary &
 *    non-contributory and additional-insured intact, venue is LA/JAMS,
 *    governing law California, and the theft police-report survives.
 *
 * ── The gap this file does NOT close ───────────────────────────────────
 * Their document ends at Non-smoking. It carries NO Fleet Agreement, NO LCDW
 * Addendum and no Third-Party Equipment clause (ours postdates their May
 * redline). Those are appended by `assembleNegotiatedAgreement()`, never
 * merged in here — see negotiatedAgreement.ts for why they are additions
 * rather than edits, and read that file before filing this for anyone.
 *
 * Regenerating: re-extract with pdftotext -layout and re-parse. The only
 * line-wrap hyphen in the document is "non-payment" in clause 21, which is a
 * real hyphen — never de-hyphenate this text blind.
 */
import type { CanonicalClause } from '../contractClauses'

/** Their clauses, in their numbering, including the deliberate gap at 15. */
export const GRADUATION_DAY_2026_CLAUSES: CanonicalClause[] = [
  {
    ref: '1',
    title: 'Indemnity',
    body:
      'Lessee/Renter (“You”) agree to defend, indemnify, and hold SirReel Production Vehicles, Inc. dba SirReel Studio Rentals, our agents, employees, assignees, suppliers, sub-lessors and sub-renters (“Us” or “We”) harmless from and against any and all claims, actions, causes of action, demands, rights, verifiable damages of any kind, costs, expenses and compensation whatsoever including court costs and reasonable outside attorneys’ fees (“Claims”), in any way arising from, or in connection with, the Vehicles and Equipment rented/leased (which vehicles and equipment, together, are referred to in this document as “Equipment”), including, without limitation, as a result of its use, maintenance, or possession, irrespective of the cause of the Claim, except to the extent caused by Our gross negligence or willful misconduct, or by a pre-existing latent or structural defect actually known by Lessor and not disclosed to You, from the time You take care, custody or control of the Equipment until the Equipment is returned to Our care, custody and control.',
  },
  {
    ref: '2',
    title: 'Loss of or Damage to Equipment',
    body:
      'You are responsible for loss, damage (reasonable wear and tear excepted) or destruction of the Equipment, including but not limited to losses while in transit, while loading and unloading, while at any and all locations, while in storage and while on your premises, except that you are not responsible for damage to or loss of the Equipment caused by our sole negligence or willful misconduct.',
  },
  {
    ref: '3',
    title: 'Protection of Others',
    body:
      'You will take reasonable precautions in regard to the use of the Equipment to protect all persons and property from injury or damage. The Equipment shall be used only by your employees or agents qualified to use the Equipment.',
  },
  {
    ref: '4',
    title: 'Equipment in Working Order',
    body:
      'We have tested the Equipment in accordance with reasonable industry standards and found it to be in working order immediately prior to the inception of this Agreement, and to the extent you have disclosed to us all of the intended uses of the Equipment, it is fit for its intended purpose. Other than what is set forth herein, you acknowledge that the Equipment is rented/leased without warranty, or guarantee, except as required by law or otherwise agreed upon by the parties at the inception of this Agreement.',
  },
  {
    ref: '5',
    title: 'Property Insurance',
    body:
      'You shall, at your own expense, maintain at all times during the term of this Agreement, all risk perils property insurance ("Property Insurance") covering the Equipment from all sources (Equipment Rental Floater or Production Package Policy) including coverage for, without limitation, (i) theft by force (ii) theft by fraudulent scheme and/or "voluntary parting" (iii) mysterious disappearance (iv) loss of use of the Equipment. Coverage shall begin from the time you or your or agents pick the Equipment up at our place of business, or take delivery of the Equipment, whichever is applicable, and shall continue until the time the Equipment is returned to and accepted by us. The Property Insurance shall be on a worldwide basis shall name us as an additional insured and as the loss payee with respect to the Equipment and shall cover all risks of loss of, or damage or destruction to the Equipment. The Property Insurance coverage shall be sufficient to cover the Equipment at its replacement value but shall, in no event, be less than $1,000,000. The Property Insurance shall be primary & Non-Contributory coverage.',
  },
  {
    ref: '6',
    title: 'Workers Compensation & Employers Liability Insurance',
    body:
      'You shall, at your own expense, maintain worker\'s compensation/employer\'s liability insurance during the course of the Equipment rental with minimum limits of $1,000,000. Including coverage for the use of any volunteers, interns, or independent contractors working on your behalf and under your supervision.',
  },
  {
    ref: '7',
    title: 'Liability Insurance',
    body:
      'You shall, at your own expense, maintain commercial general liability insurance ("Liability Insurance"), including coverage for the operations of independent contractors and standard contractual liability coverage. The Liability Insurance shall name us as an additional insured and provide that said insurance is primary & Non-Contributory coverage. Such insurance shall remain in effect during the course of this Agreement, and shall include, without limitation, the following coverages: standard contractual liability, personal injury liability, completed operations, and product liability. The Liability Insurance shall provide general liability aggregate limits of not less than $2,000,000 (including the coverage specified above) and not less than $1,000,000 per occurrence.',
  },
  {
    ref: '8',
    title: 'Vehicle Insurance',
    body:
      'You shall, at your own expense, maintain business motor vehicle liability insurance ("Vehicle Insurance"), including coverage for loading and unloading Equipment and hired motor vehicle physical damage insurance, covering owned, non-owned, hired and rented vehicles, including utility vehicles such as trailers. Coverage for physical damage shall include "comprehensive" and "collision" coverage. We shall be named as an additional insured with respect to the liability coverage, and as a loss payee with respect to the physical damage coverage. The Vehicle Insurance shall also include coverage for pollution caused by any vehicles. The Vehicle Insurance shall provide not less than $1,000,000 in combined single limits liability coverage and include replacement cost for physical damage and shall provide that said insurance is primary coverage & Non-Contributory with respect to all insureds, the limits of which must be exhausted before any obligation arises under our insurance.',
  },
  {
    ref: '9',
    title: 'Insurance Generally',
    body:
      'All insurance maintained by you pursuant to the foregoing provisions shall contain a waiver of subrogation rights in respect of any liability imposed by this Agreement on you as against us. You shall hold us harmless and indemnify us from and shall bear the expense of any applicable deductible amounts and self insured retentions provided for by any of the insurance policies required to be maintained under this Agreement. In the event of loss, you shall promptly pay amount of the deductible amount or self-insured retention or the applicable portion thereof to us or the insurance carrier, as applicable. Notwithstanding anything to the contrary contained in this Agreement, the fact that a loss may not be covered by insurance provided by you under this Agreement or, if covered, is subject to deductibles, retentions, conditions or limitations shall not affect your liability for any loss. Should you fail to procure or pay the cost of maintaining in force the insurance specified herein, or to provide us upon request with satisfactory evidence of the insurance, we may, but shall not be obliged to, procure the insurance and you shall reimburse us on demand for its costs. Lapse, reduction in coverage or cancellation of the required insurance shall be deemed to be an immediate and automatic default of this agreement. If this happens, we need to be immediately notified of such occurrence. The grant by you of a sublease of the Equipment rented/leased shall not affect your obligation to procure insurance on our behalf, or otherwise affect your obligations under this Agreement.',
  },
  {
    ref: '10',
    title: 'Cancellation of Insurance',
    body:
      'You shall provide us with not less than 30 days written notice prior to the effective date of any cancellation or material change to any insurance maintained by you pursuant to the foregoing provisions. You shall ensure that all Certificates of Insurance provided to us include a provision requiring the insurance carrier to provide us with not less than 30 days written notice of cancellation or material change.',
  },
  {
    ref: '11',
    title: 'Certificates of Insurance',
    body:
      'Before obtaining possession of the Equipment you shall provide to us Certificates of Insurance confirming the coverages specified above. All certificates shall be signed by an authorized agent or representative of the insurance carrier.',
  },
  {
    ref: '12',
    title: 'Drivers',
    body:
      'Any and all drivers who drive the Vehicles you are renting/leasing from us shall be duly licensed, trained and qualified to drive vehicles of this type. Although we may, from time to time, recommend certain qualified drivers with whom we are familiar, we do not supply drivers. You must supply and employ any driver who drives our Vehicles (even if the driver is the registered owner of the vehicle or owner of a company that owns the vehicle) and that driver shall be deemed to be your employee or covered independent contracted driver for all purposes and shall be covered as an insured on all of your applicable insurance policies.',
  },
  {
    ref: '13',
    title: 'Compliance With Law and Regulations',
    body:
      'You agree to comply with the laws of all states in which the Equipment is transported and/or used as well as all federal and local state laws, regulations, and ordinances pertaining to the transportation and use of such Equipment. Without limiting the generality of the foregoing and by way of example, you shall at all times (i) display all necessary and proper placards; obtain all necessary permits; and (ii) keep all required logs and records. You shall indemnify and hold us harmless from and against any and all fines, levies, penalties, taxes and seizures by any governmental authority in connection with or as a result of your possession or use of the Equipment including, without limitation, the full replacement value of the Equipment in the event of seizure or impound, including our reasonable costs and reasonable outside attorney fees, except if in connection to Our gross negligence or willful misconduct.',
  },
  {
    ref: '14',
    title: 'Valuation of Loss / Our Liability is Limited',
    body:
      'Unless otherwise agreed in writing, you shall be responsible to us for the actual and verifiable replacement cost value or repair cost of the Equipment (if the Equipment can be restored, by repair, to its pre-loss condition) whichever is less. If there is a reason to believe a theft has occurred, you shall file a police report. Loss of use shall be calculated at the rental rate provided for in this Agreement. Accrued rental charges shall not be applied against the purchase price or cost of repair of the lost, stolen or damaged Equipment. In the event of loss for which we are responsible or due to Our gross negligence or willful misconduct, we will, in no event, be liable for any consequential, special or incidental damages. In the event of loss for which You are responsible, you will, in no event, be liable to Us for any consequential, special or incidental damages, other than loss of use damages which may be owed by You to Us.',
  },
  {
    ref: '16',
    title: 'Bailment',
    body:
      'This agreement constitutes an Agreement or bailment of the Equipment and is not a sale or the creation of a security interest. You will not have, or at any time acquire, any right, title, or interest in the Equipment, except the right to possession and use as provided for in this Agreement. We will at all times be the sole owner of the Equipment.',
  },
  {
    ref: '17',
    title: 'Condition of Equipment',
    body:
      'Condition of Equipment. You assume all obligation and liability with respect to the possession of Equipment, and for its use, condition and storage during the term of this Agreement except as otherwise set forth herein. You will, at your own expense, maintain the Equipment in as good as condition as received (reasonable wear and tear excepted). The rent on any of the Equipment will not be prorated or abated while the Equipment is being serviced or repaired for any reason for which You are liable. We will not be under any liability or obligation in any manner to provide service, maintenance, repairs, or parts for the Equipment, except as otherwise specially agreed by Us in writing or due to Our gross negligence or willful misconduct. All installations, replacements, and substitutions of parts or accessories with respect to any of the Equipment will become part of the Equipment and will be owned by us.',
  },
  {
    ref: '18',
    title: 'Identity',
    body:
      'We will have the right to place and maintain on the exterior or interior of each piece of property covered by this Agreement the following inscription: Property of SirReel. You will not remove, obscure, or deface the inscription or permit any other person to do so.',
  },
  {
    ref: '19',
    title: 'Expenses',
    body:
      'You will be responsible for all expenses, including but not limited to fuel, lubricants, and all other charges in connection with the operation of the Equipment.',
  },
  {
    ref: '20',
    title: 'Accident Reports',
    body:
      'If any of the Equipment is damaged, lost stolen, or destroyed, or if any person is injured or dies, or if any property is damaged as a result of its use, maintenance, or possession, you will promptly notify us of the occurrence, and will file all necessary accident reports, including those required by law and those required applicable insurers. You, your employees, and agents will cooperate fully with us and all insurers providing insurance under this Agreement in the investigation and defense of any claims. You will promptly deliver to us any documents served or delivered to you, your employees, or your agents in connection with any claim or proceeding at law or in equity begun or threatened against you, us, or both of us.',
  },
  {
    ref: '21',
    title: 'Default',
    body:
      'If you fail to pay any portion or installment of the total fees payable hereunder or otherwise materially breach this Agreement, then such failure or breach shall constitute a default (“Default”). Upon the occurrence of any such Default, and in addition to all other rights and remedies available at law or in equity, We shall provide written notice and a commercially reasonable opportunity to cure where applicable before terminating this Agreement and ceasing performance hereunder; provided, however, that no cure period shall be required in situations involving non-payment (provided such cure period shall be reduced to 12 hours), lapse or cancellation of required insurance, safety concerns, illegal activity, intentional material misuse of the Equipment, or intentional material risk of loss or damage to the Equipment. You further agree that the continuation of our performance hereunder after a Default shall not constitute a waiver or operate as any form of estoppel with respect to our later assertion of its rights hereunder.',
  },
  {
    ref: '22',
    title: 'Rights in Recordings.',
    body:
      'All rights of every kind in and to all photographs, film and recordings made by Lessee utilizing the Equipment (but not taking recordings of the Equipment) shall be and remain vested in Lessee, its licensees, successors and assigns, including, without limitation, the right to use and reuse all such photographs, film and recordings (“Recordings”) in all manner and media now known or hereafter devised, in perpetuity, throughout the universe, and in connection with advertisements, promotions, publicity, clips, etc., related to the photographs, film and recordings made by Lessee.',
  },
  {
    ref: '23',
    title: 'Waiver of Injunctive Relief.',
    body:
      'In no event shall Lessor be entitled to enjoin, restrain or otherwise impair in any manner Lessee’s production, distribution, exhibition, exploitation, advertising, publicity or promotion of the Recordings.',
  },
  {
    ref: '24',
    title: 'Return.',
    body:
      'Upon the expiration date of this Agreement with respect to any or all Equipment, you will return the property to us, together with all accessories, free from all damage, reasonable wear and tear excepted and in the same condition and appearance as when received by you, reasonable wear and tear excepted.',
  },
  {
    ref: '25',
    title: 'Additional Equipment',
    body:
      'Additional Equipment may from time to time be added as the subject matter of this Agreement as agreed on by the parties. Any additional property will be added in an amendment describing the property, the monthly rental, security deposit, and stipulated loss value of the additional Equipment. All amendments must be in writing and signed by both parties. Other than by this amendment procedure, this Agreement may not be amended, modified, or altered in any manner except in writing signed by both parties.',
  },
  {
    ref: '26',
    title: 'Entire Agreement',
    body:
      'This Agreement and any attached schedules, which are incorporated by reference and made an integral part of this Agreement, constitute the entire agreement between the parties. No agreements, representations, or warranties other than those specifically set forth in this Agreement or in the attached schedules shall be binding on any party unless set forth in writing and signed by both parties.',
  },
  {
    ref: '27',
    title: 'Applicable Law',
    body:
      'This Agreement shall be deemed executed and delivered in Los Angeles, California and shall be governed by and construed in accordance with the laws of the State of California.',
  },
  {
    ref: '28',
    title: 'Arbitration',
    body:
      'Any controversy or claim arising out of or related to this Agreement or breach of this Agreement shall be settled by arbitration in Los Angeles, California under the auspices of JAMS. The arbitration shall be conducted by a single arbitrator under the JAMS Streamlined Arbitration Rules. The decision and award of the arbitrator shall be final and binding and any award may be entered in any court having jurisdiction. The prevailing party in any such arbitration shall be entitled to recover reasonable attorneys’ fees and costs in addition to any other relief granted.',
  },
  {
    ref: '29',
    title: 'Severability',
    body:
      'If any provision of this Agreement or the application of any of its provisions to any party or circumstance is held invalid or unenforceable, the remainder of this Agreement, and the application of those provisions to the other parties or circumstances, will remain valid and in full force and effect.',
  },
  {
    ref: '30',
    title: 'Facsimile Signature',
    body:
      'This Agreement may be executed by facsimile signature and such signature shall be deemed a valid and binding original signature.',
  },
  {
    ref: '31',
    title: 'Non-smoking policy',
    body:
      'All vehicles are non-smoking vehicles and lessee is responsible for all damages caused from smoking in or near the vehicles. A $250 per day fee may be charged lessee in addition to the cost to repair any damaged items if the smoking policy is not observed.',
  },
]

/** Their section lede, verbatim — identical to ours, but kept with their text. */
export const GRADUATION_DAY_2026_LEDE =
  'Please read carefully. You are liable for our equipment and vehicles from the time they leave our premises until the time they are returned to us and we sign for them.'
