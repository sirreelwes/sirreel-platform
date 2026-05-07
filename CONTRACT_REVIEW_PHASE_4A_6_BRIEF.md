# Contract Review — Phase 4a.6 Build Brief
## Fix Counter-Language: Generate Actual Clause Text, Not Reasoning

**Status:** Spec ready. Ship soon — Counsel Media response is blocked on this.
**Owner:** Wes
**Estimated effort:** ~2-3 hours of focused Claude Code work
**Prerequisites:** Phase 4a.5 shipped (counter-PDF generation works via @react-pdf/renderer)
**Blocking nothing else:** This fixes a content quality bug. Phase 4b (email send) can begin in parallel or after.

---

## Why this brief exists

Phase 4a.5 successfully ships counter-PDF generation. But when Wes generated the first counter-PDF on May 7 2026, §1 (Indemnity) of the rendered PDF showed:

> "Reject the mutual indemnity subclauses entirely. Restore the baseline one-way indemnity language in clause 1, which places full responsibility on the Lessee except for claims resulting from SirReel's sole negligence or willful act."

That's **strategic reasoning**, not **contract clause text**. A counter-PDF should be readable as a finished contract — every clause is the actual binding language SirReel would accept.

Two root causes:

1. **AI prompt issue:** The AI generates `suggestedCounter` as strategic guidance ("how to push back") instead of replacement clause text ("what should the contract say"). When the user accepts the AI's suggestion without rewriting, reasoning ends up in the PDF.

2. **UX issue:** The counter-language textarea label doesn't make clear that the content needs to be actual contract language. Users don't realize they need to rewrite.

This brief fixes both.

## Goals

1. AI generates `suggestedCounter` as actual replacement contract clause text (in the same legal voice as the baseline), not strategic reasoning.
2. Strategic reasoning is preserved in a new field (`counterReasoning`) so the human can still see the AI's thinking.
3. Counter-language editor UI clearly tells the user this is contract clause text and shows the baseline for reference.
4. Existing reviews are unchanged — fix is forward-only. (Wes confirmed only 3 reviews exist; manual edit acceptable.)

## What stays unchanged

- ✅ ReviewChangeDecision Prisma model (no schema changes for the existing fields)
- ✅ POST /api/tools/contract-review/[id]/decisions endpoint
- ✅ Counter-PDF generation (works correctly — bug was in input data quality)
- ✅ ContractDocument.tsx rendering logic
- ✅ All existing UI structure (per-clause decision controls, two-tab layout)
- ✅ Decision flow (Accept / Counter / Reject + counter-language for Counter)

## What gets changed

### AI prompt (the main fix)

The prompt at `src/app/api/tools/contract-review/route.ts` currently generates `suggestedCounter` as strategic reasoning. The prompt needs to be revised to:

1. Provide the AI with the baseline clause text from `src/lib/contracts/contractClauses.ts`
2. Show the AI the client's redlined version
3. Tell the AI to write the actual replacement clause text in the same legal voice as the baseline
4. Move strategic reasoning into a separate `counterReasoning` field

New AI response shape (per change in `aiResponse.changes[]`):

```typescript
{
  clauseRef: "1",
  changeType: "not_acceptable",
  description: "Mutual indemnity: Added subsection 1a...",
  proposed: "...client's redlined text...",
  reasoning: "Why this is a problem...",
  suggestedCounter: "Lessee assumes all liability...",  // ← Now: actual clause text
  counterReasoning: "Reject the mutual indemnity..."     // ← NEW: strategic guidance
}
```

The AI should be explicitly instructed: "When writing suggestedCounter, write actual contract clause language. NOT 'Reject X' or 'Restore Y' — write the binding legal text that should appear in the final signed contract. Use the same legal voice as the baseline clause text. Do not include reasoning, strategy, or meta-commentary in suggestedCounter."

Example of GOOD vs BAD `suggestedCounter`:

❌ BAD: "Reject the mutual indemnity subclauses and restore the baseline one-way indemnity."
✅ GOOD: "Lessee assumes all liability for any loss, damage, or injury arising from use of the Equipment, except to the extent caused by SirReel's sole negligence or willful misconduct."

### Schema changes (none required)

The existing `ReviewChangeDecision.counterLanguage` field stores whatever the human enters. The new `counterReasoning` field lives inside `aiResponse.changes[i]` JSON, no schema migration needed (aiResponse is a JSON field).

### UI changes

Three changes to `src/components/reviews/ReviewResultPanel.tsx` per-clause Counter editor:

1. **Relabel textarea**
   - Old: "Counter language"
   - New: "Counter clause text" with helper "(this exact text will appear in §X of the counter-PDF)"

2. **Show baseline reference**
   - Add a collapsible panel above the textarea
   - Title: "Show baseline §X" (collapsible; closed by default)
   - When opened: shows the baseline clause text from `contractClauses.ts` so user can reference / copy from
   - Helps user write replacement language that matches the original voice

3. **"Reset to AI suggestion" button**
   - Inline button next to the textarea
   - When clicked: re-pulls `aiResponse.changes[i].suggestedCounter` and replaces the textarea content
   - Also shows AI's `counterReasoning` in a small "AI's thinking" panel below (read-only, for reference only — never used in the PDF)

## Implementation chunks

### Chunk A — Update AI prompt (~1 hour)

1. Read existing prompt in `src/app/api/tools/contract-review/route.ts`
2. Revise the system prompt (or user prompt section that defines `suggestedCounter`) to include:
   - Baseline clause text for context (passed in by retrieving from `contractClauses.ts`)
   - Explicit instruction to write actual replacement contract language, not strategic guidance
   - Example of GOOD vs BAD `suggestedCounter` (from this brief)
   - New field `counterReasoning` for the strategic guidance
3. Update the JSON schema in the prompt to reflect both fields
4. Update TypeScript types in route.ts to expect both fields
5. Test with the Counsel Media redlined PDF — generate a new review, verify `suggestedCounter` now contains actual clause language

Test plan:
- Upload Counsel Media redline as a NEW review
- Inspect the API response in Network tab
- For §1, §6, §16: verify `suggestedCounter` reads like a contract clause (not "Reject X" or "Restore Y")
- Verify `counterReasoning` contains the strategic guidance

### Chunk B — Update UI (~1 hour)

1. Modify `src/components/reviews/ReviewResultPanel.tsx`:
   - Relabel textarea to "Counter clause text" with helper text
   - Add collapsible "Show baseline §X" panel above the textarea
   - Need to pass baseline clause text to the component — either:
     - Pull from `contractClauses.ts` client-side (small bundle), or
     - Include baseline text in the AI response per-change
   - Recommendation: pull from `contractClauses.ts` — small file, no API change needed
2. Add "Reset to AI suggestion" button:
   - Reads `aiResponse.changes[i].suggestedCounter`
   - Sets textarea state
   - Below it, show "AI's reasoning:" panel with `counterReasoning` text (read-only, gray styling)

Visual layout per Counter clause accordion:

```
┌─ §1 [Counter] ────────────────────────────────────────────────┐
│ AI flagged: Mutual indemnity added (1a)...                    │
│                                                                │
│ ▶ Show baseline §1                       [Reset to AI suggest] │
│                                                                │
│ Counter clause text:                                          │
│ (this exact text will appear in §1 of the counter-PDF)       │
│ ┌──────────────────────────────────────────────────────────┐ │
│ │ Lessee assumes all liability for any loss, damage...     │ │
│ │                                                            │ │
│ └──────────────────────────────────────────────────────────┘ │
│                                                                │
│ AI's reasoning (not included in PDF):                         │
│ ┌──────────────────────────────────────────────────────────┐ │
│ │ Reject mutual indemnity. Restore the baseline...         │ │
│ └──────────────────────────────────────────────────────────┘ │
│                                                                │
│ Note (optional):                                              │
│ ┌──────────────────────────────────────────────────────────┐ │
│ │ Why this decision...                                      │ │
│ └──────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────┘
```

### Chunk C — Test end-to-end (~30 min)

1. Upload a fresh Counsel Media redline review
2. For each Counter decision:
   - Verify the AI's suggestedCounter loaded into the textarea reads like a contract clause
   - Open the "Show baseline §X" panel — verify the baseline text shows
   - Verify "AI's reasoning" panel shows the strategic guidance
3. Save decisions, generate counter-PDF
4. Open the generated PDF — verify §1, §6, §16 now contain actual contract language
5. Commit and push

---

## Open questions to resolve before starting

All resolved per Wes May 7 2026 conversation:

1. **AI strategy for generating contract language** → Option A: AI gets baseline + redline + writes replacement text in baseline voice
2. **Existing reviews migration** → Option B: leave as-is, manual edit acceptable (only 3 reviews exist)
3. **UI changes scope** → Yes to all three (relabel, baseline reference, reset button)

---

## Files this brief will create or modify

**Modified:**
- `src/app/api/tools/contract-review/route.ts` — update AI prompt to generate actual clause text + new `counterReasoning` field
- `src/components/reviews/ReviewResultPanel.tsx` — relabel textarea, add baseline panel, add Reset button, add reasoning panel
- TypeScript types for AI response (wherever they're defined) — add `counterReasoning` field

**Unchanged:**
- `prisma/schema.prisma` — no DB changes
- All counter-PDF generation code (works correctly, bug was in input data)
- All other API routes
- `src/lib/contracts/contractClauses.ts` — used as reference, not modified

---

## Done definition

Phase 4a.6 is complete when:

- [ ] AI prompt updated to generate actual clause text in `suggestedCounter`
- [ ] AI response now includes separate `counterReasoning` field with strategic guidance
- [ ] Counter-language textarea relabeled with clearer helper text
- [ ] Baseline §X reference panel exists and displays correct text
- [ ] "Reset to AI suggestion" button works
- [ ] AI's reasoning panel shows below textarea (read-only)
- [ ] Generating a counter-PDF on a fresh review produces actual contract language in clauses (not reasoning)
- [ ] Tested end-to-end with Counsel Media redline

---

## What this enables

After this ships:

1. Generated counter-PDFs read like actual contracts — clients can review them as final binding documents
2. Counsel Media can receive a usable counter-PDF this week
3. Future contract reviews require minimal manual editing of counter-language (AI's first draft is usable)
4. The platform produces output Wes is comfortable sending to lawyers

---

## What's NOT in this brief (explicitly deferred)

- ❌ Migrating existing 3 reviews to new format — manual edit acceptable
- ❌ Standing positions library that auto-fills counter-language across deals (Phase 5a)
- ❌ Multi-round negotiation tracking (Phase 5b)
- ❌ In-app email composition + send (Phase 4b)

---

## Risk assessment

**Low risk:**
- AI prompt changes are isolated to one route
- New `counterReasoning` field is additive in JSON, no schema change
- UI changes are within existing component, no architectural changes

**Medium risk:**
- AI may struggle to write actual contract language even with baseline + good prompt. May need 1-2 iterations of prompt refinement to get consistently usable output.

**Avoid:**
- Don't try to make the AI a perfect contract drafter. The output is a first draft for the human to review/edit. "Good enough that humans can lightly edit" is the bar, not "production-ready legal text."
- Don't expand scope to handle other AI quality issues. This brief is narrowly about counter-language being clause text vs reasoning.
