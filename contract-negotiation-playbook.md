# Contract Negotiation Playbook

**SirReel Production Vehicles, Inc. — Equipment and Vehicle Rental Agreement**

---

## Purpose

This document captures SirReel's institutional negotiation positions on the Equipment and Vehicle Rental Agreement. It is read by the Contract Review AI on every contract review to guide both initial counter generation and fallback positions during client pushback.

Update this document when negotiation positions evolve. Commit changes to git so history reflects how SirReel's commercial posture develops.

## How the AI Uses This

When generating counter language, the AI consults this document for each clause:

- **Preferred:** SirReel's opening position. Use this language unless overridden by deal-specific context.
- **Acceptable Fallback:** What SirReel will accept under pushback. Suggest only after the client has rejected the Preferred language at least once, OR when operator explicitly signals second-round negotiation.
- **Hard Musts:** Provisions SirReel will not give up regardless of pushback. Flag any draft counter that lacks these for human review.
- **Do Not Accept:** Explicit list of concessions SirReel will not make. If the client's redline includes any of these, the AI must counter, not accept.
- **Rationale:** Background for AI to use when explaining a counter or engaging with non-standard pushback.

When generating an initial counter to a client's redline, default to Preferred language and reject anything in Do Not Accept. Suggest Fallback language only when the operator marks the clause as "second-round" or when context indicates pushback has already occurred.

## Non-Negotiable Hard Limits

These rules apply across all contract reviews regardless of clause-specific context. The AI must enforce them absolutely, with no fallback positions and no compromise language. Any redline or draft counter that violates these requires immediate flagging to the operator for review.

### 1. Indemnity Must Cover Both Third-Party AND First-Party Claims

**Third-party-only indemnity will never be accepted under any circumstances.**

SirReel's indemnity from Lessee must cover both third-party claims AND first-party claims (i.e., claims between SirReel and Lessee directly). Any client redline narrowing indemnity to third-party-only is rejected without further negotiation.

This rule applies regardless of:
- Negotiation round (first redline, second redline, or any subsequent round)
- Deal size or client relationship history
- Whether the client's attorney insists on it as "standard"
- Whether other concessions are offered in exchange

This rule supersedes any Acceptable Fallback or compromise language elsewhere in this document. Re-introducing a third-party-only limitation is never offered as a fallback even under heavy pushback. If the client refuses to accept broad indemnity, the operator must be alerted; this is a deal-breaker issue, not a negotiation point.

The AI must flag any draft counter that contains the phrase "third party claims" or any functional equivalent ("claims by third parties," "claims asserted by third parties," "third-party-only," etc.) limiting the indemnity scope.

## General Principles

1. **Structural protection > friction reduction.** Never trade core protections (indemnity scope, insurance coverage, termination rights) to reduce redline rounds. Concede on notice mechanics, technical language, and redundant boilerplate instead.

2. **Have a fallback ready, but don't lead with it.** First-time client pushback gets the fallback. Capitulation only after multiple rounds and operator approval.

3. **Concession-stacking is real.** Each individual concession may look reasonable, but cumulative concessions across many clauses erode SirReel's overall position. Track the count.

4. **Industry-standard language beats novel language.** Insurance carriers, courts, and production attorneys recognize standard formulations. Don't drift toward custom phrasing unless there's a specific reason.

5. **California law and LA County venue are non-negotiable in posture.** Alternate venues acceptable only by mutual written agreement, never by default.

6. **Insurance coverage amounts are commercially defensible. Don't lower them.** $1M CSL on auto, $1M/$2M on liability, statutory WC + $1M employer's liability are the floor.

7. **Notice-and-cure for default is acceptable. Auto-default with no notice is not the hill to die on.** Production clients near-universally require it.

---

## Clause 1 — Indemnity

### Preferred

> Lessee/Renter ("You") agree to defend, indemnify, and hold SirReel Production Vehicles, Inc. dba SirReel Studio Rentals, our agents, employees, assignees, suppliers, sub-lessors and sub-renters ("Us" or "We") harmless from and against any and all claims, actions, causes of action, demands, rights, verifiable damages of any kind, costs, expenses and compensation whatsoever including court costs and reasonable outside attorneys' fees ("Claims"), in any way arising from, or in connection with, the Vehicles and Equipment rented/leased (which vehicles and equipment, together, are referred to in this document as "Equipment"), including, without limitation, as a result of its use, maintenance, or possession, irrespective of the cause of the Claim, except to the extent caused by Our gross negligence or willful misconduct, or by a pre-existing latent or structural defect actually known by Lessor and not disclosed to You, from the time You take care, custody or control of the Equipment until the Equipment is returned to Our care, custody and control.

### Acceptable Fallback

If client pushes back on "in any way arising from, or in connection with," accept narrowing to **"arising out of"**. Do not narrow further.

### Hard Musts

- Covers BOTH third-party AND first-party claims (no "third party only" limitation)
- Gross negligence / willful misconduct carveout retained
- Pre-existing latent or structural defect carveout retained
- Reasonable outside attorneys' fees included
- "Verifiable" qualifier on damages retained

### Do Not Accept

- **Third-party-only limitation** — see Non-Negotiable Hard Limits §1. This is absolute and supersedes any fallback or compromise language.
- Mutual indemnity (compromises SirReel's position as Lessor)
- Removal of attorneys' fees recovery
- Caps on indemnification amount
- Carveout for client's ordinary negligence (only gross negligence + willful misconduct on SirReel's side)

### Rationale

For a rental company, broad indemnity covering both third-party and first-party claims is core protection, not boilerplate aggression. Without first-party coverage, SirReel loses indemnity for claims directly between SirReel and Lessee and must pursue separate contract claims to recover its own losses. The carveouts for gross negligence, willful misconduct, and pre-existing defects signal good faith without compromising scope. "Verifiable damages" excludes speculative claims and is a reasonable, defensible concession.

---

## Clause 6 — Workers Compensation & Employers Liability Insurance

### Preferred

> You shall, at your own expense, maintain worker's compensation insurance as required by applicable law, with employer's liability minimum limits of $1,000,000.

### Acceptable Fallback

- For small productions (under $50K total rental), employer's liability minimum of $500,000 acceptable.
- "Covering all employees performing services in connection with the rental" wording acceptable if client requests scope clarity.

### Hard Musts

- Workers compensation at statutory levels
- Employer's liability at minimum $500,000

### Do Not Accept

- Complete waiver of workers compensation requirement
- Missing employer's liability coverage
- Requirements to extend WC to volunteers, interns, or independent contractors (technically unsupportable; WC policies don't cover non-employees by structure)

### Rationale

The "coverage for volunteers, interns, or independent contractors" language historically present in this clause is technically problematic. WC policies don't extend to non-employees by their structure. Requiring it asks clients to misrepresent coverage and creates a legitimate technical objection any insurance broker will flag. Drop this requirement; rely on statutory-as-required.

---

## Clause 8 — Vehicle Insurance

### Preferred

Full counter language: $1M combined single limit liability, comprehensive + collision physical damage, additional insured + loss payee, primary/non-contributory coverage, hired/non-owned/rented vehicle coverage, pollution coverage, replacement cost for physical damage.

### Acceptable Fallback

- For older or lower-value vehicles, $750K CSL acceptable.
- Industry-standard ACORD pollution exclusion buyback acceptable as alternative to express pollution coverage requirement (if client's carrier insists on alternate formulation).

### Hard Musts

- SirReel named as additional insured AND loss payee
- $1M combined single limit (or $750K minimum)
- Primary coverage with respect to SirReel
- Comprehensive + collision physical damage coverage
- Hired/non-owned/rented vehicle coverage
- Replacement cost basis for physical damage

### Do Not Accept

- SirReel as additional insured only (without loss payee for physical damage)
- Excess or contributory coverage (must be primary)
- Removal of physical damage coverage
- Limits below $750K
- Removal of pollution coverage without a specific exclusion buyback or alternative endorsement

### Rationale

Pollution coverage is a real risk on production vehicles (fuel/fluid spills from generators, trucks, equipment). California mandates it for commercial trucks ≥10,001 lbs but not smaller vehicles. Keep the express requirement so coverage is universal across the fleet; accept industry-standard pollution exclusion buyback only as alternative formulation if client's carrier insists on different wording.

---

## Clause 9 — Insurance Generally

### Preferred

Lapse, reduction, or cancellation of required insurance = immediate automatic default. Lessee bears all deductibles and self-insured retentions uncapped. SirReel may procure replacement coverage at lessee's cost. Waiver of subrogation against SirReel.

### Acceptable Fallback

> Lapse, reduction in coverage or cancellation of the required insurance, if not cured within three (3) business days after written notice from us, shall be deemed to be a default of this agreement.

### Hard Musts

- Lessee bears all deductibles and self-insured retentions (no cap, regardless of dollar amount)
- Waiver of subrogation rights in favor of SirReel
- SirReel's right to procure backstop coverage at lessee's cost preserved
- Notification obligation if coverage lapses

### Do Not Accept

- Cap on deductible reimbursement (any dollar amount)
- Removal of subrogation waiver
- Removal of SirReel's right to procure backstop coverage
- Cure window longer than 3 business days for insurance lapse

### Rationale

The "auto-default with no notice" language reads as predatory but practically you'd notice and act in 3 days anyway. Adding the cure window removes a friction point without changing real exposure. Cap on deductible reimbursement is the line. The whole point of pass-through deductibles is no cap on SirReel's recovery. Capping reintroduces SirReel's exposure to the very risk the deductible clause is meant to shift.

---

## Clause 10 — Cancellation of Insurance

### Preferred

> You shall use commercially reasonable efforts to provide thirty (30) days' written notice prior to cancellation or material change to any insurance maintained by you pursuant to the foregoing provisions, except for cancellation due to non-payment of premium, for which ten (10) days' notice shall be sufficient.

### Acceptable Fallback

This is already the modern industry-standard formulation. Further fallback unnecessary.

### Hard Musts

- Notification obligation exists in some form
- Non-payment scenarios addressed (typically 10 days)

### Do Not Accept

- No notification requirement at all
- Removal of carrier-level notification language entirely

### Rationale

The hard 30-day requirement historically present in this clause is outdated. Modern ACORD certificates default to "endeavor to provide" because carriers refuse to sign on to fixed-notice provisions. Aligning to industry reality removes a friction point that creates real broker objections. This change is friction-only — actual notification expectations are unchanged in practice.

---

## Clause 13 — Compliance With Law and Regulations

### Preferred

Full compliance obligation + indemnification for governmental fines, penalties, taxes, and seizures + explicit "full replacement value in event of seizure or impound" language.

### Acceptable Fallback

- Acceptable to clarify that compliance obligation applies "to the extent applicable to Lessee's use of the Equipment."
- Acceptable to specify that DOT placards/permits/logs apply only to commercial fleet vehicles.

### Hard Musts

- Lessee compliance obligation
- Indemnification for governmental fines, penalties, taxes, seizures
- Express seizure/impound full replacement value language

### Do Not Accept

- Shifting compliance burden to SirReel
- Removal of indemnification for governmental fines
- Removal of seizure/impound full replacement value language
- "Reasonable efforts" qualifier on compliance obligation

### Rationale

The seizure/impound full replacement value language is technically redundant with general indemnity coverage, but explicit naming of high-impact loss types carries both legal and symbolic weight. Removing it on the theory of redundancy creates ambiguity at the margin. Belt and suspenders.

---

## Clause 21 — Default

### Preferred

Any failure to pay or material breach = immediate default with right to terminate. No notice-and-cure period required.

### Acceptable Fallback

> If you fail to pay any portion or installment of the total fees payable hereunder within five (5) business days after written notice from us, or you otherwise materially breach this Agreement and fail to cure such breach within ten (10) business days after written notice from us (or such longer period if cure is reasonably begun and diligently pursued), then such failure or breach shall constitute a Default.

### Hard Musts

- SirReel retains right to terminate after cure period
- Continued performance after notice does not waive right to declare default
- Cure periods no longer than 5 business days for monetary / 10 business days for non-monetary
- Default operative without further action upon expiration of cure period

### Do Not Accept

- Cure periods longer than 5 (monetary) / 10 (non-monetary) business days
- Removal of SirReel's termination rights
- Mandatory arbitration as a prerequisite to termination
- Removal of waiver-of-waiver language ("continuation of our performance shall not constitute a waiver")
- Requirement that SirReel demonstrate material harm before declaring default

### Rationale

Notice-and-cure is near-universally requested in production rental agreements. Holding the line gets SirReel flagged as aggressive in every redline pass and slows deal velocity. The 5/10 day windows are short enough to limit SirReel's exposure while giving the client meaningful opportunity to cure. The waiver-of-waiver clause is critical and must be retained — without it, SirReel's continued performance after notice could be argued to estop later assertion of default rights.

---

## Clauses 25 & 26 — Applicable Law / Arbitration

### Status

⚠️ Counter-PDF rendering bug in `src/lib/contracts/ContractDocument.tsx` prevents review of these clauses. Update this section once bug is resolved and counter content is visible. Likely the same `aiResponse.changes[i]` indexing issue affecting Accept decisions.

### Provisional Guidance

#### Applicable Law (Clause 25)

**Preferred:** California law governs, Los Angeles County exclusive venue.

**Acceptable Fallback:** California law retained, alternate venue allowed by mutual written agreement (for out-of-state clients only).

**Hard Must:** California law governs.

**Do Not Accept:** Choice of law other than California.

#### Arbitration (Clause 26)

**Pending review.** Document SirReel's actual current position once visible.

Common reasonable positions:
- If requiring arbitration: carveouts for injunctive relief and small-claims matters under $25K
- If refusing arbitration: offer mediation as prerequisite to litigation

**Do Not Accept:** arbitration in jurisdictions outside California.

---

## Other Clauses (Not Currently Contested)

This playbook focuses on clauses that have generated negotiation activity. Other clauses in the agreement follow standard SirReel language and should be retained as drafted. Any client redline that would substantively alter clauses not listed here requires operator review before counter-generation.

Specifically retain without softening:
- Clause 2 (Loss/Damage), Clause 3 (Protection of Others), Clause 4 (Working Order), Clause 5 (Property Insurance), Clause 7 (Liability Insurance), Clause 11 (Certificates), Clause 12 (Drivers), Clause 14 (Valuation/Liability Limit), Clause 15 (Subrogation), Clause 16 (Bailment), Clause 17 (Condition), Clause 18 (Identity), Clause 19 (Expenses), Clause 20 (Accident Reports), Clause 22 (Return), Clause 23 (Additional Equipment), Clause 24 (Entire Agreement), Clause 27 (Severability), Clause 28 (Facsimile), Clause 29 (Non-smoking)

---

## Revision Log

| Date | Change | Author |
|------|--------|--------|
| 2026-05-12 | Initial playbook created. Captures structural calls and friction softenings from review of RA_2026_PM_rdl-counter.pdf | Wes / Claude review session |
| 2026-05-12 | Added Non-Negotiable Hard Limits section. Third-party-only indemnity elevated to absolute rule; never offered as fallback regardless of pushback. | Wes / Claude |

---

## Integration Notes for Engineering

To wire this playbook into the Contract Review AI:

1. Place this file at repo root as `contract-negotiation-playbook.md`.
2. In the Contract Review AI prompt construction (likely in `src/lib/contracts/` or similar), read the file contents at the time of each review.
3. Inject the playbook into the system prompt under a heading like `# SirReel Negotiation Positions`.
4. Update the AI's response generation instructions to reference the playbook structure: use Preferred for initial counters, surface Fallback only on second-round or when operator marks pushback, never accept items in Do Not Accept, flag any draft counter missing Hard Musts for human review.
5. Add a UI affordance on the contract review page to mark "this is a second-round negotiation" so the AI knows when to consider Fallback language.

Future enhancement: migrate playbook contents to a `ClauseGuidance` Prisma model with admin UI for editing without git commits. Schema sketch:

```
model ClauseGuidance {
  id                   String   @id @default(uuid())
  clauseSlug           String   @unique
  contractTemplateId   String?
  preferredLanguage    String   @db.Text
  acceptableFallbacks  String[]
  hardMusts            String[]
  doNotAccept          String[]
  rationale            String?  @db.Text
  createdAt            DateTime @default(now())
  updatedAt            DateTime @updatedAt
}
```
