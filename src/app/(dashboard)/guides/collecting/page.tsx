/**
 * /guides/collecting — how to take a payment in HQ.
 *
 * Wes, 2026-09-01: "can i transfer this billing instruction to
 * sirreel.com somewhere or in HQ itself?"
 *
 * HQ, not sirreel.com. This names internal controls, says which invoice
 * states can be charged, and repeats the bank-detail fraud warning we
 * give clients — a page about how SirReel collects money does not belong
 * on the public marketing site.
 *
 * Written for Ana and correct for anyone in Sales or Admin: the controls
 * it describes render for every role that can see pricing.
 *
 * Deliberately a plain page rather than a CMS entry. There is no
 * internal-docs model in HQ and inventing one for a single procedure
 * would be a bigger commitment than the content justifies; if a second
 * and third guide appear, that is the moment to generalise.
 */
import Link from 'next/link'

export const metadata = { title: 'Collecting a payment · SirReel HQ' }

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
          <h1 className="mt-1.5 text-3xl font-semibold tracking-tight text-lt-fg">Collecting a payment</h1>
          <p className="mt-2 max-w-2xl text-[15px] text-lt-fg2">
            Three ways money comes in, and where each lives in HQ. Start with one question:
            has the client already given us a card?
          </p>
        </header>

        <section className="mb-10">
          <h2 className="mb-1 text-xl font-semibold text-lt-fg">1 · Charge the card on file</h2>
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
                No panel means no card — use step 2 below.</p>
              <Note tone="warn" label="Read the preference line">
                If it says the card is <strong>security only</strong>, the client elected to pay by check or bank
                transfer. Charge it only as a fallback on an unpaid balance, and tell them first.
              </Note>
            </Step>
            <Step n={4} title="Set the amount">
              <p>It defaults to the full balance. Type a smaller number for a deposit or part payment; you cannot
                exceed the balance.</p>
              <p>A <strong>3% processing fee</strong> is added on top and shown before you commit. The invoice is
                credited the base amount; the fee is extra. Tick <strong>waive</strong> only if the fee was
                negotiated away.</p>
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
          <h2 className="mb-1 text-xl font-semibold text-lt-fg">2 · Ask for a card</h2>
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
              <p>Once the card shows on the job, go back to section 1. Nothing needs re-keying.</p>
            </Step>
          </ol>
        </section>

        <section className="mb-10">
          <h2 className="mb-1 text-xl font-semibold text-lt-fg">3 · Bank transfer, wire or Zelle</h2>
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
              <p>A bank transfer does not post itself. When the money lands, record the payment against the invoice
                so the balance and the collections list stay true.</p>
            </Step>
          </ol>
          <Note tone="plain" label="Tell clients this once">
            SirReel never emails asking to send payment to a different account. If a client receives one it is
            fraud — they should call the number in their portal before sending anything.
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
                  ['No card panel on the invoice', 'No authorized card for this job.', 'Use section 2.'],
                  ['Card declined', 'The bank refused it — limit, expiry, or a fraud hold.', 'Ask the client to call their bank, or take another card.'],
                  ['Payment gateway unreachable', 'Our side could not reach CardPointe.', 'Wait and retry. If it persists, flag it — no card is at fault.'],
                  ['Invoice is not payable', 'Already paid, void, or still a draft.', 'Check the status; a draft has to be sent first.'],
                  ['Amount exceeds balance due', 'You typed more than is owed.', 'Lower it. Overpayment is refused deliberately.'],
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
        </footer>
      </div>
    </div>
  )
}
