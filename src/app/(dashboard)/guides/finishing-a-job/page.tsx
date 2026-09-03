/**
 * /guides/finishing-a-job — how a rep bills a job out and closes it:
 * the HQ-native invoice path (generate → pre-invoice → issue) and the
 * RentalWorks path (link the RW order, record the agreed final number).
 *
 * Wes, 2026-09-02: "outlines how to either finalize invoices or drop RW
 * final invoice into job on HQ. It should also detail how to create
 * pre-invoice per our workflow."
 *
 * Companion to /guides/starting-a-job — same shape, same components,
 * the other end of the same job. See that file's header for why these
 * are plain pages and not a docs model.
 *
 * Facts this page asserts, and where they live — keep them in lockstep:
 *   - "Generate rental invoice" needs a BOOKED order (`bookedTotal`) and
 *     refuses a second live RENTAL invoice → orders/[id] invoices block.
 *   - The pre-invoice IS the draft: same row, same number, no PDF
 *     attached, `preSentAt` is what makes it visible in the portal →
 *     lib/invoices/sendPreInvoice.ts.
 *   - Client APPROVE closes the job (Job.status WRAPPED) and does NOT
 *     issue anything → api/portal/job/invoice/[id]/approve.
 *   - "Send invoice" issues it, PDF attached, and advances RETURNED →
 *     INVOICED → api/orders/[id]/invoices + sendInvoice.
 *   - Recording a final invoice emails the client payment options
 *     immediately and queues it on /collections →
 *     api/jobs/[id]/final-invoice POST.
 *   - The manual job-status dropdown is gone → jobs/[id] JOB_STATUSES
 *     comment (Wes 2026-09-01).
 */
import Link from 'next/link'

export const metadata = { title: 'Finishing a job · SirReel HQ' }

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

export default function FinishingAJobGuidePage() {
  return (
    <div className="bg-lt-page -m-3 min-h-[calc(100vh-3rem)] p-4 md:-m-4 md:p-6">
      <div className="mx-auto max-w-3xl">
        <header className="mb-8 border-b-2 border-lt-fg pb-5">
          <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-lt-fg3">Sales</span>
          <h1 className="mt-1.5 text-3xl font-semibold tracking-tight text-lt-fg">
            Finishing a job
          </h1>
          <p className="mt-2 max-w-2xl text-[15px] text-lt-fg2">
            The gear is back and the numbers are settled. This is how you bill it and close it out —
            whether the invoice comes out of HQ or out of RentalWorks. The companion to{' '}
            <Link href="/guides/starting-a-job" className="font-semibold underline underline-offset-2">
              starting a job
            </Link>.
          </p>
        </header>

        {/* The fork, stated once. Everything below is one branch or the
            other, and picking the wrong one is the expensive mistake. */}
        <div className="mb-9 rounded-xl border border-lt-hairline bg-lt-inner p-4">
          <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.1em] text-lt-fg3">Two paths — pick one</div>
          <p className="text-[14px] leading-relaxed text-lt-fg2">
            <strong className="text-lt-fg">Quoted in HQ?</strong> Bill it in HQ:{' '}
            generate the invoice → <strong>send the pre-invoice</strong> → client approves → issue it.
            Sections 1&ndash;3.
          </p>
          <p className="mt-2 text-[14px] leading-relaxed text-lt-fg2">
            <strong className="text-lt-fg">Billed in RentalWorks?</strong> Link the RW order so its
            invoices show on the job, then record the agreed final number here. Section 4.
          </p>
          <p className="mt-2 text-[13px] text-lt-fg3">
            Don&rsquo;t do both on one job. Two invoices with two numbers is how a client pays the wrong one.
          </p>
        </div>

        <section className="mb-10">
          <h2 className="mb-1 text-xl font-semibold text-lt-fg">1 · Before you invoice anything</h2>
          <p className="mb-4 text-[14px] text-lt-fg3">
            Two things have to be true, and one of them is a button people forget.
          </p>
          <ol className="list-none border-b border-lt-hairline p-0">
            <Step n={1} title="The order has to be booked">
              <p>
                <strong>Generate rental invoice</strong> is greyed out until the order is booked — the
                invoice anchors to the booked value, so there is nothing to anchor to before that. If the
                order is still sitting at approved, hit <strong>Book it</strong> on the order first.
              </p>
              <p>Hover the greyed-out button and it tells you which of the two is missing.</p>
            </Step>
            <Step n={2} title="Mark the job returned">
              <p>
                On the job page: <strong>More → Mark returned</strong>. This is what stops the job
                showing up as still out. It is separate from billing on purpose — the gear can be back
                weeks before the number is agreed.
              </p>
            </Step>
          </ol>
        </section>

        <section className="mb-10">
          <h2 className="mb-1 text-xl font-semibold text-lt-fg">2 · The pre-invoice round</h2>
          <p className="mb-4 text-[14px] text-lt-fg3">
            This is our workflow: the client sees the numbers and agrees them <em>before</em> we issue
            anything. It kills the disputed-invoice conversation before it starts.
          </p>
          <ol className="list-none border-b border-lt-hairline p-0">
            <Step n={1} title="Generate the invoice">
              <p>
                Order page → <strong>Invoices</strong> → <strong>Generate rental invoice</strong>. It comes
                out as a <strong>draft</strong>. Nothing has been sent and nothing has been issued.
              </p>
            </Step>
            <Step n={2} title="Read it before anyone else does">
              <p>
                <strong>Preview pre-invoice</strong> opens exactly what the client will see. Check the
                dates, the days and the extras now — this is the cheap moment to fix it.
              </p>
            </Step>
            <Step n={3} title="Send pre-invoice">
              <p>
                The client gets an email with a link into their portal to review it and hit approve.
                <strong> No PDF is attached</strong>, deliberately — an attachment invites them to file it
                as though it were the invoice, and it isn&rsquo;t one yet.
              </p>
              <Note tone="plain" label="One invoice, not two">
                The pre-invoice is not a second document. It is the same draft, the same number, the same
                totals — just shown for review before it is issued. That is why the final invoice carries
                the number they already agreed.
              </Note>
            </Step>
            <Step n={4} title="They approve — and the job closes itself">
              <p>
                A <strong>Client approved</strong> chip appears on the invoice, and the job goes to
                wrapped on its own. Closing a job is not a toggle anyone remembers to flip; it is what
                happens when the client agrees the numbers.
              </p>
              <p>Approving does not issue the invoice. That stays your call — see section 3.</p>
            </Step>
            <Step n={5} title="Or they ask for changes">
              <p>
                You get a <strong>Changes requested</strong> chip with their note on it. Fix the order,
                then use <strong>Update to match order</strong> on the invoice — it rewrites the draft and
                keeps the same number — and <strong>Re-send pre-invoice</strong>. Each send starts a clean
                round.
              </p>
            </Step>
          </ol>
          <Note tone="warn" label="If the invoice and the order drift apart">
            An invoice is a snapshot — it does not follow later edits to the order. When they stop
            matching, the invoice says so in amber and tells you the difference.{' '}
            <strong>Update to match order</strong> rewrites it and keeps the number. Void it only when the
            document has to be withdrawn outright — and note the client may already have that one.
          </Note>
        </section>

        <section className="mb-10">
          <h2 className="mb-1 text-xl font-semibold text-lt-fg">3 · Issue the final invoice</h2>
          <p className="mb-4 text-[14px] text-lt-fg3">
            Same invoice, now for real. This is the handoff to Ana.
          </p>
          <ol className="list-none border-b border-lt-hairline p-0">
            <Step n={1} title="Send invoice">
              <p>
                On the draft, hit <strong>Send invoice</strong>. The client gets the invoice PDF attached
                plus the link to their portal, where they can pay by card or get the bank details.
              </p>
              <p>The order moves to invoiced, and the balance starts showing on Collections.</p>
            </Step>
            <Step n={2} title="You can issue without an approval — know that you are">
              <p>
                The button works whether or not they approved the pre-invoice. If they haven&rsquo;t, the
                tooltip says so plainly: you are billing a figure they have not agreed. Sometimes that is
                right. Do it knowing.
              </p>
            </Step>
            <Step n={3} title="Then it is a collections job">
              <p>
                Chasing and taking the money is covered in{' '}
                <Link href="/guides/collecting" className="font-semibold underline underline-offset-2">
                  Collecting a payment
                </Link>.
              </p>
            </Step>
          </ol>
        </section>

        <section className="mb-10">
          <h2 className="mb-1 text-xl font-semibold text-lt-fg">4 · When the billing lives in RentalWorks</h2>
          <p className="mb-4 text-[14px] text-lt-fg3">
            RW is being phased out, but plenty of jobs are still invoiced there. You do not have to
            re-key any of it — you point HQ at it.
          </p>
          <ol className="list-none border-b border-lt-hairline p-0">
            <Step n={1} title="Link the RW order to the job">
              <p>
                On the job page, find <strong>RentalWorks billing</strong> → <strong>+ Link RW order</strong>.
                It suggests likely orders for that client ranked by date; pick one, or type the order
                number if you know it.
              </p>
              <p>
                Link the <strong>order</strong>, not an invoice — every invoice on it rolls up
                automatically, including ones cut later.
              </p>
            </Step>
            <Step n={2} title="Now the job shows the money">
              <p>
                Outstanding, received, invoiced and how many are still open, plus every invoice with its
                due date and a <strong>PDF</strong> link. Overdue ones go red. <strong>Mark paid</strong>{' '}
                is there for anything settled outside RW.
              </p>
            </Step>
            <Step n={3} title="Record the final number on the job">
              <p>
                Once the number is agreed, go to the <strong>Final invoice</strong> section →{' '}
                <strong>Upload final invoice</strong>. The <strong>final amount agreed</strong> is the only
                required field. Add the RW invoice number, and drag the PDF onto the drop zone if you have it.
              </p>
              <p>
                The PDF is optional on purpose — the number is usually settled on a call before the
                document exists, and waiting for the file is how this ends up back in email.
              </p>
            </Step>
            <Step n={4} title="Know what that button does">
              <p>
                Saving it does two things immediately: it <strong>emails the client their payment
                options</strong>, and it queues the job on Collections for Ana. It is not a quiet internal
                note.
              </p>
              <Note tone="warn" label="Read the confirmation line">
                It tells you who the email reached. If it says NOT emailed — usually because no contact on
                the job has an email address — the amount is still recorded and queued, but the client has
                not been told anything. Fix the contact and re-send from Collections.
              </Note>
            </Step>
          </ol>
          <Note tone="plain" label="Nothing closes an RW-billed job">
            There is no client approval step on this path, so the job does not wrap itself. That is fine —
            leave it. It drops off the main Jobs list on its own once it goes quiet, with nothing upcoming
            and nothing owed.
          </Note>
        </section>

        <section className="mb-10">
          <h2 className="mb-1 text-xl font-semibold text-lt-fg">5 · How to tell a job is actually finished</h2>
          <p className="mb-4 text-[14px] text-lt-fg3">
            The <strong>Final Invoice</strong> tile on the job&rsquo;s paperwork strip, in three states.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[34rem] border-collapse text-[14px]">
              <thead>
                <tr className="border-b border-lt-fg2/30 text-left text-[10px] font-bold uppercase tracking-[0.1em] text-lt-fg3">
                  <th className="py-2 pr-4">Tile says</th>
                  <th className="py-2 pr-4">Means</th>
                  <th className="py-2">Do</th>
                </tr>
              </thead>
              <tbody className="text-lt-fg2">
                {[
                  ['Not yet', 'No final number on this job at all.', 'Section 2 or section 4.'],
                  ['Not sent', 'A number exists and the client has NOT been told.', 'This is the one that quietly ages — send it.'],
                  ['Sent', 'Client has the invoice and knows how to pay.', 'Nothing. It is on Collections now.'],
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
          <Note tone="plain" label="There is no job-status dropdown any more">
            You cannot set a job to wrapped by hand, and you should not want to. Where a job is now reads
            from its orders, so it cannot go stale. The only manual off-ramps left are{' '}
            <strong>Mark job lost</strong> and archiving.
          </Note>
        </section>

        <section>
          <h2 className="mb-1 text-xl font-semibold text-lt-fg">When it doesn&rsquo;t work</h2>
          <p className="mb-4 text-[14px] text-lt-fg3">So you know whether to fix it, wait, or flag it.</p>
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
                  ['Generate rental invoice is greyed out', 'The order is not booked yet, or a rental invoice already exists.', 'Book it — or void the existing invoice before regenerating.'],
                  ['Generate the invoice first', 'You sent a pre-invoice with no draft to send.', 'Generate the rental invoice, then send.'],
                  ['Send pre-invoice is disabled', 'No contact on the job has an email address.', 'Add the contact on the job, then send.'],
                  ['A pre-invoice round only applies before it is issued', 'The invoice has already gone out.', 'Too late for a review round. Void and reissue if it is wrong.'],
                  ['This invoice no longer matches the order', 'The order changed after the invoice was cut.', 'Update to match order — it keeps the number.'],
                  ['Final invoice recorded — NOT emailed', 'Saved and queued, but the client heard nothing.', 'Fix the job contact, then re-send from Collections.'],
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
          Approving a pre-invoice is the client agreeing the figure — it never issues an invoice or moves
          money. Internal — this page is not on sirreel.com.
        </footer>
      </div>
    </div>
  )
}
