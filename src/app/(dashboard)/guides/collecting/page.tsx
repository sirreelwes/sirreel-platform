/**
 * /guides/collecting — running the collections desk, day to day.
 *
 * Wes, 2026-09-01: "can i transfer this billing instruction to
 * sirreel.com somewhere or in HQ itself?" — HQ, not sirreel.com. This
 * names internal controls, says which invoice states can be charged, and
 * repeats the bank-detail fraud warning we give clients; a page about how
 * SirReel collects money does not belong on the marketing site.
 *
 * Wes, 2026-09-02: make it "a simple, plain english way to explain like we
 * made for 'how to start..' for sales".
 *
 * That prompted the reshape. The page used to answer ONE question — how do
 * I take a payment — which is the middle of Ana's day and none of the
 * edges. /guides/starting-a-job works because it walks a whole job start
 * to finish, so this now walks a whole DAY: what the desk is telling you,
 * who to chase, the three ways money arrives, and the report that closes
 * it out. The three payment sections are the original ones, kept.
 *
 * Written for Ana and correct for anyone in Sales or Admin: the controls
 * it describes render for every role that can see pricing. Write-off is
 * the exception and the page says so — Wes only, enforced server-side.
 *
 * Deliberately a plain page rather than a CMS entry — same call as the
 * other two guides. Three plain pages is still cheaper than a docs model.
 *
 * Facts this page asserts, and where they live — keep them in lockstep:
 *   - Outstanding / Ready to collect / Collected this month / Avg days to
 *     collect tiles → CollectionsWorkspace.
 *   - Aging review is >60 days, oldest first, rulings Still owed /
 *     Dispute / Write off → collections/aging-review.
 *   - "Mark collected" records a bank payment; card charges self-record →
 *     CollectionsWorkspace.
 *   - The EOD figures, and which are pre-filled vs checked →
 *     src/lib/collections/eodReport.ts.
 *   - A red RentalWorks meter stops invoice imports → RwConnectionCard.
 */
import Link from 'next/link'

export const metadata = { title: 'Collecting, day to day · SirReel HQ' }

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

export default function CollectingGuidePage() {
  return (
    <div className="bg-lt-page -m-3 min-h-[calc(100vh-3rem)] p-4 md:-m-4 md:p-6">
      <div className="mx-auto max-w-3xl">
        <header className="mb-8 border-b-2 border-lt-fg pb-5">
          <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-lt-fg3">Billing</span>
          <h1 className="mt-1.5 text-3xl font-semibold tracking-tight text-lt-fg">Collecting, day to day</h1>
          <p className="mt-2 max-w-2xl text-[15px] text-lt-fg2">
            One page for the whole desk: what to look at when you sit down, who to chase, the three
            ways money arrives, and the report that closes the day.
          </p>
        </header>

        {/* The whole day in one box, mirroring /guides/starting-a-job. Someone
            who reads nothing else should still know the shape. */}
        <div className="mb-9 rounded-xl border border-lt-hairline bg-lt-inner p-4">
          <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.1em] text-lt-fg3">The short version</div>
          <p className="text-[14px] leading-relaxed text-lt-fg2">
            <strong className="text-lt-fg">Open the desk → work the list → take the money → send the report.</strong>{' '}
            Everything starts at{' '}
            <Link href="/collections" className="font-semibold underline underline-offset-2">Collections</Link>:
            first the invoices an agent has finalised for you, then every other unpaid RentalWorks
            invoice, oldest first. Money arrives three ways — a card we already hold, a card we ask
            for, or a bank transfer.
          </p>
          <p className="mt-2 text-[14px] leading-relaxed text-lt-fg2">
            The one habit that matters: <strong className="text-lt-fg">record money the day it lands.</strong>{' '}
            Card charges record themselves. A wire or a check does not, and until someone marks it,
            the balance, the chase list and the end-of-day report are all wrong.
          </p>
          <p className="mt-2 text-[14px] leading-relaxed text-lt-fg2">
            The one rule: <strong className="text-lt-fg">never put a 3% card fee on an invoice.</strong>{' '}
            CardPointe adds that itself at the moment of charge. Typing it onto the invoice as well bills
            the client twice for the same fee.
          </p>
        </div>

        <section className="mb-10">
          <h2 className="mb-1 text-xl font-semibold text-lt-fg">1 · Start with the desk</h2>
          <p className="mb-4 text-[14px] text-lt-fg3">
            What <Link href="/collections" className="font-semibold underline underline-offset-2">Collections</Link>{' '}
            is telling you before you touch anything.
          </p>
          <ol className="list-none border-b border-lt-hairline p-0">
            <Step n={1} title="Check the connection strip at the very top">
              <p>
                One line: <strong>Connected · RentalWorks</strong>, when it was last checked and when it
                renews. Green is nothing to do.
              </p>
              <Note tone="stop" label="If it is red, stop">
                Invoice imports have stopped and nothing falls back to another source — the list below it
                is frozen at whatever it last knew, and it will not tell you that. Fix the connection
                before you work the list, or you will chase yesterday.
              </Note>
            </Step>
            <Step n={2} title="Read the tiles">
              <p>
                <strong>Outstanding (RW)</strong> is everything still owed, with a bar showing how old it
                is. <strong>This week</strong> and <strong>Collected this month</strong> are what has come
                in, and <strong>Avg days to collect</strong> is how fast it is coming.
              </p>
              <p>
                Outstanding excludes voided invoices, anything already marked paid, and anything written
                off — so it is what is genuinely chaseable, not a raw balance total.
              </p>
            </Step>
            <Step n={3} title="Note anything sitting on insurance">
              <p>
                Where a claim is in play the tile splits out <strong>awaiting insurance</strong> from{' '}
                <strong>on clients</strong>. Money waiting on a carrier is not a client who is ignoring
                you, and chasing them for it damages the relationship for nothing.
              </p>
            </Step>
          </ol>
        </section>

        <section className="mb-10">
          <h2 className="mb-1 text-xl font-semibold text-lt-fg">2 · Chase what is owed</h2>
          <p className="mb-4 text-[14px] text-lt-fg3">
            Two lists, and they are not the same list. Start with the first one.
          </p>
          <Note tone="plain" label="Why there are two, and why there won't be">
            An invoice can currently be born in two places. Where this is heading is that{' '}
            <strong>HQ is the source of truth</strong>: a final invoice created in RentalWorks gets
            imported so a copy lives here, and one created in HQ simply lives here already. Either way it
            ends up in HQ — RentalWorks is just one of the two places it can start, not a second system
            you work in.
          </Note>
          <ol className="list-none border-b border-lt-hairline p-0">
            <Step n={1} title="Ready to collect — your actual queue">
              <p>
                These are final invoices an agent has finalised on the job page. It is the work that is
                ready for you, so it comes first.
              </p>
            </Step>
            <Step n={2} title="All RentalWorks invoices — the fallback">
              <p>
                Underneath sits every unpaid RW invoice, oldest debt first, because that is the one most
                in need of a call. This is where anything finalised outside HQ shows up. Each row carries
                the client, the invoice, the balance and how late it is; open the job from the row when
                you need contacts or history before you call.
              </p>
            </Step>
            <Step n={3} title="Mark collected when money arrives outside HQ">
              <p>
                A wire, ACH, Zelle or check that lands in the bank does not post itself. Use{' '}
                <strong>Mark collected</strong> on the row the day it arrives. Card charges taken in HQ
                record themselves — you never mark those.
              </p>
              <Note tone="warn" label="This is the habit everything else depends on">
                An unrecorded payment keeps the client on the chase list, overstates Outstanding, and
                leaves the end-of-day report short. It is thirty seconds now against a wrong number and
                an awkward phone call later.
              </Note>
            </Step>
            <Step n={4} title="Once a week, clear the aging review">
              <p>
                <Link href="/collections/aging-review" className="font-semibold underline underline-offset-2">
                  Aging review
                </Link>{' '}
                is every open invoice past 60 days, oldest first, waiting for a ruling:{' '}
                <strong>Still owed</strong>, <strong>Dispute</strong>, or <strong>Write off</strong>. The
                Collections page shows a count of undecided rows so you can see the backlog without
                opening it.
              </p>
              <p>
                Rulings are data, not notes. They drive what stays in Outstanding and they build the
                write-off ledger at the bottom of that page — which is the bad-debt list at tax time,
                with dates and amounts. Deciding again replaces the earlier ruling, so rule and move on.
              </p>
              <Note tone="plain" label="Write off is Wes only">
                The button is hidden for everyone else and refused on the server too. Everything else on
                that page is yours.
              </Note>
            </Step>
          </ol>
        </section>

        <section className="mb-10">
          <h2 className="mb-1 text-xl font-semibold text-lt-fg">3 · Charge the card on file</h2>
          <p className="mb-4 text-[14px] text-lt-fg3">
            For any invoice marked Sent or Partial where the client authorized a card through their portal.
          </p>
          <ol className="list-none border-b border-lt-hairline p-0">
            <Step n={1} title="Open the order">
              <p>Left nav → <Link href="/orders" className="font-semibold underline underline-offset-2">Orders</Link>.
                Search the company or order number and click the row.</p>
            </Step>
            <Step n={2} title="Find the invoice and expand it">
              <p>Scroll to <strong>Invoices</strong> and click it open. Only <strong>Sent</strong> and{' '}
                <strong>Partial</strong> invoices can take a payment — Paid, Void and Draft cannot.</p>
            </Step>
            <Step n={3} title="Check the card block">
              <p>A panel headed <strong>💳 Card on file</strong> shows the card type, last four and cardholder.
                No panel means no card — use section 4.</p>
              <Note tone="warn" label="Read the preference line">
                If it says the card is <strong>security only</strong>, the client elected to pay by check or bank
                transfer. Charge it only as a fallback on an unpaid balance, and tell them first.
              </Note>
            </Step>
            <Step n={4} title="Set the amount">
              <p>It defaults to the full balance. Type a smaller number for a deposit or part payment; you cannot
                exceed the balance.</p>
              <p>
                The <strong>3% card fee is added by CardPointe</strong>, not by us and not by you. HQ shows an
                estimate of it before you commit; the real figure comes back from the gateway, which waives the
                fee by itself on debit and prepaid cards and for cardholders in states that prohibit it. The
                invoice is credited the amount you typed — the fee rides on top and is recorded separately.
              </p>
              <p>Tick <strong>waive</strong> only when the fee was negotiated away.</p>
              <Note tone="stop" label="Never add a card fee to an invoice">
                Wes, 2026-09-02: &ldquo;nobody adds a 3% credit card fee onto any invoice. The credit card company
                is supposed to automatically do that.&rdquo; A fee line typed onto an invoice — here or in
                RentalWorks — is charged <em>on top of</em> the one CardPointe already adds, so the client pays
                6%. There is no card-fee line item in HQ for exactly this reason.
              </Note>
            </Step>
            <Step n={5} title="Charge, and read the confirmation">
              <p>The dialog repeats the split and ends “This runs a real charge through CardPointe.” Check the last
                four against the client you meant to charge, then confirm.</p>
              <Note tone="stop" label="This is live money">
                There is no undo here. A charge made in error has to be voided or refunded through the payment
                record, so read the dialog before confirming.
              </Note>
            </Step>
            <Step n={6} title="Confirm it landed">
              <p>The balance drops and a payment appears on the invoice. If the balance has not moved, the charge
                did not go through.</p>
            </Step>
          </ol>
        </section>

        <section className="mb-10">
          <h2 className="mb-1 text-xl font-semibold text-lt-fg">4 · Ask for a card</h2>
          <p className="mb-4 text-[14px] text-lt-fg3">
            When no card is on file. The client enters it themselves — we never handle the number.
          </p>
          <ol className="list-none border-b border-lt-hairline p-0">
            <Step n={1} title="Open the job, not the order">
              <p>Left nav → <Link href="/jobs" className="font-semibold underline underline-offset-2">Jobs</Link> →
                the job. The card authorizes against the job, so one request covers every order on it.</p>
            </Step>
            <Step n={2} title="Send the card authorization request">
              <p>You get a preview before anything sends. Check the recipient is whoever actually handles payment,
                not just the production contact.</p>
            </Step>
            <Step n={3} title="Wait for them to authorize">
              <p>They enter the card on a secure form. CardPointe tokenizes it in their browser — the number never
                reaches SirReel, and you only ever see the last four.</p>
            </Step>
            <Step n={4} title="Then charge it">
              <p>Once the card shows on the job, go back to section 3. Nothing needs re-keying.</p>
            </Step>
          </ol>
        </section>

        <section className="mb-10">
          <h2 className="mb-1 text-xl font-semibold text-lt-fg">5 · Bank transfer, wire or Zelle</h2>
          <p className="mb-4 text-[14px] text-lt-fg3">
            No processing fee. Usually the better path on large invoices, and often what a production&rsquo;s
            accounts-payable team prefers.
          </p>
          <ol className="list-none border-b border-lt-hairline p-0">
            <Step n={1} title="Point them at their portal">
              <p>Every client portal carries <strong>Pay by bank transfer</strong> — payee, bank, account type, ACH
                and wire routing, remittance address and the Zelle tag, each with a copy button. The invoice email
                already links there.</p>
            </Step>
            <Step n={2} title="Or send it straight to their A/P team">
              <p>The portal has a <strong>Send these details to your accounts payable team</strong> button, so
                nobody retypes an account number.</p>
            </Step>
            <Step n={3} title="Record it when it arrives">
              <p>A bank transfer does not post itself. When the money lands, hit <strong>Mark collected</strong> on
                the invoice so the balance, the chase list and tonight&rsquo;s report all stay true.</p>
            </Step>
          </ol>
          <Note tone="plain" label="Tell clients this once">
            SirReel never emails asking to send payment to a different account. If a client receives one it is
            fraud — they should call the number in their portal before sending anything.
          </Note>
        </section>

        <section className="mb-10">
          <h2 className="mb-1 text-xl font-semibold text-lt-fg">6 · Close the day</h2>
          <p className="mb-4 text-[14px] text-lt-fg3">
            The end-of-day summary that goes to Dani and Wes. HQ works out the figures; you check them
            and add the sentence they actually read.
          </p>
          <ol className="list-none border-b border-lt-hairline p-0">
            <Step n={1} title="Press Send EOD Report">
              <p>
                Top of{' '}
                <Link href="/collections" className="font-semibold underline underline-offset-2">Collections</Link>.
                It opens with today&rsquo;s numbers already filled in and tells you who it is going to.
              </p>
            </Step>
            <Step n={2} title="Check the figures — especially the ones tagged “check”">
              <p>
                <strong>Collected today</strong> is the whole take.{' '}
                <strong>of which card</strong> is the CardPointe slice of that same money, not a second
                pile — HQ works out the ACH/wire/cheque remainder for you.
              </p>
              <p>
                Any field tagged <strong>check</strong> is one HQ cannot see all of. Money you marked paid
                straight in RentalWorks never passed through HQ, and orders written directly in RW are not
                counted. Every box is editable; type over anything that is wrong.
              </p>
              <Note tone="plain" label="Why some numbers look low">
                The more you record in HQ as it happens, the closer these arrive. The figures are only as
                complete as the day&rsquo;s marking-off.
              </Note>
            </Step>
            <Step n={3} title="Write the note">
              <p>
                This is the part no query can produce — returns that slipped to Monday, an ACH still in
                flight, why today looks light. Dani and Wes read this before the numbers.
              </p>
            </Step>
            <Step n={4} title="Send">
              <p>
                It goes out as your email, so a reply comes back to you. Sending twice is fine — a
                corrected report is a normal evening, and you will be asked to confirm.
              </p>
            </Step>
          </ol>
        </section>

        <section className="mb-10">
          <h2 className="mb-1 text-xl font-semibold text-lt-fg">7 · What your login opens</h2>
          <p className="mb-4 text-[14px] text-lt-fg3">
            Your menu is deliberately short. It is not a cut-down version of someone else&rsquo;s — every
            entry is there because a billing question needs it, and the point is that you can settle most
            disputes without asking anyone.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[34rem] border-collapse text-[14px]">
              <thead>
                <tr className="border-b border-lt-fg2/30 text-left text-[10px] font-bold uppercase tracking-[0.1em] text-lt-fg3">
                  <th className="py-2 pr-4">When you need to know</th>
                  <th className="py-2">Where to look</th>
                </tr>
              </thead>
              <tbody className="text-lt-fg2">
                {[
                  ['What is still owed, across everything', 'Receivables (RW) — every mirrored invoice, searchable, with the client and job stitched on.'],
                  ['What this line item actually is, and what it rents for', 'Inventory. This is the one that settles a disputed charge without a phone call.'],
                  ['Whether they really had it those days', 'Reservations. What went out and when it came back is how a disputed rental window gets decided.'],
                  ['What moved today', 'Deliveries & Pickups — read-only for you, and that is fine; you are reading it, not running it.'],
                  ['Whether we hold their COI or signed contract', 'Paperwork.'],
                  ['Who to actually call', 'Clients, or the job page from any invoice row — contacts, email history and the job&rsquo;s whole story.'],
                  ['Why an invoice looks wrong before it reached you', 'How to finish a job — the sales end of the same job. You read the other end of it.'],
                  ['Whether an order is linked to its job', 'Reconcile RW.'],
                ].map(([a, b]) => (
                  <tr key={a} className="border-b border-lt-hairline align-top">
                    <td className="py-2.5 pr-4 font-medium text-lt-fg">{a}</td>
                    <td className="py-2.5">{b}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Note tone="plain" label="What you will not see, and why it does not matter">
            Fleet, Warehouse and the COO reporting section are not in your menu because those pages would
            refuse you anyway — the tabs would be noise pointing at dead ends. You can see pricing but not
            company revenue, and you cannot confirm or cancel a booking or assign a vehicle. None of that
            sits between you and collecting; if you ever find that it does, say so and it changes.
          </Note>
          <Note tone="warn" label="One entry that does not work yet">
            <strong>Payment Info</strong> is in your menu but the page is admin-only, so it will refuse
            you. You do not need it: the bank details clients need are already on their own portal, with
            a button to send them to accounts payable — section 5. Changing those details is Wes&rsquo;s
            job by design.
          </Note>
        </section>

        <section>
          <h2 className="mb-1 text-xl font-semibold text-lt-fg">When it doesn&rsquo;t work</h2>
          <p className="mb-4 text-[14px] text-lt-fg3">
            What each failure means, so you know whether to retry, chase, or escalate.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[34rem] border-collapse text-[14px]">
              <thead>
                <tr className="border-b border-lt-fg2/30 text-left text-[10px] font-bold uppercase tracking-[0.1em] text-lt-fg3">
                  <th className="py-2 pr-4">What you see</th>
                  <th className="py-2 pr-4">What it means</th>
                  <th className="py-2">What to do</th>
                </tr>
              </thead>
              <tbody className="text-lt-fg2">
                {[
                  ['No card panel on the invoice', 'No authorized card for this job.', 'Use section 4.'],
                  ['Card declined', 'The bank refused it — limit, expiry, or a fraud hold.', 'Ask the client to call their bank, or take another card.'],
                  ['Payment gateway unreachable', 'Our side could not reach CardPointe.', 'Wait and retry. If it persists, flag it — no card is at fault.'],
                  ['Invoice is not payable', 'Already paid, void, or still a draft.', 'Check the status; a draft has to be sent first.'],
                  ['Amount exceeds balance due', 'You typed more than is owed.', 'Lower it. Overpayment is refused deliberately.'],
                  ['RentalWorks strip is red', 'Invoice imports have stopped; the list is stale.', 'Fix the connection before working the list — nothing falls back.'],
                  ['EOD says the card figure is larger than the total', 'Card is part of the total, so one box is wrong.', 'Almost always a digit in the wrong field. Send unlocks once it is fixed.'],
                  ['EOD saved but did not send', 'Your figures and note are stored; the email failed.', 'Press send again — nothing needs re-keying.'],
                ].map(([a, b, c]) => (
                  <tr key={a} className="border-b border-lt-hairline align-top">
                    <td className="py-2.5 pr-4 font-medium text-lt-fg">{a}</td>
                    <td className="py-2.5 pr-4">{b}</td>
                    <td className="py-2.5">{c}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <footer className="mt-10 border-t border-lt-hairline pt-4 text-[13px] text-lt-fg3">
          Card numbers are tokenized by CardPointe in the client&rsquo;s browser; SirReel never stores or sees a
          full card number. Internal — this page is not on sirreel.com.
          <span className="mt-2 block">
            Related:{' '}
            <Link href="/guides/starting-a-job" className="font-semibold underline underline-offset-2">Starting a job</Link>{' '}
            ·{' '}
            <Link href="/guides/finishing-a-job" className="font-semibold underline underline-offset-2">Finishing a job</Link>
          </span>
        </footer>
      </div>
    </div>
  )
}
