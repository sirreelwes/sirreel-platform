/**
 * Canonical clause text for the SirReel Studio Services Stage Booking
 * contract. Mirrors public/contracts/sirreel-stage-contract.pdf — when
 * the canonical PDF changes, update this file too and keep clause
 * numbering and substance in lockstep.
 *
 * Shape parallels src/lib/contracts/contractClauses.ts (the rental
 * agreement). 14 numbered clauses + a parties opening + signature block.
 *
 * Deferred (not yet codified per CRH brief May 2026):
 *   - Stryker Addendum (Exhibit A in the .docx). The Stryker products
 *     release is partly mentioned in clause 12(b) but the full Addendum
 *     to Master Media Agreement is a separate document.
 *   - Per-company negotiated variants — for now there's only one
 *     canonical baseline.
 *   - Per-space pricing (LED stage vs Standing Sets rate differential).
 */

import type { CanonicalClause } from './contractClauses'

/** Opening recital. Rendered after the parties / terms block and
 *  before clause 1. The {{ }} placeholders use the same merge syntax as
 *  the rest of the template (resolved by stageContractTemplate render). */
export const STAGE_CONTRACT_OPENING =
  'This Agreement is made between SirReel Production Vehicles, Inc. dba SirReel Studio Services ("Licensor") whose address is 8500 Lankershim Blvd, Sun Valley, CA and the ("Producer") as noted above.'

/** No-filming notice that sits between clauses 4 and 5 in the canonical
 *  layout. Kept as a separate constant so the renderer can place it
 *  with its own visual treatment (centered, bold). */
export const STAGE_CONTRACT_NO_EXTERIOR_FILMING_NOTICE =
  'NO FILMING OF THE EXTERIOR OF THE PREMISES IS PERMITTED.'

/** Signature-block constants. Licensor side is pre-signed at PDF
 *  generation; producer side is filled in by the client during portal
 *  signing. */
export const STAGE_CONTRACT_LICENSOR = {
  party: 'SirReel Studio Services',
  signerName: 'Wes Bailey',
  signerTitle: 'CEO',
} as const

export const STAGE_CONTRACT_CLAUSES: CanonicalClause[] = [
  {
    ref: '1',
    title: 'Grant',
    body: 'For the term defined in the notes above, and for any extensions thereof, Licensor hereby grants to Producer (including its employees, representatives, independents contractors and suppliers), the non-assignable and non-exclusive right to enter upon Licensor\u2019s premises located at 8500 Lankershim Boulevard in Sun Valley, CA (\u201cPremises\u201d), and to use certain designated areas and/or sets (\u201cSets\u201d) (the Premises and Sets may from time to time be referred to collectively as the \u201cProperty\u201d), to bring equipment thereon for the purpose of making still and motion pictures, commercials, trailers and soundtrack recordings for the production noted above ("Production").',
  },
  {
    ref: '2',
    title: 'Description',
    body: 'Producer shall have the right to use the Sets including the furniture and fixtures located on or about the Sets (excluding any names, trademarks, logos and/or signage unless specifically agreed to through release agreement).',
  },
  {
    ref: '3',
    title: 'Fees, Term and Re-Entry',
    body:
      '(a) Term: Producer may use the Property on the dates specified above (\u201cTerm\u201d).\n\n' +
      '(b) Re-Entry: At any time within sixty (60) days from the date upon which the Term commenced and following not less than five (5) days\u2019 advance written notice to Licensor, Producer may re-enter upon the Property for such period as may be reasonably necessary to photograph retakes or added scenes, subject to the availability of the Property. The fees owed with respect to such re-entry shall be computed and paid on the basis specified in Paragraph 5 (a) hereof.',
  },
  {
    ref: '4',
    title: 'Use, Protection and Restoration of Property',
    body:
      '(a) Producer may use the Property for the purposes specifically stated herein, and for no unlawful purpose. Producer shall not allow anyone on the roof of the Property at any time. No smoking, eating or drinking is permitted on the Sets (unless required as part of the Production) or within any interior portion of the Property. If required in a scene, Producer will undertake all efforts to protect the Property from damage. No alcoholic beverages or illegal drugs shall be allowed on the Property at any time. No nudity shall be allowed without Licensor\u2019s prior written consent. When utilizing and/or filming inside the set, LAYOUT BOARD IS RECOMMENDED under any and all equipment with a hard surface that may damage the floor. A minimum charge of $500 will be charged if any damage occurs to the courtroom floor. Producer shall at no time store or keep any living creatures, noxious materials or hazardous substances (unless required as part of the Production and, in that case, only upon securing the appropriate permits). Producer agrees to remove from the Property all personnel, structures, equipment and material placed thereon by Producer by the end of the Term. Additional days (or any portion thereof) required to restore the Property to its original condition shall be billed to and paid by Producer at the rates specified in Paragraph 5 (a). The foregoing remedy shall be in addition to, and not in lieu of, any other remedies Licensor may seek as a result of any damages Licensor may suffer in connection with Producer\u2019s delay in vacating the Property. Producer shall park equipment and crew cars in assigned spaces on the Property. Equipment and crew cars will not be allowed in unassigned spaces or on adjacent streets. If such vehicles are towed, Producer shall bear sole responsibility and liability in connection therewith. A minimum of one security guard shall be on site on designated Shoot days, at Producer\u2019s expense, to insure compliance with above parking regulations. Producer shall, at all times, exercise common courtesy to all neighbors and shall not block traffic or access to neighbors in any way. Producer shall obtain all necessary licenses and permits from the City of Los Angeles and/or any other public, governmental or other entity having authority or jurisdiction (if required), for all activities to be conducted by Producer on the Property, and to follow all rules and regulations set forth by Licensor, the foregoing entities and/or the City of Los Angeles Fire Department, and City of Los Angeles Police Department regarding the Property and/or its surrounding neighborhood. Producer acknowledges that during the Term other parties may be present upon the Property for the purposes of filming and/or recording a motion picture or other audio/visual work. Accordingly, Producer agrees to conduct its activities in a courteous and professional manner and in accordance with Licensor\u2019s requests and instructions.',
  },
  {
    ref: '5',
    title: 'Fees',
    body:
      '(a) Location Fee: In consideration for the use of the Property and for all rights herein granted, Producer shall pay in advance the Location Fee due for each day (or part thereof) as set forth in the notes and ("Terms") above.\n\n' +
      '(b) Additional Rentals from SirReel Studios: Producer agrees that all additional rentals, including but not limited to Grip, Lighting, Production Supplies, Communications, Art and Special Effects Rentals must be contracted through the host studio, SirReel Studios, unless specifically otherwise agreed to by an authorized agent of SirReel Studios.',
  },
  {
    ref: '6',
    title: 'Utilities',
    body: 'The restrooms are available for responsible use. Producer agrees to pay for any necessary unclogging; pumping and/or damages caused directly by Producer\u2019s misuse of the Property bathrooms.',
  },
  {
    ref: '7',
    title: 'Security Deposit',
    body: 'Producer agrees to pay to Licensor 100% of the Location Fee as a Security Deposit in connection with Producer\u2019s use of the Property. Licensor shall not be required to place the Security Deposit into an interest bearing account. The Security Deposit will be deducted from the final bill which shall include but not be limited to Stage rental, overtime which may become due, property damage, clean-up charges, postponement or cancellation fees or any other amounts which may become due Licensor hereunder.',
  },
  {
    ref: '8',
    title: 'Time of Payment',
    body: 'Producer agrees to pay to Licensor the Total Due and Security Deposit prior to the commencement of the Term. All fees and costs for additional dressing, prep, shooting and strike days shall also be paid prior to the commencement of the Term.',
  },
  {
    ref: '9',
    title: 'Dark Days',
    body: 'The parties agree that \u201cDark Day\u201d shall be defined as any day on which set dressing and/or layout board is left on the Property by Producer with no production personnel present. In the event Producer\u2019s personnel/crew requires access to the Property at any time during a designated Dark Day, the Dark Day shall be deemed a Prep Day, Shoot Day or Strike Day, as Licensor shall determine, and shall be charged in accordance with the rates set forth above.',
  },
  {
    ref: '10',
    title: 'Postponement / Cancellation Policy',
    body: 'Renter acknowledges cancellation policy. All cancellations must be made with stage representative at SirReel one week prior to start date that is stated on contract. Cancellations made one week prior to start date will only pay the nonrefundable deposit. Cancellations made inside one week prior to start date that is stated on contract will be billed the full rental rate. In the event that SirReel rents stage for said dates then Cancellation fees may be waved but not the nonrefundable deposit.',
  },
  {
    ref: '11',
    title: 'Insurance Requirements',
    body: 'Renter must provide proof of liability insurance naming SirReel Studios as ADDITIONALLY INSURED FOR ONE MILLION DOLLARS AND LOSS PAYEE FOR $100,000.00 before Stage booking will be considered firm. Renter shall also secure and maintain Workmen\u2019s Compensation Insurance covering all personnel in Renter\u2019s employ or supplied by others. The insurance coverage shall commence when the rental term begins and shall remain in full force and effect until the rental term ends and Renter completely vacates the premises. SirReel Studios has no liability or responsibility for the damage or injury to any person or property, including without limitation filmed sequences and any and all costs incurred in the production of such sequences arising directly or indirectly from or attributable to the renting or use of any equipment or space owned and or operated by SirReel Studios. In addition to filmed sequences, equipment and property includes but is not limited to computers, cellular phones, video and audio recording and playback equipment, TV\u2019s and monitors kits, tools, wardrobe, props, set dressings and product. Renter agrees that all equipment and property brought to and or stored at SirReel Studios is the sole responsibility of the owner and or Renter who shall hold SirReel Studios harmless in the event of any damage to or loss thereof. Renter also agrees to indemnify and hold SirReel Studios harmless from any and all claims, demands, causes of action, suits, proceedings, costs, expenses, damages and liabilities including any or all attorney fees arising directly or indirectly out of, connected with, or resulting from the renting or use of any equipment or space owned and or operated by SirReel Studios.',
  },
  {
    ref: '12',
    title: 'Products Release',
    body:
      '(a) General Studio Products: SirReel Studios Services, Inc. (\u201cSirReel\u201d) have secured the right to use identified products and artwork contained on Standing Sets for use in the productions that shoot on SirReel stages. Description and inventory list of these items can be provided upon request. Producer has the right to utilize and record the Licensed Material in and in connection with Production shooting on Standing Sets located at SirReel Studios. This includes use in advertisements, promotions, publicity and other content relating to Production. Producer agrees not use or depict the Licensed Materials in a defamatory manner, or to feature the Licensed Material in a negative or false light. The Licensed Material shall not be modified or altered in any way without Manufacturer\u2019s prior written consent, however Producer may cover and/or disguise any unique or identifying labels or logos that might appear on the Licensed Material if deemed necessary. Other than the restrictions stated in this agreement, Producer shall have the right to use and to determine the manner in which the Licensed Material is used, in any and all media, whether now known or hereafter devised, throughout the universe in perpetuity, free and clear of any and all claims for royalties, residuals, or other compensation. Producer is not obligated to use the Licensed Material as part of the Production or otherwise, or to broadcast or otherwise exhibit or exploit the Production. The Producer agrees to indemnify and hold free and harmless to the fullest extent permitted by law SirReel, each of their respective parent, subsidiary, and affiliated organizations, and each of their respective agents, employees, successors, licensees and assigns, from and against any and all claims, damages, liabilities, costs and expenses, including but not limited to reasonable attorneys\u2019 fees, resulting from any breach of this agreement. This agreement and all matters arising from this agreement shall be governed by California law, without regard to the conflicts of law provisions thereof. This agreement contains the parties\u2019 entire understanding relative to its subject matter and can only be modified by a writing signed by both parties. Nothing in this agreement shall limit or restrict any rights otherwise enjoyed by Producer under law or contract.\n\n' +
      '(b) Stryker Equipment Products ("Stryker"): SirReel have in place a Master Media agreement with Stryker Corporation through its Medical Division and Producer acknowledges that in order to utilize and record Stryker products the Producer must sign the Addendum to Master Media Agreement.',
  },
  {
    ref: '13',
    title: 'Production Ownership',
    body: 'Licensor acknowledges and agrees, that Producer, after agreeing to Paragraph 12 (a) and (b) and executing this agreement, shall be the sole and exclusive owner of all rights, including, without limitation, all copyrights, in and to any and all photographs, film and video and sound recordings made or taken by Producer pursuant to this Agreement. Without in any way limiting the foregoing, Licensor acknowledges and agrees that Producer, its successor, assignees and Licensees, shall have the sole, exclusive, irrevocable and perpetual right to use the photographs, film and video and sound recording of the Property (including, without limitation, any and all furnishings and works of art located in or around the Property) taken by Producer in connection with the Production, and in connection with advertisements, promotions, publicity, trailers, clips, and other exploitation in connection with the Production to such extent as Producer may desire for use throughout the universe, and in all media (whether now known or hereafter devised) in perpetuity. Notwithstanding the foregoing, Producer represents that the use of said photographs, film and video and sound recordings will be used exclusively in connection with the Production, any trailer, clips and advertising or promotions of the Production or any other exploitation of the Production. The rights herein granted include the right to photograph, the right of Producer to refer to the Property by any fictitious name, and the right to attribute fictitious events as occurring on the Property. No right or interest referred to herein is intended to permit Producer to utilize any photographs or films obtained pursuant to this Agreement, for use in any other production. Licensor agrees in the event Producer breaches (or is alleged to have breached) any provision of this Agreement, Licensor shall not seek to enjoin or prohibit the broadcast, exhibition, distribution or other exploitation of the Production.',
  },
  {
    ref: '14',
    title: 'Miscellaneous',
    body:
      '(a) Assignment: Producer shall not assign or sub-contract any portion of this Agreement (other than the rights set forth in Paragraph 12. hereof) without Licensor\u2019s prior written consent, which consent will not be unreasonably withheld.\n\n' +
      '(b) Indemnification: Producer shall defend (with counsel acceptable to Licensor) indemnify and hold harmless Licensor, its parent, subsidiary and affiliated companies, each of their respective licensees, successors and assigns, and each of their respective agents, representatives and employees, from and against any and all claims, actions, damages, liabilities, losses, costs and expenses that in any way arise out of or result from Producer\u2019s use of the Property, its use and/or exploitation of the Production and/or its breach of any representation, warranty or other provision of this Agreement.\n\n' +
      '(c) Severability; Arbitration; Governing Law: If any provision of this Agreement is held by a court of competent jurisdiction to be invalid, void or unenforceable, the remaining provisions will continue in full force and effect without being impaired or invalidated in any manner. Any controversy or claim arising out of or relating to this Agreement will be settled by arbitration in accordance with the rules of the American Arbitration Association. Judgment on the award rendered by the arbitrators may be entered in any court having competent jurisdiction. This Agreement shall be governed by and construed in accordance with the substantive laws of the State of California. The parties agree that Los Angeles County shall be the exclusive venue with respect to any claims or disputes that may arise hereunder.\n\n' +
      '(d) Authority; Entire Agreement; Modifications: Each party hereto represents and warrants that such party is fully authorized to enter into this Agreement and the grant the rights herein granted. This Agreement (including any schedules or exhibits attached hereto) represents the entire agreement between the parties and shall supersede all prior understandings or representations, whether oral or written, and contains all of the representations, covenants and agreements between them. Any modification of this Agreement will be effective only if it is in writing and signed by both parties. This Agreement shall inure to the benefit of, and shall be binding upon the parties\u2019 respective parent, subsidiary and affiliated companies, shareholders, directors, officers, agents, attorneys, representatives, employees, successors, licensees and assigns.',
  },
]
