# Canonical Baseline Contract — Corrections and Updates

**Purpose:** Comprehensive set of text changes to apply to SirReel's canonical Equipment and Vehicle Rental Agreement. This document supersedes the earlier `canonical-text-updates.md` (which only covered Cl. 6 and 10).

**How to use:** Open your canonical source document (Word .docx). For each clause section below, locate the current text in your source doc and replace with the corrected text. After all changes applied, export as PDF and replace `public/contracts/sirreel-rental-agreement.pdf` in your repo.

**Recommended commit message:** `feat(contracts): canonical baseline corrections (typos, tightenings, LCDW rewrite)`

---

## Change Summary

| Priority | Category | Clauses |
|----------|----------|---------|
| **CRITICAL** | Typo affecting dollar amounts | Cl. 7 ($2,000,0000 → $2,000,000) |
| **CRITICAL** | Major rewrite (phantom references) | LCDW addendum |
| HIGH | UCC compliance | Cl. 4 (warranty disclaimer) |
| MEDIUM | Business model alignment | Cl. 6, 22, 23 |
| MEDIUM | Substantive tightenings | Cl. 10, 11, 14, 15, 16, 18, 19, 25, 26, 28, 29 |
| LOW | Typos/grammar | Cl. 5, 17, 20, 21, 26 |

---

## CRITICAL FIXES (do these first)

### Clause 7 — Liability Insurance (TYPO — dollar amount)

**Current text contains:**
> "...general liability aggregate limits of not less than $2,000,0000..."

**Replace with:**
> "...general liability aggregate limits of not less than $2,000,000..."

**Why:** Extra zero in $2M figure makes it read as $20M. Fix immediately before any further client agreements signed.

---

### Limited Collision Damage Waiver Addendum (MAJOR REWRITE)

**Current addendum contains phantom references to "Paragraph 4" and "Paragraph 5" that don't exist in this agreement, plus an internal contradiction on truck/motorhome eligibility.**

**Replace entire LCDW section with:**

> **LIMITED COLLISION DAMAGE WAIVER**
>
> **Availability and Consideration.** For the additional consideration of $24 per vehicle per day, accepted in writing by Lessee on a per-vehicle basis, SirReel agrees to waive its right to recover from Lessee the first $1,000 of damage to a covered fleet vehicle resulting from a collision with another vehicle or stationary property, subject to the terms and exclusions set forth below. Lessee remains responsible for all costs in excess of $1,000.
>
> **Eligible Vehicles.** The Limited Collision Damage Waiver ("LCDW") is available only for the following fleet vehicles: Cubes, Vans, Stakebeds, and Location Trailers. The LCDW is **not available** for any vehicle requiring a commercial driver's license (CDL) to operate, Motorhomes, Trucks (CDL-class), Combos, PopVans, VTR/PeopleMover Vans, Golf Carts, or any other specialty vehicle.
>
> **Scope of Waiver.** With the LCDW in effect, SirReel waives the first $1,000 of repair costs or replacement value for damage to the covered vehicle caused by collision with another vehicle or stationary property.
>
> **Exclusions.** The LCDW does not apply to, and Lessee remains fully responsible for, damage or loss resulting from any of the following:
>
> - Intentional acts by Lessee, an Authorized Driver, or any other person
> - Operation by any person who is not Lessee or an Authorized Driver
> - Operation by any person with an unlicensed, suspended, revoked, or otherwise invalid driver's license
> - Operation by any person under the influence of alcohol, drugs, or controlled substances
> - Damage caused by improper loading, overloading, or exceeding the vehicle's specified weight, height, length, or width limits
> - Damage caused by collision with overhead obstructions due to insufficient clearance
> - Damage caused by towing or pushing any object without SirReel's prior written permission
> - Damage caused by abusive handling or off-road use
> - Theft of the vehicle or any components or accessories
> - Vandalism, fire, weather damage, or any cause other than collision
> - Loss of use of the vehicle (LCDW applies only to direct physical damage to the vehicle)
>
> **Effect on Other Obligations.** The LCDW applies only to direct collision damage to the covered vehicle. Lessee's obligations under all other provisions of this Agreement remain in full force and effect, including without limitation: all insurance requirements (Sections 5–11), indemnification obligations (Section 1), responsibility for valuation of loss (Section 14), and responsibility for loss of use of the vehicle.
>
> **Acceptance/Decline.** Lessee's acceptance or decline of the LCDW must be confirmed in writing on a per-fleet-vehicle basis. No oral acceptance is effective.

**ALSO update the Rental Policies / Fleet Agreement summary section** to match the eligible-vehicle list above. The current Rental Policies section lists "Trucks & Motorhomes" as eligible — that needs to come out for consistency with the addendum exclusions.

**DECISION REQUIRED:** I've drafted the LCDW eligibility list to exclude CDL-class vehicles, Motorhomes, and all specialty vehicles, on the theory that these are higher-risk and the $24/day rate may not be commercially viable for them. If you want LCDW available for Trucks and Motorhomes (broader business reach but higher claim exposure), update the eligibility list accordingly. Either way, the eligible/ineligible lists must match between the policies section and the addendum.

---

## HIGH PRIORITY — UCC Compliance

### Clause 4 — Equipment in Working Order (ADD warranty disclaimer)

**Current text:**
> "We have tested the Equipment in accordance with reasonable industry standards and found it to be in working order immediately prior to the inception of this Agreement, and to the extent you have disclosed to us all of the intended uses of the Equipment, it is fit for its intended purpose. Other than what is set forth herein, you acknowledge that the Equipment is rented/leased without warranty, or guarantee, except as required by law or otherwise agreed upon by the parties at the inception of this Agreement."

**Replace with:**
> "We have tested the Equipment in accordance with reasonable industry standards and found it to be in working order immediately prior to the inception of this Agreement, and to the extent you have disclosed to us all of the intended uses of the Equipment, it is fit for its intended purpose. **EXCEPT AS EXPRESSLY SET FORTH HEREIN, THE EQUIPMENT IS RENTED "AS IS" AND "WITH ALL FAULTS," AND SIRREEL MAKES NO WARRANTIES OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING WITHOUT LIMITATION ANY IMPLIED WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, OR NON-INFRINGEMENT, EXCEPT TO THE EXTENT REQUIRED BY LAW.**"

**Why:** Current language likely fails UCC §2A-214 because it neither mentions "merchantability" by name nor is conspicuous (caps, bold, or different font). Without those, implied warranty disclaimers can be held unenforceable. The all-caps revision satisfies both requirements.

---

## MEDIUM PRIORITY — Business Model and Substantive Tightenings

### Clause 6 — Workers Compensation & Employers Liability Insurance

**Current text:**
> "You shall, at your own expense, maintain worker's compensation/employer's liability insurance during the course of the Equipment rental with minimum limits of $1,000,000. Including coverage for the use of any volunteers, interns, or independent contractors working on your behalf and under your supervision."

**Replace with:**
> "You shall, at your own expense, maintain worker's compensation insurance as required by applicable law, with employer's liability minimum limits of $1,000,000."

**Why:** WC policies don't extend to non-employees. Asking Lessee to cover volunteers/interns/ICs is technically unsupportable and creates a legitimate broker objection.

---

### Clause 10 — Cancellation of Insurance

**Current text:**
> "You and your insurance company shall provide us with not less than 30 days written notice prior to the effective date of any cancellation or material change to any insurance maintained by you pursuant to the foregoing provisions."

**Replace with:**
> "You shall use commercially reasonable efforts to provide thirty (30) days' written notice prior to the effective date of any cancellation or material change to any insurance maintained by you pursuant to the foregoing provisions, except for cancellation due to non-payment of premium, for which ten (10) days' notice shall be sufficient."

**Why:** Modern carriers refuse to commit to fixed-notice provisions; ACORD certificates default to "endeavor to provide." Aligning to industry reality.

---

### Clause 11 — Certificates of Insurance

**Current text:**
> "Before obtaining possession of the Equipment you shall provide to us Certificates of Insurance confirming the coverages specified above. All certificates shall be signed by an authorized agent or representative of the insurance carrier."

**Replace with:**
> "Before obtaining possession of the Equipment, you shall provide to us Certificates of Insurance confirming the coverages specified in Sections 5 through 10, in form and substance reasonably satisfactory to us. All certificates shall be issued and signed by an authorized agent or representative of the issuing insurance broker or carrier. If any insurance coverage required hereunder changes, lapses, or is cancelled during the Rental Period, you shall promptly provide updated Certificates of Insurance to us."

**Why:** Original didn't require COI approval (just provision), didn't address mid-rental coverage changes, and incorrectly attributed COI signing to "the insurance carrier" when in practice brokers issue them.

---

### Clause 14 — Valuation of Loss / Our Liability is Limited

**Current text contains the damages exclusion in caps:**
> "WE WILL, IN NO EVENT, BE LIABLE FOR ANY CONSEQUENTIAL, SPECIAL OR INCIDENTAL DAMAGES."

**Replace with:**
> "WE WILL, IN NO EVENT, BE LIABLE FOR ANY INDIRECT, CONSEQUENTIAL, SPECIAL, INCIDENTAL, OR PUNITIVE DAMAGES, INCLUDING WITHOUT LIMITATION LOST PROFITS, EVEN IF SIRREEL HAS BEEN ADVISED OF THE POSSIBILITY OF SUCH DAMAGES."

**Why:** Adding "indirect" and "punitive" closes gaps some courts have used to award damages not covered by "consequential/special/incidental." The "advised of the possibility" language strengthens enforceability.

---

### Clause 15 — Subrogation

**Current text:**
> "You hereby agree that we shall be allowed to subrogated for any recovery rights you may have for damage to the Equipment."

**Replace with:**
> "You hereby agree that we shall be subrogated to any recovery rights you may have against any third party for loss of, damage to, or destruction of the Equipment. You shall execute all documents reasonably necessary to give effect to this subrogation right and shall cooperate fully with us and our insurers in pursuing any subrogation claim."

**Why:** Fixes broken grammar ("shall be allowed to subrogated"). Expands subrogation rights to include cooperation obligation, which is standard in commercial leases.

---

### Clause 16 — Bailment

**Current text:**
> "This agreement constitutes an Agreement or bailment of the Equipment and is not a sale or the creation of a security interest. You will not have, or at any time acquire, any right, title, or interest in the Equipment, except the right to possession and use as provided for in this Agreement. We will at all times be the sole owner of the Equipment."

**Replace with:**
> "This Agreement constitutes a true lease and bailment of the Equipment and is not a sale or the creation of a security interest. You will not have, or at any time acquire, any right, title, or interest in the Equipment, except the right to possession and use as provided for in this Agreement. We will at all times be the sole owner of the Equipment. The parties intend this Agreement to be a 'true lease' within the meaning of applicable law, including for U.S. federal and state tax purposes and under UCC Article 2A."

**Why:** Fixes awkward "Agreement or bailment" wording. Explicit "true lease" language clarifies tax treatment and UCC Article 2A applicability, which matters in client bankruptcy scenarios.

---

### Clause 18 — Identity

**Current text:**
> "We will have the right to place and maintain on the exterior or interior of each piece of property covered by this Agreement the following inscription: Property of SirReel You will not remove, obscure, or deface the inscription or permit any other person to do so."

**Replace with:**
> "We will have the right to place and maintain on the exterior or interior of each piece of Equipment covered by this Agreement an inscription reading 'Property of SirReel Production Vehicles, Inc.' You will not remove, obscure, or deface the inscription or permit any other person to do so, except as expressly permitted under the Trademark and Brand Use provisions of this Agreement."

**Why:** Uses full entity name. Adds carveout for production-context obscuring (filming a scene where the inscription would be inappropriate), which connects to the new Trademark and Brand Use clause being drafted.

---

### Clause 19 — Expenses

**Current text:**
> "You will be responsible for all expenses, including but not limited to fuel, lubricants, and all other charges in connection with the operation of the Equipment."

**Replace with:**
> "You will be responsible for all expenses incurred during the Rental Period in connection with the operation, storage, or use of the Equipment, including but not limited to: fuel, lubricants, diesel exhaust fluid (DEF), tolls, parking fees and fines, traffic citations, permits, and all other operating expenses. SirReel may pass through any such expenses incurred by SirReel on your behalf, plus a reasonable administrative fee in accordance with the Administrative Fee policy."

**Why:** Original was too generic. Specific enumeration prevents disputes. DEF is a real cost on modern diesel vehicles. Pass-through with admin fee creates a clear collection mechanism.

---

### Clause 22 — Return

**Current text:**
> "Upon the expiration date of this Agreement with respect to any or all Equipment, you will return the property to us, together with all accessories, free from all damage and in the same condition and appearance as when received by you."

**Replace with:**
> "Upon the expiration date of this Agreement with respect to any or all Equipment, you will return the Equipment to us, together with all accessories, free from damage and in the same condition and appearance as when received by you, reasonable wear and tear excepted."

**Why:** Production rentals naturally see wear. The "free from all damage" standard is impractical and a near-universal client redline target. Adding "reasonable wear and tear excepted" is industry standard and proactively defuses the objection.

---

### Clause 23 — Additional Equipment

**Current text:**
> "Additional Equipment may from time to time be added as the subject matter of this Agreement as agreed on by the parties. Any additional property will be added in an amendment describing the property, the monthly rental, security deposit, and stipulated loss value of the additional Equipment. All amendments must be in writing and signed by both parties. Other than by this amendment procedure, this Agreement may not be amended, modified, or altered in any manner except in writing signed by both parties."

**Replace with:**
> "Additional Equipment may from time to time be added as the subject matter of this Agreement as agreed by the parties. Any additional Equipment will be added in an amendment describing the Equipment, the applicable rental rate (daily, weekly, or monthly), and the stipulated loss value of the additional Equipment. All amendments must be in writing and signed by both parties. Other than by this amendment procedure, this Agreement may not be amended, modified, or altered in any manner except in writing signed by both parties."

**Why:** Original referenced "monthly rental" and "security deposit," neither of which matches SirReel's daily-rental, insurance-backed business model. Updated to reference all rate types and remove security deposit (which insurance covers in practice).

---

### Clause 25 — Applicable Law

**Current text:**
> "This Agreement will be deemed to be executed and delivered in Los Angeles, California and governed by the laws of the State of California"

**Replace with:**
> "This Agreement will be deemed to be executed and delivered in Los Angeles, California, and governed by the laws of the State of California without regard to its conflict of laws principles. Subject to the arbitration provisions in Section 26, the parties consent to the exclusive jurisdiction and venue of the state and federal courts located in Los Angeles County, California."

**Why:** Adds conflict-of-laws disclaimer (prevents arguments that another state's law applies under conflict rules), adds exclusive venue selection (reduces out-of-state client forum-shopping risk), and adds the missing period.

---

### Clause 26 — Arbitration

**Current text:**
> "Any controversy or claim arising out of or related to this Agreement or breach of this Agreement will be settled by arbitration, in Los Angeles, California, under the auspices of the Judicial Arbitration and Mediation Service ('JAMS'). The arbitration will be conducted by a single arbitrator under JAMS Streamlined Arbitration Rules. The decision and award of the arbitrator will be final and binding and any award may be entered in any court having jurisdiction. The prevailing party in any such arbitration shall be entitled to an award of reasonable attorneys fees and costs in addition to any other relief granted"

**Replace with:**
> "Any controversy or claim arising out of or related to this Agreement or the breach of this Agreement will be settled by binding arbitration in Los Angeles, California, under the auspices of the Judicial Arbitration and Mediation Service ('JAMS') and conducted by a single arbitrator under JAMS Streamlined Arbitration Rules. The decision and award of the arbitrator will be final and binding, and any award may be entered in any court having jurisdiction. The prevailing party in any such arbitration shall be entitled to an award of reasonable attorneys' fees and costs in addition to any other relief granted. Notwithstanding the foregoing, either party may seek injunctive or other equitable relief in a court of competent jurisdiction to enforce its intellectual property rights, recover the Equipment, or prevent imminent and irreparable harm, without first submitting the matter to arbitration. Claims within the jurisdictional limit of small claims court may, at either party's election, be brought in small claims court rather than arbitration."

**Why:** Adds injunctive relief carveout (you need to be able to recover equipment, enforce IP rights without waiting for arbitration), adds small-claims carveout (gives both parties an efficient option for low-value disputes), adds missing period, fixes "attorneys" → "attorneys'."

---

### Clause 28 — Facsimile Signature (STALE)

**Current text:**
> "This Agreement may be executed by facsimile signature and such signature shall be deemed a valid and binding original signature."

**Replace with:**
> "This Agreement may be executed in counterparts and by facsimile, electronic, scanned, or digital signature (including via DocuSign or similar e-signature platforms), each of which shall be deemed a valid and binding original signature. Electronic signatures shall be governed by the U.S. Electronic Signatures in Global and National Commerce Act (E-SIGN), the California Uniform Electronic Transactions Act, and other applicable law."

**Why:** Original is pre-2026 language. Modern execution methods (DocuSign, scanned PDFs, digital signatures) need explicit authorization. E-SIGN and state UETA references confirm legal enforceability.

---

### Clause 29 — Non-smoking Policy

**Current text:**
> "All vehicles are non-smoking vehicles and lessee is responsible for all damages caused from smoking in or near the vehicles. A $250 per day fee may be charged lessee in addition to the cost to repair any damaged items if the smoking policy is not observed."

**Replace with:**
> "All Equipment is non-smoking. Lessee shall not permit smoking, vaping, or use of any tobacco, cannabis, or controlled substance in or within twenty (20) feet of any Equipment. Lessee shall be responsible for all damages caused by violation of this policy, including without limitation deep cleaning, deodorization, fabric or interior component replacement, and lost rental income during the cleaning period. SirReel may charge a fee of $250 per day for each day the violation continues, plus the actual cost of cleaning, deodorization, repair, or replacement."

**Why:** Original didn't cover vaping/cannabis, "near" was undefined, damage scope was vague. Tightened on all three.

---

## LOW PRIORITY — Typo and Grammar Fixes

### Clause 5 — Property Insurance (TYPO)

**Current text contains:**
> "...you or your or agents pick the Equipment up..."

**Replace with:**
> "...you or your agents pick the Equipment up..."

---

### Clause 17 — Condition of Equipment (no change required)

Baseline reads "in good mechanical condition and running order" — this is cleaner than the counter version. No change needed.

---

### Clause 20 — Accident Reports (TYPOS)

**Two corrections:**
- "if any of the Equipment is damaged, **lost stolen**, or destroyed" → "if any of the Equipment is damaged, **lost, stolen,** or destroyed"
- "including those required by law and those **required applicable insurers**" → "including those required by law and those **required by applicable insurers**"

---

### Clause 21 — Default (GRAMMAR)

**Current text contains:**
> "If you fail to pay any portion or installment of the total fees payable hereunder you otherwise materially breach this Agreement..."

**Replace with:**
> "If you fail to pay any portion or installment of the total fees payable hereunder, or you otherwise materially breach this Agreement..."

**Why:** Missing "or" — current sentence is grammatically broken.

---

## Clauses NOT being changed in this update

The following clauses are left as-is in the canonical baseline:

- **Clause 1 (Indemnity)** — strong as written; aggressive baseline gives you negotiation runway. **Strategic decision still open:** whether the playbook's Cl. 1 Preferred should match this aggressive baseline rather than the modest-concessions version we drafted earlier. Pending your call.
- **Clause 2 (Loss of or Damage to Equipment)** — clean; "sole negligence" carveout is broader than gross negligence (better for you)
- **Clause 3 (Protection of Others)** — clean
- **Clause 8 (Vehicle Insurance)** — keep aggressive in baseline per playbook strategy
- **Clause 9 (Insurance Generally)** — keep auto-default in baseline per playbook strategy; 3-day cure is a negotiation Fallback, not baseline
- **Clause 12 (Drivers)** — leave for attorney to harmonize with new Driver Qualifications clause
- **Clause 13 (Compliance With Law and Regulations)** — keep aggressive in baseline per playbook strategy
- **Clause 24 (Entire Agreement)** — clean
- **Clause 27 (Severability)** — clean
- **Fleet Agreement fuel surcharge** ($10/gallon) — clean

---

## Items requiring attorney decision (not changes — flags)

These I'm not auto-correcting because they involve substantive legal judgment your attorney should validate:

1. **Clause 4 warranty disclaimer** — I've suggested the all-caps merchantability/fitness language, but attorney should confirm enforceability under CA-specific case law
2. **Clause 20 vs. new Accident and Incident Reporting clause** — overlap; attorney decides whether to consolidate, replace 20, or keep both with cross-references
3. **LCDW eligibility scope** — my draft excludes CDL-class vehicles and Motorhomes; you may want broader scope. Attorney should confirm LCDW is enforceable as drafted under CA Civil Code §1936 (which governs short-term rental damage waivers)
4. **Cl. 16 "true lease" language** — attorney should confirm intended tax and bankruptcy-law characterization aligns with operational reality
5. **Cl. 26 arbitration carveouts** — confirm injunctive-relief carveout is enforceable alongside mandatory arbitration under recent CA case law

---

## Strategic decisions still pending

1. **Should playbook Cl. 1 Preferred match this baseline (more aggressive) instead of the version we drafted earlier?** Pending your call.
2. **LCDW eligible-vehicle list** — narrower (no CDL/Motorhomes) per my draft, or broader (include Trucks and Motorhomes per current Rental Policies)? Either way, eligibility list must be consistent between Rental Policies and LCDW addendum.

---

## Workflow checklist after applying corrections

1. ☐ Open canonical source document (.docx)
2. ☐ Apply all CRITICAL fixes first (Cl. 7 typo, LCDW rewrite)
3. ☐ Apply HIGH and MEDIUM priority changes
4. ☐ Apply LOW priority typo fixes
5. ☐ Resolve LCDW eligibility scope (narrow vs. broad)
6. ☐ Update Rental Policies "Rentals" section if LCDW scope changed
7. ☐ Export as PDF
8. ☐ Replace `public/contracts/sirreel-rental-agreement.pdf` in repo
9. ☐ Commit: `feat(contracts): canonical baseline corrections (typos, tightenings, LCDW rewrite)`
10. ☐ Send updated baseline + this corrections document to attorney as part of review package

---

This document supersedes `canonical-text-updates.md` (which covered only Cl. 6 and 10).
