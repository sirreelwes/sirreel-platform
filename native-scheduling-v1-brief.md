# Native Scheduling — V1 Brief (Replace Planyo)

**Goal:** Make SirReel HQ the system of record for the schedule and retire Planyo. Agents check availability and place holds *in HQ*, on the Timeline, as the first step of a job.

**Non-goal (V1):** the assignment *optimizer* ("nicest first + fleet utilization" automatically). V1 does manual assignment with a nicest-first **sorted hint**. The auto-optimizer is V2 — see the bottom.

---

## What we build on (already in `main` — do not reinvent)

The category-hold-then-assign model already exists:

- **`BookingItem`** = category-level demand ("3× cargo van"). This is the **hold**. No asset bound.
- **`BookingAssignment`** = specific `Asset` × date range (`startDate`/`endDate`, `status`). This is the **unit assignment**.
- **`AssetCategory.totalUnits`** = capacity denominator (how many units we own to allocate).
- **`AssetCategory.planyoResourceId`** = the 1:1 link to a Planyo resource — used only for the one-time migration, then dead.

There is **no `Reservation` model** on `main` (that lives on the unmerged `timeline-booking-truth` branch and is a Planyo *mirror* — not needed for native). Build directly on `Booking / BookingItem / BookingAssignment`. Salvage only the Planyo-pull code from that branch for the migration chunk.

**Decided:** every rentable variant (incl. "cargo van w/ liftgate") is its own `AssetCategory`. So **no specs/features field, no feature filter** — availability is computed per `categoryId`.

---

## The only schema change

```prisma
enum AssetTier {
  PREMIUM
  STANDARD
  ECONOMY
}

// add to Asset:
tier AssetTier @default(STANDARD)
```

Fleet sets it. Used only to sort the assignment picker (nicest first). `prisma db push` (never `migrate dev`), then `npx tsc --noEmit`. Commit.

---

## Scheduling rules (locked — these *are* the system)

1. **Turnaround:** buffer day **preferred, same-day allowed in a pinch** → three availability states, not two:
   - **free** (no conflict)
   - **buffer-encroachment** (yellow, **overridable**) — re-renting before the preferred clean/inspect buffer
   - **booked** (red, **hard block**) — overlapping rental on the same unit, or category over capacity
2. **Holds are category-level.** Agent reserves a category + dates + qty. Unit assigned later.
3. **No auto-release.** Holds persist until manually released. Complement: a **stale-holds view** (REQUESTED holds older than N days) so agents sweep manually. No expiry job.
4. **Nicest-first is a sorted hint in V1**, not an algorithm. Assignment picker lists available units ordered by `tier` (PREMIUM→ECONOMY); agent chooses.

---

## The conflict engine — the must-be-correct core

This does not exist today (availability is 100% Planyo). Build it as a pure, testable function in `src/lib/scheduling/`.

```
getCategoryAvailability(categoryId, startDate, endDate, bufferDays = 1)
```

**Serviceable units** = `Asset` where `categoryId` matches, `isActive = true`, and `status NOT IN (MAINTENANCE, RETIRED, SOLD, STOLEN)`.
> Do **not** rely on `Asset.status = BOOKED` for availability — that enum value is dead, nothing sets it. Compute conflicts from `BookingAssignment` overlaps only.

**Per-unit state**, against active assignments (`BookingAssignment.status IN (ASSIGNED, CHECKED_OUT)` — exclude RETURNED/SWAPPED):
- **booked (hard)** if an assignment overlaps the window: `assignment.startDate <= endDate AND assignment.endDate >= startDate`
- **buffer (soft)** if no hard overlap, but the gap to an adjacent assignment (before *or* after the window) is `< bufferDays`
- **free** otherwise

**Category capacity** (can this category take one more hold for the window?):
```
availableToHold = serviceableUnits
                  − (units hard-booked in window)
                  − (sum of quantity on unassigned REQUESTED holds whose parent Booking dates overlap the window)
```
If `availableToHold <= 0` → over capacity → hard block.

**Return shape:**
```
{
  category, totalUnits, serviceableCount,
  freeCount, bufferCount, bookedCount,
  availableToHold,                       // capacity for a new hold
  units: [{ assetId, unitName, tier, state }]   // state ∈ free|buffer|booked
}
```

**CC notes:**
- A hold (`BookingItem`) has no dates of its own — it inherits the **rental window from its parent `Booking`**. Confirm which `Booking` fields define that window when you open the file (likely delivery/pickup or a start/end pair) and use those consistently in the capacity query.
- **Write unit tests for the overlap and buffer boundaries first** — the classic bug here is off-by-one on inclusive dates. Test: exact-adjacent (return day = next start), 1-day gap with bufferDays=1, full overlap, touching endpoints.
- This is the function that, wrong, double-books a stage. It gets tests before any UI trusts it.

---

## Chunks (incremental, commit per chunk, `tsc --noEmit` before each)

1. **Schema** — add `AssetTier` + `Asset.tier`. `prisma db push`, tsc, commit.
2. **Conflict engine + tests** — `getCategoryAvailability` in `src/lib/scheduling/`, with the boundary tests above. Pure logic, no UI. Land it.
3. **Shadow mode (safety)** — surface native availability **alongside** Planyo's answer on the existing availability/Timeline view, with a visible diff. Change nothing about how holds are made yet. **Purpose:** eyeball the native engine against Planyo across a couple of real weeks before trusting it. Don't proceed to Chunk 4 until they agree.
4. **Hold creation from Timeline** — `+Hold` flow: pick category + dates + qty → create `Booking` + `BookingItem(status=REQUESTED)`. This is the job-origination entry point. Re-check `availableToHold` server-side before writing (hard block / soft-warn-with-override).
5. **Assignment UI** — assign `Asset` → `BookingAssignment(status=ASSIGNED)`. Picker lists available units sorted by `tier` (nicest first). Re-run the conflict check at assign time: hard overlap blocks, buffer encroachment warns + allows override. Flip `BookingItem.status` REQUESTED→ASSIGNED.
6. **Stale-holds view** — list `BookingItem(status=REQUESTED)` whose parent `Booking` is older than N days (default 14), with one-click release. No cron.
7. **Migration** — one-time: pull Planyo forward book (`list_reservations`, `detail_level=3` — reuse branch code) → for each reservation create/find Company+Person from customer name, create `Booking`, map Planyo resource→`AssetCategory` via `planyoResourceId` for `BookingItem`, map unit name→`Asset` via `unitName` for `BookingAssignment`. **Log unmatched units/resources to a report rather than failing** — manual reconciliation list.
8. **Cutover — GATED.**

   Note: there is NO Planyo sync/cron to disable. The audit (commit cda085c) confirmed all Planyo reads in this codebase are live API calls, not a synced mirror. The earlier "turn off the cron" line was hypothetical.

   **Preconditions — ALL must be true before starting:**
   - Julian's residuals resolved (Sprinter #1/#2/#4 mapped to specific Cargo-w-Liftgate units or confirmed distinct; "30 (A) Wardrobe" → Cube 30 confirmed)
   - `scheduling-add-missing-assets.ts --write` run
   - `scheduling-planyo-migration.ts --write` run (idempotency confirmed first)
   - `/scheduling-shadow` shows native == Planyo across a couple of real weeks (convergence verified)

   **PR1 — the flip (preserves a 24–48h escape hatch):**
   - Flip the default in `src/lib/timeline/source.ts`:
     ```
     return params.get('source') === 'planyo' ? 'planyo' : 'native'
     ```
     (default native; `?source=planyo` still works as the manual fallback)
   - Delete the four ZERO-CONSUMER Planyo routes ONLY:
     - `src/app/api/planyo/route.ts`
     - `src/app/api/planyo/available-units/route.ts`
     - `src/app/api/planyo/reserve/route.ts`
     - `src/app/api/planyo/job-reservations/route.ts`
   - **KEEP** `src/app/api/timeline/route.ts` — it IS the `?source=planyo` escape hatch
   - **KEEP** dispatch's `planyo/unlinked` + `planyo/link-order` (orphan reconciliation)
   - **KEEP** `/api/scheduling/shadow-diff` + the shadow page (verification)

   **PR2 — cleanup (after 24–48h of native running clean):**
   - Delete `src/app/api/timeline/route.ts` (escape hatch retired)
   - Retire `/api/scheduling/shadow-diff` + the `/scheduling-shadow` page
   - Rework/retire dispatch's `planyo/unlinked` + `planyo/link-order` once orphans reconciled
   - Update the comment at `alerts/seed/route.ts:79` to reference `BookingAssignment`, not Planyo

---

## Open questions — pre-resolved (defaults; flag to change)

- **Tier representation:** enum PREMIUM/STANDARD/ECONOMY. (Numeric rank is the alternative for finer ordering.)
- **bufferDays:** 1. (Buffer is preferred-not-required, so this only drives the yellow warning, never a block.)
- **Stale-hold threshold:** 14 days.
- **Buffer encroachment direction:** symmetric — warn whether the tight gap is before or after the window.
- **Out-of-service statuses excluded from availability:** MAINTENANCE, RETIRED, SOLD, STOLEN. (AVAILABLE, IN_TRANSIT, WAREHOUSE, etc. remain bookable.)

## Conventions (standing)

`prisma db push` not `migrate dev` · `npx tsc --noEmit` before every commit · `@default(uuid())` · incremental commit per chunk · `export DATABASE_URL=$(grep DATABASE_URL .env.local | grep -v PRISMA | cut -d'"' -f2)` before Prisma commands · file writes via `python3` heredocs in zsh.

---

## V2 (explicitly out of scope now)

The **assignment optimizer** — auto-assigning units to maximize "nicest first" *and* fleet utilization. These two objectives compete (always sending the best units fragments the schedule and burns out the premium fleet). It's the one piece where "easy for Claude Code" is a trap: a packing heuristic that's subtly wrong quietly bleeds utilization. V1's manual-assign + nicest-first sort is enough to kill Planyo; the optimizer earns its own brief once real native booking data exists to tune against.
