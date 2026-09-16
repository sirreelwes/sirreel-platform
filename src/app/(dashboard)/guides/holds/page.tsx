/**
 * /guides/holds — the three ways to hold a vehicle or a stage, and which
 * one to reach for.
 *
 * Wes, 2026-09-16: after the second-hold work shipped, "add it to
 * /guides" so the how-to is somewhere Jose and Oliver can find it again
 * rather than in an email they lose.
 *
 * Written for AGENT (Jose, Oliver). Every control it names is behind
 * `canCreateBooking`, which is the same gate the pages themselves use, so
 * a rep who can read this page can do everything on it.
 *
 * Facts this page asserts, and where they live — keep them in lockstep:
 *   - "+ Nth hold on <unit>" on the selected reservation → GanttBoard
 *     `selectedUnitQueue` + the blue dashed button beside it.
 *   - Holds go 1st / 2nd / 3rd, no fourth → MAX_HOLD_RANK in
 *     lib/scheduling/holdRanks.ts (imported below so the number cannot
 *     drift out of this page).
 *   - "Place as 1st Hold / LiteHold" with nothing in the way →
 *     MakeReservationModal `quietRankChoice`, NewHoldModal's segmented
 *     control. Default is rank 1.
 *   - At capacity the choice is 2nd Hold vs "Make 1st Hold and demote
 *     other", and it BLOCKS submit → MakeReservationModal `queueBlock`
 *     and the `blockers` push.
 *   - "Place it as a backup hold instead" on a full class → NewHoldModal
 *     `capacityBlock`.
 *   - A rank >= 2 hold gets NO unit → both modals skip the unit-pick
 *     drawer; binding one would make the unit read `booked` and refuse
 *     the later hold (assignUnit `backup-has-dibs`).
 *   - Promote is manual → /api/scheduling/booking-items/[id]/promote,
 *     the Promote button on a backup bar.
 *   - Nothing about a hold emails the client → the holds route sends no
 *     mail.
 */
import Link from 'next/link'
import { SCHEDULE_LABEL } from '@/lib/app-labels'
import { MAX_HOLD_RANK, holdRankLabel } from '@/lib/scheduling/holdRanks'

export const metadata = { title: 'Holds · SirReel HQ' }

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

export default function HoldsGuidePage() {
  return (
    <div className="bg-lt-page -m-3 min-h-[calc(100vh-3rem)] p-4 md:-m-4 md:p-6">
      <div className="mx-auto max-w-3xl">
        <header className="mb-8 border-b-2 border-lt-fg pb-5">
          <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-lt-fg3">Sales</span>
          <h1 className="mt-1.5 text-3xl font-semibold tracking-tight text-lt-fg">
            Holding a vehicle or a stage
          </h1>
          <p className="mt-2 max-w-2xl text-[15px] text-lt-fg2">
            Three kinds of hold, and when to reach for each. Two of them are for the case where
            somebody already has what your client wants; the third is for work you would give up if
            a full-rate job turned up.
          </p>
        </header>

        <div className="mb-9 rounded-xl border border-lt-hairline bg-lt-inner p-4">
          <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.1em] text-lt-fg3">The short version</div>
          <dl className="space-y-2 text-[14px] leading-relaxed text-lt-fg2">
            <div>
              <dt className="inline font-semibold text-lt-fg">1st Hold — </dt>
              <dd className="inline">
                the real one. It holds the capacity, and the unit once you pick one. This is what you
                get unless you say otherwise.
              </dd>
            </div>
            <div>
              <dt className="inline font-semibold text-lt-fg">2nd / 3rd Hold — </dt>
              <dd className="inline">
                a place in the queue behind a production that already has it. You want it; somebody
                got there first.
              </dd>
            </div>
            <div>
              <dt className="inline font-semibold text-lt-fg">LiteHold — </dt>
              <dd className="inline">
                deliberately behind, with nothing ahead of it. For the reduced-rate and tentative
                work — student projects at 50%. Anyone booking later goes ahead of it automatically.
              </dd>
            </div>
          </dl>
        </div>

        <section className="mb-10">
          <h2 className="mb-1 text-xl font-semibold text-lt-fg">
            1 · A second hold on a specific truck or stage
          </h2>
          <p className="mb-4 text-[14px] text-lt-fg3">
            The client wants Cube 27, or the LED/Volume Stage, and it is already spoken for on those
            dates. You queue behind whoever has it.
          </p>
          <ol className="list-none border-b border-lt-hairline p-0">
            <Step n={1} title={`Open ${SCHEDULE_LABEL} and find the booking that is in the way`}>
              <p>
                Left nav →{' '}
                <Link href="/gantt" className="font-semibold underline underline-offset-2">
                  {SCHEDULE_LABEL}
                </Link>
                . Scroll to the unit your client asked for and find the bar sitting on their dates.
              </p>
            </Step>
            <Step n={2} title="Click that bar">
              <p>
                Click the booking itself, not the empty row. The panel that opens is the other
                production&rsquo;s reservation — you are not editing it, you are queueing behind it.
              </p>
            </Step>
            <Step n={3} title="Press “+ 2nd hold on …”">
              <p>
                A blue dashed button part-way down the panel, naming the unit. It arrives with the
                unit, the class and that booking&rsquo;s dates already filled in. Change the dates if
                your client&rsquo;s are different, then add the company, the contact and the job the
                way you would for any reservation.
              </p>
              <p>
                If a 2nd hold already exists on that class for those days the button will say{' '}
                <strong>3rd</strong> instead — it tells you where you are actually landing.
              </p>
            </Step>
          </ol>
          <Note tone="plain" label={`Holds go 1st, 2nd, ${holdRankLabel(MAX_HOLD_RANK)}`}>
            There is no fourth. If the button is gone and the panel says the class is full, that is a
            sub-rental conversation, not a reservation — or release a hold nobody is chasing any more.
          </Note>
        </section>

        <section className="mb-10">
          <h2 className="mb-1 text-xl font-semibold text-lt-fg">2 · LiteHold, for tentative and reduced-rate work</h2>
          <p className="mb-4 text-[14px] text-lt-fg3">
            Nothing is in the way — you just do not want this booking to stand in the way of a
            full-rate one later.
          </p>
          <ol className="list-none border-b border-lt-hairline p-0">
            <Step n={1} title="Start the reservation the way you always do">
              <p>
                <strong>New Order / Rez</strong> on{' '}
                <Link href="/jobs" className="font-semibold underline underline-offset-2">Jobs</Link>, or{' '}
                <strong>+ New reservation</strong> on the job itself.
              </p>
            </Step>
            <Step n={2} title="On the line, set “Place as” to LiteHold">
              <p>
                A small <strong>Place as</strong> row sits under each vehicle line with two buttons:{' '}
                <strong>1st Hold</strong> and <strong>LiteHold</strong>. It is there whether or not
                anything is booked. 1st Hold is selected for you — LiteHold is a deliberate choice
                every time.
              </p>
            </Step>
            <Step n={3} title="Finish the reservation normally">
              <p>
                No unit is picked for a LiteHold, and HQ will not ask you for one. That is the whole
                point: it is holding nothing, so there is nothing to take away later.
              </p>
            </Step>
          </ol>
          <Note tone="stop" label="Nobody is told when a LiteHold is bumped">
            If a full-rate job takes those dates, the LiteHold does not move, does not go red, and
            nothing emails anyone — it simply stops being the one that gets the truck. Before you
            promise a student production anything, open the job and look. This is the one gap worth
            knowing about.
          </Note>
        </section>

        <section className="mb-10">
          <h2 className="mb-1 text-xl font-semibold text-lt-fg">3 · When the whole class is booked out</h2>
          <p className="mb-4 text-[14px] text-lt-fg3">
            Not one specific truck — every truck of that type, on those dates.
          </p>
          <div className="space-y-3 text-[14px] leading-relaxed text-lt-fg2">
            <p>
              On <strong>New Order / Rez</strong> the line turns amber and tells you how many are
              free. You get two answers, and you have to pick one before the form will submit:
            </p>
            <ul className="ml-5 list-disc space-y-1.5">
              <li>
                <strong>2nd Hold</strong> — queue behind them. Costs the production ahead of you
                nothing.
              </li>
              <li>
                <strong>Make 1st Hold and demote other</strong> — your client takes the front and the
                incumbent drops to 2nd. It is recorded against your name. Nobody is emailed, but
                dispatch can see it.
              </li>
            </ul>
            <p>
              Starting the reservation from a job instead, the same situation now offers{' '}
              <strong>&ldquo;Place it as a backup hold instead&rdquo;</strong> rather than the dead end it
              used to be.
            </p>
          </div>
        </section>

        <section className="mb-10">
          <h2 className="mb-1 text-xl font-semibold text-lt-fg">4 · What a hold behind the queue does not do</h2>
          <div className="space-y-3 text-[14px] leading-relaxed text-lt-fg2">
            <p>
              A 2nd hold, a 3rd hold and a LiteHold are all the same thing underneath — a reservation
              that is not holding a truck. So:
            </p>
            <ul className="ml-5 list-disc space-y-1.5">
              <li>
                <strong>No unit is assigned to it.</strong> Nothing comes off the board and nothing is
                reserved for your client.
              </li>
              <li>
                <strong>It does not promote itself.</strong> When the hold in front releases, somebody
                has to open yours and press <strong>Promote</strong> — click the blue dashed bar on{' '}
                {SCHEDULE_LABEL} and the button is in the panel.
              </li>
              <li>
                <strong>Nothing is emailed to the client.</strong> A hold is internal. What you tell
                them is still on you.
              </li>
            </ul>
          </div>
          <Note tone="warn" label="A 2nd hold is not a booking">
            Do not tell a client they have the truck because a 2nd hold exists. They have a place in a
            queue. Until it is promoted and a unit is picked, the truck belongs to somebody else.
          </Note>
        </section>

        <section className="mb-4">
          <h2 className="mb-1 text-xl font-semibold text-lt-fg">5 · Where they show up on the board</h2>
          <div className="space-y-3 text-[14px] leading-relaxed text-lt-fg2">
            <p>
              <strong>Queued behind a named unit</strong> — a blue dashed bar in a thin lane directly
              under that truck&rsquo;s row, labelled 2nd hold queue.
            </p>
            <p>
              <strong>No unit named</strong> (most LiteHolds, and a backup on a full class) — a blue
              chip in the strip along the top of the board, reading{' '}
              <span className="font-semibold text-lt-fg">2nd · Cube Truck · Acme</span> with a
              &ldquo;queued behind&rdquo; count beside it. It is deliberately not in the red
              &ldquo;needs a unit&rdquo; count — a hold behind the queue is not owed a truck.
            </p>
          </div>
          <Note tone="plain" label="Something look wrong?">
            This is new. If a control does not do what this page says, say so rather than working
            around it.
          </Note>
        </section>
      </div>
    </div>
  )
}
