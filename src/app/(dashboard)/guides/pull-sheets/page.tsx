/**
 * /guides/pull-sheets — the paper loop, end to end.
 *
 * Wes, 2026-09-04: "an instruction workflow, really plainly written
 * about how sales can generate a picklist to warehouse and how warehouse
 * can print and pick, and how that pick will update the checkout order
 * and how the return checkin sheet will update the return. Ideally all
 * through photos."
 *
 * Two audiences on one page on purpose. The handoff IS the subject —
 * sales half the loop, the floor the other half — and splitting it into
 * two guides would let each side keep believing the other one does
 * something it doesn't. Same shape and same components as
 * /guides/starting-a-job; see that file's header for why these are plain
 * pages and not a docs model.
 *
 * Facts this page asserts, and where they live — keep them in lockstep:
 *   - There is no "send to warehouse" button. Booking creates the pick
 *     list, find-or-create, with every WAREHOUSE-lane line →
 *     lib/orders/bookOrder.ts.
 *   - A line added after booking is appended even to a terminated list
 *     → lib/orders/pickListSync.ts (case c).
 *   - Which departments reach the floor → routeDepartment() in
 *     bookOrder.ts; fees/discounts/labor are dropped by the PDF route.
 *   - The photo is a SUGGESTION and writes nothing →
 *     api/orders/[id]/check-report/photo (12MB, JPEG/PNG/WebP, and the
 *     wrong-order refusal).
 *   - Check-OUT writes counts onto the order + flags the agent + re-sends
 *     a quote; check-IN never changes the order → lib/orders/checkReports.ts
 *     (submitCheckReport's header states the why).
 *   - Filing settles the gear lane: OUT → LOADED, IN → CHECKED_IN and
 *     Job.returnedAt → settleGearAfterReport.
 *   - Filing is yard-gated; anyone signed in can print the sheet →
 *     api/orders/[id]/check-report vs pick-list-pdf.
 */
import Link from 'next/link'

export const metadata = { title: 'How pull sheets work · SirReel HQ' }

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

/** Who is holding the work at each stage. The handoffs are the part
 *  people get wrong, so they are stated before any of the steps. */
function Hand({ who, does }: { who: string; does: string }) {
  return (
    <div className="rounded-lg border border-lt-hairline bg-lt-card p-3">
      <div className="text-[10px] font-bold uppercase tracking-[0.1em] text-lt-fg3">{who}</div>
      <div className="mt-1 text-[13px] leading-relaxed text-lt-fg2">{does}</div>
    </div>
  )
}

export default function PullSheetsGuidePage() {
  return (
    <div className="bg-lt-page -m-3 min-h-[calc(100vh-3rem)] p-4 md:-m-4 md:p-6">
      <div className="mx-auto max-w-3xl">
        <header className="mb-8 border-b-2 border-lt-fg pb-5">
          <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-lt-fg3">
            Sales &amp; Warehouse
          </span>
          <h1 className="mt-1.5 text-3xl font-semibold tracking-tight text-lt-fg">
            How pull sheets work
          </h1>
          <p className="mt-2 max-w-2xl text-[15px] text-lt-fg2">
            Sales books the order. The pull sheet appears. The floor prints it, pulls on paper, and
            marks it up. A supervisor <strong>photographs the sheet</strong> and HQ reads the
            handwriting — that is the check-out, and it updates the order. When the gear comes back,
            the same photo again, in reverse.
          </p>
          <p className="mt-2 max-w-2xl text-[14px] text-lt-fg3">
            Nobody types forty lines. Nobody emails a list. The paper is still the paper.
          </p>
        </header>

        <div className="mb-9 grid gap-2.5 sm:grid-cols-3">
          <Hand
            who="Sales"
            does="Puts the gear on the order and hits Book it. That is the entire handoff — there is no separate send-to-warehouse step."
          />
          <Hand
            who="The floor"
            does="Prints the sheet, pulls the cart, marks the paper up, writes their name on it. Changes nothing in HQ."
          />
          <Hand
            who="The supervisor"
            does="Photographs the marked-up sheet into HQ, checks what it read, files it. Albert, Carlos, Hugo, Pedro."
          />
        </div>

        <section className="mb-10">
          <h2 className="mb-1 text-xl font-semibold text-lt-fg">1 · Sales: getting the sheet to the warehouse</h2>
          <p className="mb-4 text-[14px] text-lt-fg3">
            Short version: build the order, book it. The pull sheet is a consequence of booking, not a
            thing you send.
          </p>
          <ol className="list-none border-b border-lt-hairline p-0">
            <Step n={1} title="Put the gear on the order as line items">
              <p>
                Anything from <strong>Communications, Pro Supplies, Expendables, GE, Art</strong> or{' '}
                <strong>Wardrobe &amp; Makeup</strong> is warehouse work and lands on the pull sheet.
              </p>
              <p>
                <strong>Vehicles</strong> go to the fleet lane and <strong>Stages</strong> to the stage
                lane — they are handled elsewhere and are not pulled off a shelf. Fees, discounts and
                labor never print.
              </p>
              <Note tone="plain" label="The department picks the lane">
                You are not choosing a lane anywhere. It follows from the line&rsquo;s department, so
                putting a light on the order under the wrong department is how gear goes missing from
                the floor&rsquo;s sheet.
              </Note>
            </Step>
            <Step n={2} title="Book it">
              <p>
                Order page → <strong>Book it</strong>. That is the handoff. Booking builds the pull sheet
                out of every warehouse line on the order, and from that moment it is visible to the floor
                on <strong>All Pick Lists</strong> and on their <strong>Today</strong> board.
              </p>
              <p>
                There is <strong>no button that sends a pick list to the warehouse</strong>, and nothing
                to email. If you find yourself about to email a list, the order isn&rsquo;t booked.
              </p>
            </Step>
            <Step n={3} title="Added something later? It is already on their sheet">
              <p>
                A warehouse line added <em>after</em> booking is appended to the pull sheet on its own —
                even to a list the floor had finished. It shows up as one new item to pull.
              </p>
              <Note tone="warn" label="Tell them anyway">
                HQ will show it. Nobody on the floor is watching a screen for a line that appeared while
                they were loading a truck. If the cart is already built, call the warehouse — the app is
                the record, not the notification.
              </Note>
            </Step>
          </ol>
        </section>

        <section className="mb-10">
          <h2 className="mb-1 text-xl font-semibold text-lt-fg">2 · Warehouse: print it and pull it</h2>
          <p className="mb-4 text-[14px] text-lt-fg3">
            Paper, exactly as before. HQ&rsquo;s job here is to print an accurate sheet and to take it
            back afterwards.
          </p>
          <ol className="list-none border-b border-lt-hairline p-0">
            <Step n={1} title="Print the pull sheet">
              <p>
                From <strong>All Pick Lists</strong>, from the <strong>Today</strong> board, or from the
                order page under <strong>Warehouse → Print pull sheet ↗</strong>. All three print the same
                sheet.
              </p>
              <p>
                It renders fresh every time, so a sheet printed this morning shows this morning&rsquo;s
                order. Reprint rather than photocopy.
              </p>
            </Step>
            <Step n={2} title="Pull the cart and mark the paper up">
              <p>Write on it the way you always have:</p>
              <ul className="ml-4 list-disc space-y-1">
                <li>a different count — cross out and write what actually went;</li>
                <li>a swap — write what you sent instead;</li>
                <li>something that was never on the sheet — add it at the bottom.</li>
              </ul>
            </Step>
            <Step n={3} title="Put your name at the top">
              <p>
                Whoever prepped and loaded it. It carries into HQ as{' '}
                <strong>Prepped &amp; loaded by</strong> and is the only record of who built the cart.
              </p>
            </Step>
          </ol>
          <Note tone="stop" label="Do not fix the order yourself">
            The floor changes nothing in HQ. Write it on the sheet and hand the sheet over — the
            supervisor&rsquo;s entry is what changes the order, and it is the only route through which the
            yard is allowed to.
          </Note>
        </section>

        <section className="mb-10">
          <h2 className="mb-1 text-xl font-semibold text-lt-fg">3 · Check-out: photograph the sheet</h2>
          <p className="mb-4 text-[14px] text-lt-fg3">
            The truck is loaded and the marked-up sheet is in your hand. This is the part that updates
            the order.
          </p>
          <ol className="list-none border-b border-lt-hairline p-0">
            <Step n={1} title="Open the order under Check out — going out">
              <p>
                <strong>Check In/Out Reports</strong> in the sidebar. The day&rsquo;s orders are in two
                lanes; this one is the top lane. The <strong>Today</strong> board&rsquo;s gear row opens
                the same screen.
              </p>
              <p>
                Every line arrives pre-filled with what the order says, because on most days everything
                went as written.
              </p>
            </Step>
            <Step n={2} title="Photograph the sheet">
              <p>
                Hit <strong>Photograph the sheet</strong>. On a phone that opens the camera. On a desktop
                you can also <strong>drag the photo straight onto the box</strong>.
              </p>
              <p>
                Lay the sheet flat, get the whole page in frame, and keep your shadow off it. JPEG, PNG or
                WebP, under 12 MB — if the phone is set to maximum resolution it will refuse and tell you
                to retake it smaller.
              </p>
            </Step>
            <Step n={3} title="HQ reads the handwriting and fills the counts">
              <p>
                Lines that differ open themselves, and so do lines the reader wasn&rsquo;t confident about.
                A small <strong>Photo</strong> or <strong>Check</strong> chip marks where a number came
                from — <strong>Check</strong> means look at that one twice.
              </p>
              <p>
                Anything written at the bottom that isn&rsquo;t on the order lands under{' '}
                <strong>Not on the order</strong>, and a name written at the top fills{' '}
                <strong>Prepped &amp; loaded by</strong>.
              </p>
              <Note tone="plain" label="The photo decides nothing">
                Reading the photo writes nothing anywhere — it only fills the form in front of you. The
                photo is stored with the report either way, so the paper is recoverable even when the read
                was useless.
              </Note>
            </Step>
            <Step n={4} title="Check it against the paper, then file">
              <p>
                Read the opened lines against the sheet in your hand. Fix anything the reader got wrong —
                you can type over any count, and <strong>Swap / note</strong> opens the swap and note
                fields on any line.
              </p>
              <p>
                If nothing differs, <strong>File the report</strong> is one tap. If something differs, the
                button reads <strong>Review N changes and file</strong> and reads them back to you line by
                line — in the same words the agent and the client will see — before it does anything.
              </p>
            </Step>
            <Step n={5} title="What filing actually does">
              <ul className="ml-4 list-disc space-y-1">
                <li>the counts you filed are written onto the order and the totals are recalculated;</li>
                <li>the sales agent is flagged to review what changed;</li>
                <li>
                  if the order is still a <strong>quote</strong> — which it usually is when the truck
                  leaves — the corrected quote is emailed to the client automatically, copying the office;
                </li>
                <li>the gear lane moves to <strong>Loaded</strong>.</li>
              </ul>
              <Note tone="warn" label="Extras are flagged, never priced">
                Something that goes out that was never on the order is recorded and sent to the agent to
                price. It is <em>not</em> added to the order here — the yard can&rsquo;t see rates, and a
                line added at $0 would quietly under-bill the job.
              </Note>
            </Step>
          </ol>
        </section>

        <section className="mb-10">
          <h2 className="mb-1 text-xl font-semibold text-lt-fg">4 · Check-in: the same photo, backwards</h2>
          <p className="mb-4 text-[14px] text-lt-fg3">
            The gear is back and counted onto a return sheet. Same screen, bottom lane.
          </p>
          <ol className="list-none border-b border-lt-hairline p-0">
            <Step n={1} title="Open the order under Check in — coming back">
              <p>
                <strong>Check In/Out Reports</strong> again. Every line is pre-filled with what was
                rented, and you are counting against that.
              </p>
            </Step>
            <Step n={2} title="Photograph the return sheet">
              <p>
                Identical to the check-out: photograph or drag it in, the counts fill themselves, short
                lines open for you to confirm. Write what is missing in the note on the line —{' '}
                <em>&ldquo;3 batteries not in the case&rdquo;</em> is the whole value of this to whoever
                bills the job a week later.
              </p>
            </Step>
            <Step n={3} title="File it">
              <p>
                Filing the check-in stamps the gear <strong>Checked in</strong>, and when everything on
                the job is back it marks the <strong>job returned</strong>. That is what clears a job off
                the board — a job whose gear is physically back but never checked in reads{' '}
                <em>Not returned</em> forever.
              </p>
            </Step>
          </ol>
          <Note tone="stop" label="A check-in never changes what was rented">
            Short counts here are recorded and flagged to the agent — the order is not reduced. Cutting a
            booked line because a case didn&rsquo;t come back would credit the client for losing our
            equipment. What a shortfall costs is the agent&rsquo;s call, not the sheet&rsquo;s.
          </Note>
        </section>

        <section className="mb-10">
          <h2 className="mb-1 text-xl font-semibold text-lt-fg">5 · When something goes sideways</h2>
          <div className="overflow-x-auto rounded-xl border border-lt-hairline bg-lt-card">
            <table className="w-full min-w-[34rem] text-left text-[13px]">
              <thead className="border-b border-lt-hairline text-[11px] uppercase tracking-wide text-lt-fg3">
                <tr>
                  <th className="px-4 py-2.5 font-semibold">What you see</th>
                  <th className="px-4 py-2.5 font-semibold">What it means</th>
                  <th className="px-4 py-2.5 font-semibold">What to do</th>
                </tr>
              </thead>
              <tbody className="text-lt-fg2">
                {[
                  ['That photo looks like order S…, not this one', 'You photographed a different sheet off the stack.', 'Nothing was filled in. Photograph the right sheet.'],
                  ['The photo was saved but could not be read', 'Glare, a fold, or handwriting the reader could not resolve.', 'Type the counts in. The photo stays attached to the report.'],
                  ['That photo is over 12 MB', 'The phone is on its highest resolution.', 'Retake it smaller. It does not need to be a big file to be readable.'],
                  ['Nothing was written that changed a line', 'The reader found no marks against any line.', 'Normal on a clean pull. Check the counts and file.'],
                  ['Already filed … Submitting again replaces it', 'A report for this edge already exists.', 'Filing again overwrites it. That is how a correction is made.'],
                  ['The order has no line items', 'Nothing on the order is pullable.', 'Sales side — the gear is not on the order yet.'],
                ].map(([a, b, c]) => (
                  <tr key={a} className="border-b border-lt-hairline align-top last:border-b-0">
                    <td className="px-4 py-2.5 font-medium text-lt-fg">{a}</td>
                    <td className="px-4 py-2.5">{b}</td>
                    <td className="px-4 py-2.5">{c}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <Note tone="plain" label="Who can do what">
            Printing a sheet takes any HQ login. <strong>Filing</strong> a check-out or check-in is yard
            work — admin, manager, fleet tech and warehouse. Sales cannot file one, and does not need to:
            they get the flag and the corrected quote.
          </Note>
          <Note tone="warn" label="RentalWorks orders are not part of this">
            An order that lives only in RentalWorks has no line items in HQ, so it cannot produce a pull
            sheet or a check report. And a check-out that changes an HQ order does <strong>not</strong>{' '}
            write back to RW — if a job is being billed out of RW, someone has to carry the change across
            by hand.
          </Note>
        </section>

        <footer className="mt-10 border-t border-lt-hairline pt-4 text-[13px] text-lt-fg3">
          The paper is still the record of what happened on the floor; this is how it gets into HQ without
          anyone retyping it. Companion to{' '}
          <Link href="/guides/starting-a-job" className="font-semibold underline underline-offset-2">
            starting a job
          </Link>{' '}
          and{' '}
          <Link href="/guides/finishing-a-job" className="font-semibold underline underline-offset-2">
            finishing a job
          </Link>
          . Internal — this page is not on sirreel.com.
        </footer>
      </div>
    </div>
  )
}
