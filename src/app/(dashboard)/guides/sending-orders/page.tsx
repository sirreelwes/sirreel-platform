/**
 * /guides/sending-orders — the sales-side handoff into both lanes.
 *
 * Wes, 2026-09-04: "let's create a 'How to send orders to
 * Warehouse/Fleet' workflow instruction."
 *
 * The premise of the page is the asymmetry, because it is the thing reps
 * get wrong: GEAR reaches the floor off the ORDER, TRUCKS reach the yard
 * off the RESERVATION, and doing one does not do the other. A rep can
 * build and book a flawless order and have reserved no vehicle at all.
 *
 * Companion to /guides/pull-sheets, which picks up where this stops —
 * that one is the floor's loop (print, pull, photograph, check in/out).
 * Keep the seam at the handoff: this page must not re-explain the photo
 * flow, and that page must not re-explain holds.
 *
 * Facts this page asserts, and where they live — keep them in lockstep:
 *   - A warehouse line files a PickList THE MOMENT IT IS ADDED, at any
 *     order status → lib/orders/pickListSync.ts (syncPickListOnLineAdd).
 *     Booking find-or-creates the same list → lib/orders/bookOrder.ts.
 *   - Visibility is by DATE, not status: the board and /reports/orders
 *     both take "alive, not far along" (REPORTABLE_ORDER_STATUSES, minus
 *     archived and quoteStatus LOST) → lib/yard/board.ts BOARD_ORDER_STATES
 *     (widened to quotes 2026-09-04) + checkReports.reportListFor.
 *   - Which departments are gear → routeDepartment(); type=FEE is skipped
 *     by both bookOrder and the line-items route.
 *   - Sending a quote soft-holds unit-tracked VEHICLES/STAGES lines at
 *     holdRank 2, per CATEGORY, and reports what it could not hold →
 *     lib/orders/holdOnQuoteSend.ts. Promotion to rank 1 needs approval
 *     AND paperwork (COI + signed agreement + card on file, Wes
 *     2026-09-01) — NOT approval alone, which is the version of this
 *     that hard-blocked trucks for clients who had signed nothing.
 *   - A category hold draws NO unit row; the board draws assignments →
 *     actionItems/providers/holdUnassigned.ts states this in full.
 *   - Assigning is sales' own action (canCreateBooking), as is attaching
 *     the order to the unit → api/scheduling/booking-items/[id]/assign
 *     and api/scheduling/assignments/[id]/order.
 */
import Link from 'next/link'

export const metadata = { title: 'How to send orders to Warehouse & Fleet · SirReel HQ' }

/** Steps are a real sequence — the order IS the procedure. */
function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <li className="grid grid-cols-[2.25rem_1fr] gap-4 border-t border-lt-hairline py-4 first:border-t-0">
      <span className="flex h-7 items-center justify-center rounded-md bg-lt-inner text-[12px] font-bold tabular-nums text-lt-fg2">
        {n}
      </span>
      <div>
        <h3 className="mb-1 text-[15px] font-semibold text-lt-fg">{title}</h3>
        <div className="space-y-2 text-[14px] leading-relaxed text-lt-fg2">{children}</div>
      </div>
    </li>
  )
}

function Note({ tone, label, children }: { tone: 'warn' | 'stop' | 'plain'; label: string; children: React.ReactNode }) {
  const cls =
    tone === 'stop' ? 'border-chip-bad-fg/40 bg-chip-bad-bg text-chip-bad-fg'
      : tone === 'warn' ? 'border-chip-warn-fg/40 bg-chip-warn-bg text-chip-warn-fg'
        : 'border-lt-hairline bg-lt-inner text-lt-fg2'
  return (
    <div className={`mt-3 rounded-lg border-l-[3px] px-3.5 py-2.5 text-[13px] leading-relaxed ${cls}`}>
      <span className="mb-0.5 block text-[10px] font-bold uppercase tracking-[0.1em]">{label}</span>
      {children}
    </div>
  )
}

export default function SendingOrdersGuidePage() {
  return (
    <div className="bg-lt-page -m-3 min-h-[calc(100vh-3rem)] p-4 md:-m-4 md:p-6">
      <div className="mx-auto max-w-3xl">
        <header className="mb-8 border-b-2 border-lt-fg pb-5">
          <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-lt-fg3">Sales</span>
          <h1 className="mt-1.5 text-3xl font-semibold tracking-tight text-lt-fg">
            How to send orders to Warehouse &amp; Fleet
          </h1>
          <p className="mt-2 max-w-2xl text-[15px] text-lt-fg2">
            There is no <em>send</em> button, for either department. Gear reaches the warehouse floor
            off the <strong>order</strong>. Trucks reach the yard off the <strong>reservation</strong>.
            They are two different mechanisms, and doing one does not do the other.
          </p>
        </header>

        {/* The asymmetry, stated once and in the largest type on the
            page. Everything below is one lane or the other, and the
            expensive mistake is assuming the second one followed. */}
        <div className="mb-9 grid gap-2.5 sm:grid-cols-2">
          <div className="rounded-xl border border-lt-hairline bg-lt-card p-4">
            <div className="text-[10px] font-bold uppercase tracking-[0.1em] text-lt-fg3">Gear → Warehouse</div>
            <p className="mt-1.5 text-[14px] leading-relaxed text-lt-fg2">
              Put the line on the order under a warehouse department. The pull sheet exists from that
              moment — before the quote goes out, before it is booked.
            </p>
          </div>
          <div className="rounded-xl border border-lt-hairline bg-lt-card p-4">
            <div className="text-[10px] font-bold uppercase tracking-[0.1em] text-lt-fg3">Trucks → Fleet</div>
            <p className="mt-1.5 text-[14px] leading-relaxed text-lt-fg2">
              Sending the quote holds a <em>category</em>. Nothing appears in the yard until someone{' '}
              <strong>assigns an actual unit</strong> to the hold.
            </p>
          </div>
        </div>

        <div className="mb-9 rounded-xl border border-chip-warn-fg/40 bg-chip-warn-bg p-4">
          <div className="mb-1 text-[10px] font-bold uppercase tracking-[0.1em] text-chip-warn-fg">
            Before either lane — put dates on it
          </div>
          <p className="text-[14px] leading-relaxed text-chip-warn-fg">
            Both boards are read by <strong>day</strong>. A line with no dates holds no vehicle and
            lands on nobody&rsquo;s Tuesday — it is not late, it is nowhere. This is the single most
            common reason an order &ldquo;never reached&rdquo; a department.
          </p>
        </div>

        <section className="mb-10">
          <h2 className="mb-1 text-xl font-semibold text-lt-fg">1 · Gear → the warehouse floor</h2>
          <p className="mb-4 text-[14px] text-lt-fg3">
            Shorter than people expect. Adding the line <em>is</em> the send.
          </p>
          <ol className="list-none border-b border-lt-hairline p-0">
            <Step n={1} title="Add the line under a warehouse department">
              <p>
                <strong>Communications, Pro Supplies, Expendables, GE, Art</strong> and{' '}
                <strong>Wardrobe &amp; Makeup</strong> are warehouse work. That is the whole routing
                rule — you are not picking a lane anywhere, it follows from the department.
              </p>
              <p>
                <strong>Vehicles</strong> and <strong>Stages</strong> route elsewhere (section 2), and a{' '}
                <strong>fee</strong> line routes nowhere at all — a &ldquo;Delivery Fee&rdquo; must never
                turn up on the picking floor.
              </p>
              <Note tone="warn" label="The wrong department is invisible, not wrong-looking">
                A light filed under Vehicles quotes correctly, prints correctly on the client&rsquo;s
                quote, and simply never appears on the warehouse&rsquo;s sheet. Nothing warns you. If the
                floor says an item isn&rsquo;t on their list, check its department first.
              </Note>
            </Step>
            <Step n={2} title="That is it — the pull sheet already exists">
              <p>
                A warehouse line files the pull sheet <strong>the moment it is added</strong>, at any
                status. A quote you sent this morning already has one.
              </p>
              <p>
                There is no button that sends a list to the warehouse, and nothing to email. If you are
                about to email a list, you are doing their job twice.
              </p>
            </Step>
            <Step n={3} title="What actually puts it in front of them is the date">
              <p>
                Their <strong>Today</strong> board shows the day&rsquo;s work, and{' '}
                <strong>Check In/Out Reports</strong> reaches three days back and four days forward. Both
                take any live order — quotes included, marked <strong>Quote</strong> on the row so nobody
                has to guess.
              </p>
              <p>
                So the question is never &ldquo;is it booked&rdquo;. It is <em>does it have the right
                dates</em>.
              </p>
            </Step>
            <Step n={4} title="Book it when it is real">
              <p>
                <strong>Book it</strong> firms the numbers and stamps the lanes. It is not what makes the
                gear visible — that already happened — but it is what makes the order real, and every
                downstream number anchors to it.
              </p>
            </Step>
            <Step n={5} title="Adding something late? It is already on their sheet">
              <p>
                A warehouse line added later is appended on its own, even to a list the floor had already
                finished. It shows up as one new item to pull.
              </p>
              <Note tone="stop" label="Then phone them">
                HQ will show it. Nobody is watching a screen for a line that appeared while they were
                loading a truck. If the cart is built, the app is your record — not your notification.
              </Note>
            </Step>
          </ol>
        </section>

        <section className="mb-10">
          <h2 className="mb-1 text-xl font-semibold text-lt-fg">2 · Trucks → the yard</h2>
          <p className="mb-4 text-[14px] text-lt-fg3">
            This one has a real second step, and it is the step that gets skipped.
          </p>
          <ol className="list-none border-b border-lt-hairline p-0">
            <Step n={1} title="Send the quote — that holds the category">
              <p>
                Sending a quote soft-holds every unit-tracked vehicle on it. Wes:{' '}
                <em>
                  &ldquo;when we send a quote out, a hold is implied — because if they accept and
                  we&rsquo;ve rented that vehicle to someone else, we&rsquo;d be in a bad place.&rdquo;
                </em>
              </p>
              <p>
                The hold goes on as a <strong>backup</strong>, not a firm block: the unit reads as
                spoken-for on Reservations without freezing it, because a quote that never converts must
                not take a truck off the market.
              </p>
              <p>
                It promotes itself to a <strong>firm</strong> hold when the client approves{' '}
                <em>and</em> their paperwork is in — COI, signed agreement, card on file. Approval alone
                does not do it: that used to hard-block a truck for a client who had signed nothing and
                given us no card.
              </p>
            </Step>
            <Step n={2} title="Understand what you do NOT yet have">
              <p>
                A hold reserves <strong>&ldquo;a Cargo Van&rdquo;</strong>. It does not reserve Cargo 38.
                It counts in the capacity maths and it appears on no unit row anywhere, because the board
                draws <em>assignments</em>, not intentions.
              </p>
              <Note tone="stop" label="Until you assign a unit, the yard cannot see this job">
                Not &ldquo;sees it as unconfirmed&rdquo;. Cannot see it. No row on their Today board, no
                walk-around, nobody expecting to pull a truck that morning.
              </Note>
            </Step>
            <Step n={3} title="Assign the actual units">
              <p>
                <strong>Reservations</strong> → the hold → <strong>Assign units</strong>. Pick the unit.
                That creates the assignment, and the assignment is what puts a truck on the yard&rsquo;s
                board.
              </p>
              <p>
                If a unit is double-booked on the window it is refused outright; if it is inside its
                turnaround buffer you are asked to confirm rather than blocked.
              </p>
            </Step>
            <Step n={4} title="While you are in there — say which order it goes out on">
              <p>
                Only matters when the job has more than one order, and then it matters a lot. Naming the
                order puts an <strong>Order attached</strong> marker on the truck so the yard knows which
                one it is carrying. Hugo asked for it by name.
              </p>
              <p>With one order on the job it is stamped for you.</p>
            </Step>
            <Step n={5} title="Let the reminder close itself">
              <p>
                A sent quote whose units are not all assigned raises an action item on{' '}
                <strong>Jobs</strong>: <em>the quote is out, now put the units on it</em>. It appears the
                next time you load the board — deliberately not a blocker on sending — and it disappears
                when the last unit is assigned. Doing the work is what clears it.
              </p>
            </Step>
          </ol>
          <Note tone="warn" label="The vehicle line that holds nothing at all">
            A vehicle typed in free-hand, or a catalog row with no category behind it, reserves{' '}
            <strong>nothing</strong> — not a truck, not a category, not a number in the capacity count.
            The action item calls these out separately because they are the dangerous ones: an unassigned
            hold is at least visible, and this is not. If a vehicle line on your quote came from typing
            rather than picking, treat it as unreserved until you have gone and held it.
          </Note>
          <Note tone="plain" label="Stages work the same way; supplies do not">
            A stage line holds like a vehicle does. Supplies — ladders, folding tables, costume racks —
            are counted, not unit-tracked, so nothing is held for them and nothing should be. They are
            still gear: they go on the pull sheet in section 1.
          </Note>
        </section>

        <section className="mb-10">
          <h2 className="mb-1 text-xl font-semibold text-lt-fg">3 · Checking it landed</h2>
          <p className="mb-4 text-[14px] text-lt-fg3">
            Thirty seconds, and it is the difference between a truck being pulled on Tuesday and a phone
            call on Tuesday.
          </p>
          <div className="overflow-x-auto rounded-xl border border-lt-hairline bg-lt-card">
            <table className="w-full min-w-[34rem] text-left text-[13px]">
              <thead className="border-b border-lt-hairline text-[11px] uppercase tracking-wide text-lt-fg3">
                <tr>
                  <th className="px-4 py-2.5 font-semibold">Lane</th>
                  <th className="px-4 py-2.5 font-semibold">Where to look</th>
                  <th className="px-4 py-2.5 font-semibold">What good looks like</th>
                </tr>
              </thead>
              <tbody className="text-lt-fg2">
                {[
                  ['Gear', 'All Pick Lists, or the Today board on the start date', 'A row for the order with the item count you expect'],
                  ['Gear', 'Check In/Out Reports, Check out lane', 'The order appears within four days of going out'],
                  ['Trucks', 'Reservations — the job’s hold', 'Named units, not just a category with a quantity'],
                  ['Trucks', 'Today board on the start date', 'A row per unit, with the Order attached marker'],
                  ['Both', 'The Jobs landing page', 'No “put the units on it” action item left for this job'],
                ].map(([a, b, c]) => (
                  <tr key={String(a) + String(b)} className="border-b border-lt-hairline align-top last:border-b-0">
                    <td className="px-4 py-2.5 font-medium text-lt-fg">{a}</td>
                    <td className="px-4 py-2.5">{b}</td>
                    <td className="px-4 py-2.5">{c}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="mb-10">
          <h2 className="mb-1 text-xl font-semibold text-lt-fg">4 · When a department says they never got it</h2>
          <div className="overflow-x-auto rounded-xl border border-lt-hairline bg-lt-card">
            <table className="w-full min-w-[34rem] text-left text-[13px]">
              <thead className="border-b border-lt-hairline text-[11px] uppercase tracking-wide text-lt-fg3">
                <tr>
                  <th className="px-4 py-2.5 font-semibold">Symptom</th>
                  <th className="px-4 py-2.5 font-semibold">Usually</th>
                  <th className="px-4 py-2.5 font-semibold">Fix</th>
                </tr>
              </thead>
              <tbody className="text-lt-fg2">
                {[
                  ['An item is missing from the pull sheet', 'It is filed under Vehicles or Stages, or it is a fee line.', 'Change the line’s department. The lane follows it.'],
                  ['Nothing at all on the warehouse board', 'The order has no dates, or its dates are outside the window.', 'Put the real dates on the lines.'],
                  ['The yard has no truck for a booked job', 'The hold was never assigned to a unit.', 'Reservations → Assign units. Booking the order does not do this.'],
                  ['The capacity count looks right but no unit shows', 'That is exactly what a category hold looks like.', 'Assign units. A hold is not a truck.'],
                  ['A quoted vehicle reserves nothing', 'The line was typed free-hand with no catalog row behind it.', 'Re-pick it from the catalog, then hold and assign it.'],
                  ['Two orders on one job, wrong truck loaded', 'No order was attached to the assignment.', 'Assign units → name the order. The yard reads that marker.'],
                ].map(([a, b, c]) => (
                  <tr key={String(a)} className="border-b border-lt-hairline align-top last:border-b-0">
                    <td className="px-4 py-2.5 font-medium text-lt-fg">{a}</td>
                    <td className="px-4 py-2.5">{b}</td>
                    <td className="px-4 py-2.5">{c}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Note tone="plain" label="Who may do what">
            Holding and assigning units is a <strong>sales</strong> action, and so is attaching an order
            to a unit — the yard reads those, it does not set them. Filing a check-out or check-in is
            theirs and not yours.
          </Note>
        </section>

        <footer className="mt-10 border-t border-lt-hairline pt-4 text-[13px] text-lt-fg3">
          This page stops where the paper starts. What the floor does with the sheet, and how a
          photographed sheet updates your order, is{' '}
          <Link href="/guides/pull-sheets" className="font-semibold underline underline-offset-2">
            how pull sheets work
          </Link>
          . For the quote and paperwork that got you here, see{' '}
          <Link href="/guides/starting-a-job" className="font-semibold underline underline-offset-2">
            starting a job
          </Link>
          . Internal — this page is not on sirreel.com.
        </footer>
      </div>
    </div>
  )
}
