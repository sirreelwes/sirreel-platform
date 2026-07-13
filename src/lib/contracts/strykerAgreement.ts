/**
 * Stryker Master Media Use Agreement — single source of truth.
 *
 * The paragraph text below is the canonical agreement VERBATIM (from
 * stryker-mma / stryker-addendum-templatized.md) — do not paraphrase or
 * rewrite the legal language. `{{FIELDS}}` are populated per job:
 *
 *   {{PRODUCER_NAME}}    — client/production company on the job
 *   {{PRODUCER_ADDRESS}} — client address (blank if none on record)
 *   {{PROJECT_TITLE}}    — job's production/show title
 *   {{AGREEMENT_DATE}}   — date signed
 *   {{RETURN_DATE}}      — Licensed Material return date (job strike/end)
 *
 * Shown (and separately signed) whenever the Hospital Set is selected:
 * rendered inline in the v2 portal studio card, snapshotted at signing
 * by /api/portal/v2/[token]/stage-sign, and reproduced in the signed
 * stage-contract PDF. Lives alongside stageContractClauses.ts so every
 * consumer renders the same text.
 */

export const STRYKER_MMA_TITLE = 'Stryker Master Media Use Agreement'

export const STRYKER_MMA_PARAGRAPHS: string[] = [
  `This MASTER MEDIA USE AGREEMENT ("Agreement") is made on {{AGREEMENT_DATE}}, between Stryker Corporation, through its Medical Division, with an address of 3800 E. Centre Avenue, Portage, MI 49002 ("Stryker"), and {{PRODUCER_NAME}}, with an address of {{PRODUCER_ADDRESS}} ("Producer").`,
  `Stryker hereby grants to Producer the right to use the products set forth on Exhibit A, attached hereto, including any photos, name(s), signage, art, design, labels, logos, images, likenesses and/or any other material contained therein (collectively, the "Licensed Material") for the sole purpose of incorporating the Licensed Material, and any portions or images contained therein, in whole or in part in dialogue, as props, and/or set decoration in the Project currently titled "{{PROJECT_TITLE}}" (the "Project").`,
  `Producer shall only use the Licensed Material for the purposes described herein and in accordance with the instructions for use provided with the Licensed Material. The Licensed Materials shall not be modified or altered in any way without Stryker's prior written consent, which shall not be unreasonably withheld. In addition, Producer shall not use or depict the Licensed Materials in a defamatory manner.`,
  `Stryker warrants that the Licensed Material shall be free from defects in materials and workmanship at the time of delivery to Producer. Producer acknowledges that the Licensed Material is without any other warranty of any kind, express or implied, including any implied warranty of merchantability or fitness for a particular purpose. Producer shall indemnify and hold Stryker harmless for any and all claims, suits, actions, damages, liabilities, costs, expenses or losses, including reasonable outside counsel fees, arising from (i) injury due to the negligence of any person other than Stryker's employee or agent, (ii) the failure of any person other than Stryker's employee or agent to follow any instructions for use of the Licensed Material, or (iii) the use of any product, including the Licensed Material, not obtained directly from Stryker or product that has been modified, altered or repaired by any person other than a Stryker employee or agent. Stryker is not responsible for any losses or injuries arising from the selection, manufacture, installation, operation, condition, possession, or use of the Licensed Materials by Producer, unless due to a defect in materials and/or workmanship of the Licensed Materials, or the gross negligence or willful misconduct of Stryker's employees or agents while engaged in the performance of Stryker's obligations hereunder. Producer shall in no event be entitled to, and Stryker shall not be liable for, punitive damages, loss of profit, loss of use, Project delays or lost revenue.`,
  `When the Producer is done using the Licensed Material, and in any event, no later than {{RETURN_DATE}}, Producer shall make available to Stryker the Licensed Material for pick up. If Producer does not immediately return the Licensed Material to Stryker at such time, Stryker may take possession of the Licensed Material, with demand or notice, without any court order or other process of law, in a lawful and peaceable manner and at Producer's expense.`,
  `Producer acknowledges that it will not acquire or assert any rights in the copyright or trademarks of Stryker by virtue of its use of the Licensed Material pursuant to this Agreement, and that any other use of the Licensed Material by Producer requires separate authorization from Stryker.`,
  `This agreement and all matters or issues collateral thereto shall be governed by the internal, substantive law of California, without regard to the conflicts of law provisions thereof. Producer may not assign or transfer the rights granted hereunder to any other entity without Stryker's written consent. This Agreement (including any attachments and exhibits incorporated herein) constitutes the sole and complete agreement between the parties with respect to the Licensed Material and all matters set forth herein, and any other correspondence or agreements (whether written or oral) between the parties relating to the subject matter hereof shall be of no force and effect and are deemed null and void.`,
  `As between Stryker and Producer, all rights of every kind in and to any materials created by Producer in connection with its use of the Licensed Material or resulting therefrom, including, but not limited to, sound or photographic recordings (the "Recordings") shall be and remain the sole and exclusive property Producer and its successors and assigns. Such rights shall include, without limitation, the perpetual and irrevocable right to use and re-use said Recordings in connection with any audio-visual Projects as Producer may elect, including the Project, and in connection with advertising, publicizing, exhibiting, merchandising, distributing and exploiting such audio-visual Projects in any manner whatsoever and at any time by all means, media, devices, processes and technology now or hereafter known or devised in perpetuity throughout the universe. In the event of any claim by Stryker against Producer, whether or not material, Stryker shall be limited to Stryker's remedy at law for damages, if any, and Stryker shall not be entitled to enjoin, restrain or interfere with Producer's Project, distribution, merchandising, advertising, publicizing, exhibiting or exploitation of the Recordings or any of Producer's rights hereunder.`,
  `No representative of Stryker nor anyone acting on Stryker's behalf gave, is planning to give or agreed to give anything of value to any employee of Producer, any member of the Project staff or crew, or anyone in any way associated with the Project, in exchange for the use or appearance of the Licensed Material in the Project. Stryker also further agrees and understands that if Stryker grants the permission that Producer is seeking, Producer shall be under no obligation whatsoever to actually use the Licensed Material or to have it appear on screen in the Project, and that Producer has the right to obfuscate and/or disguise any unique or identifying labels or logos that may appear on the Licensed Material if deemed necessary by Producer's Project or legal personnel. If and as applicable, this Agreement and the value of the loan made hereunder may be subject to reporting to government agencies by Stryker or Producer under federal or state laws.`,
]

/** Exhibit A — exactly as written in the source agreement. */
export const STRYKER_EXHIBIT_A: { description: string; productNo: string; quantity: string; value: string }[] = [
  { description: 'Secure 3 (S3) Bed', productNo: '3305S3', quantity: '2', value: '$11,000' },
  { description: 'Comfort Gel SE Support Surface', productNo: '1805', quantity: '2', value: '$1,223' },
  { description: 'ComfortGel Support Surface', productNo: '2850', quantity: '2', value: '$1,000' },
  { description: 'Power-PRO XT', productNo: '6506', quantity: '2', value: '$15,000' },
  { description: 'Prime Big Wheel Stretcher', productNo: '1115', quantity: '2', value: '$11,070' },
  { description: 'True-Fit Over The Bed Table', productNo: '3500-000-750', quantity: '2', value: '$528' },
  { description: 'Symmetry Plus Patient Room Recline', productNo: '3150-000-100', quantity: '1', value: '$2,718' },
  { description: 'Prime Transport Chair', productNo: '1460', quantity: '4', value: '$4,125' },
]

export interface StrykerMergeFields {
  producerName: string
  producerAddress: string
  projectTitle: string
  agreementDate: string
  returnDate: string
}

function fill(text: string, f: StrykerMergeFields): string {
  return text
    .replace(/\{\{PRODUCER_NAME\}\}/g, f.producerName)
    .replace(/\{\{PRODUCER_ADDRESS\}\}/g, f.producerAddress)
    .replace(/\{\{PROJECT_TITLE\}\}/g, f.projectTitle)
    .replace(/\{\{AGREEMENT_DATE\}\}/g, f.agreementDate)
    .replace(/\{\{RETURN_DATE\}\}/g, f.returnDate)
}

/** Populated paragraphs, in order, ready to render. */
export function renderStrykerParagraphs(fields: StrykerMergeFields): string[] {
  return STRYKER_MMA_PARAGRAPHS.map((p) => fill(p, fields))
}

/**
 * Full populated agreement as plain text — the snapshot persisted at
 * signing so the record shows exactly what the client agreed to.
 */
export function renderStrykerPlainText(fields: StrykerMergeFields): string {
  const exhibit = STRYKER_EXHIBIT_A.map(
    (r) => `${r.description} | Product No. ${r.productNo} | Qty ${r.quantity} | ${r.value}`,
  ).join('\n')
  return [
    STRYKER_MMA_TITLE.toUpperCase(),
    `Production / Show Title: ${fields.projectTitle}`,
    ...renderStrykerParagraphs(fields),
    'EXHIBIT A',
    exhibit,
  ].join('\n\n')
}
