/**
 * /guides/starting-a-job — how a rep starts a job in HQ and sends the
 * client their paperwork portal, instead of emailing the Cognito
 * booking package.
 *
 * Wes, 2026-09-02: "a simple, plain english instruction for how Oliver
 * and Jose can send paperwork portal to clients and start jobs in HQ
 * rather than their usual booking package."
 *
 * Written for AGENT (Jose, Oliver) and correct for anyone in Sales or
 * Admin — every control it names renders for roles that can see pricing.
 *
 * Same shape as /guides/collecting deliberately: a plain page, no CMS.
 * Two guides is not yet a docs system; if a fourth appears, generalise.
 *
 * Facts this page asserts, and where they live — keep them in lockstep:
 *   - "+ New Job" fields + the duplicate check → NewJobLauncher +
 *     JobResolverModal.
 *   - "Send quote →" opens the email review gate → orders/new
 *     createQuote('send') → orders/[id] ?send=1.
 *   - Client approval releases the agreement by itself →
 *     /api/portal/job/approve-quote (steps 1-3 of its header).
 *   - "Send Paperwork Portal" (no quote needed) → order page Portal
 *     access → /api/orders/[id]/send-paperwork-portal.
 *   - "Send for signature" invites AND releases → jobs/[id]
 *     sendForSignature.
 *   - The card tile and the paperwork score need a live order or
 *     reservation on the job → jobs/[id] `stripScored`.
 */
import Link from 'next/link'

export const metadata = { title: 'Starting a job · SirReel HQ' }

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

export default function StartingAJobGuidePage() {
  return (
    <div className="bg-lt-page -m-3 min-h-[calc(100vh-3rem)] p-4 md:-m-4 md:p-6">
      <div className="mx-auto max-w-3xl">
        <header className="mb-8 border-b-2 border-lt-fg pb-5">
          <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-lt-fg3">Sales</span>
          <h1 className="mt-1.5 text-3xl font-semibold tracking-tight text-lt-fg">
            Starting a job &amp; sending the paperwork portal
          </h1>
          <p className="mt-2 max-w-2xl text-[15px] text-lt-fg2">
            Instead of emailing the booking package, make the job here and send the quote from HQ.
            The client gets one link to their own portal and does the paperwork there — and you can
            see exactly what they have and have not done.
          </p>
        </header>

        {/* The whole point, in one box. A rep who reads nothing else
            should still know the shape of the new flow. */}
        <div className="mb-9 rounded-xl border border-lt-hairline bg-lt-inner p-4">
          <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.1em] text-lt-fg3">The short version</div>
          <p className="text-[14px] leading-relaxed text-lt-fg2">
            <strong className="text-lt-fg">Job → quote → send.</strong> That is the whole thing.
            Sending the quote gives the client their portal link. When they hit approve in the portal,
            the rental agreement opens itself for signing — nobody at SirReel has to send a second
            thing. The COI, the card and the drivers all live in that same portal.
          </p>
        </div>

        <section className="mb-10">
          <h2 className="mb-1 text-xl font-semibold text-lt-fg">1 · Make the job</h2>
          <p className="mb-4 text-[14px] text-lt-fg3">
            The job is the show. Everything else — quotes, reservations, paperwork — hangs off it.
          </p>
          <ol className="list-none border-b border-lt-hairline p-0">
            <Step n={1} title="Go to Jobs and hit + New Job">
              <p>
                Left nav → <Link href="/jobs" className="font-semibold underline underline-offset-2">Jobs</Link>.
                The <strong>+ New Job</strong> button is at the top right, next to the search box.
              </p>
            </Step>
            <Step n={2} title="Type what you know">
              <p>
                <strong>Job name</strong> is the production or show. <strong>Production company</strong> searches
                as you type — pick the company off the list if it is already there, and it links to the existing
                one instead of making a duplicate. Only use &ldquo;Create new company&rdquo; when it genuinely is new.
              </p>
              <p>
                Contact name, phone and email are optional on this screen, but put the email in. That is the
                person the portal link goes to.
              </p>
            </Step>
            <Step n={3} title="Let it check for an existing job">
              <p>
                <strong>Continue — check for existing Jobs</strong> shows you any job that looks like a match
                before it creates anything. If the show is already in HQ, pick it. A second job for the same
                show splits the paperwork in half.
              </p>
            </Step>
            <Step n={4} title="You land on the job page">
              <p>That page is home base for this show. Every step below happens there or one click away.</p>
            </Step>
          </ol>
        </section>

        <section className="mb-10">
          <h2 className="mb-1 text-xl font-semibold text-lt-fg">2 · Put the rental on it</h2>
          <p className="mb-4 text-[14px] text-lt-fg3">
            Both buttons are at the top of the job page, and both open with the job already filled in.
          </p>
          <ol className="list-none border-b border-lt-hairline p-0">
            <Step n={1} title="+ New quote — what they're being charged">
              <p>
                Add the dates and the line items, then use <strong>Send quote →</strong> at the bottom.
                <strong> Save Draft</strong> if you are not ready to send; <strong>Preview PDF</strong> if you
                just want to look at it first.
              </p>
            </Step>
            <Step n={2} title="+ New reservation — holding the actual units">
              <p>
                Pick a category and the hold lands on this job. Quoting and holding are separate on purpose:
                a quote does not take a truck off the board by itself.
              </p>
            </Step>
          </ol>
          <Note tone="plain" label="Why this matters for paperwork">
            The paperwork tiles on the job page stay quiet until there is a quote or a reservation on the job —
            a brand-new job with no COI is just a new job, not a problem. Once something real is on it, the
            tiles start scoring and the card-request button turns on.
          </Note>
        </section>

        <section className="mb-10">
          <h2 className="mb-1 text-xl font-semibold text-lt-fg">3 · Send the quote — that is the portal</h2>
          <p className="mb-4 text-[14px] text-lt-fg3">
            The quote email carries the client&rsquo;s portal link. There is no separate &ldquo;send the
            portal&rdquo; step in the normal flow.
          </p>
          <ol className="list-none border-b border-lt-hairline p-0">
            <Step n={1} title="Review the actual email">
              <p>
                <strong>Send quote →</strong> opens the real email before it goes anywhere. Check who it is going
                to, add anyone else on CC, and type a note if you want one.
              </p>
            </Step>
            <Step n={2} title="Send it">
              <p>
                They get the quote PDF plus a link into their portal for this show. Nothing else needs sending.
              </p>
            </Step>
            <Step n={3} title="Watch the job, not your inbox">
              <p>
                The job page shows where they are. Re-sending the quote later is fine — it does not reset
                anything.
              </p>
            </Step>
          </ol>
        </section>

        <section className="mb-10">
          <h2 className="mb-1 text-xl font-semibold text-lt-fg">4 · What the client does on their own</h2>
          <p className="mb-4 text-[14px] text-lt-fg3">
            This is the part that replaces the booking package. You do not have to chase any of it by hand.
          </p>
          <ol className="list-none border-b border-lt-hairline p-0">
            <Step n={1} title="They approve the quote">
              <p>
                Approving is their yes. It also <strong>releases the rental agreement into the same portal</strong>{' '}
                automatically — the agreement row flips from &ldquo;your rep will send this shortly&rdquo; to a live
                <strong> Sign agreement</strong> button without anyone here touching it.
              </p>
              <p>
                Approved is a green light, not a booking. Someone at SirReel still books it deliberately.
              </p>
            </Step>
            <Step n={2} title="They sign the rental agreement">
              <p>Read it and sign it right in the portal. No separate form, no PDF round-trip.</p>
            </Step>
            <Step n={3} title="They drop the COI">
              <p>
                They upload the certificate in the portal and it gets reviewed on arrival. It is flagged here if
                the certificate names the wrong company.
              </p>
            </Step>
            <Step n={4} title="They authorize a card and name drivers">
              <p>
                The card is entered on a secure form in their portal — we never handle the number, and you only
                ever see the last four. Drivers and licences go in the same place.
              </p>
            </Step>
          </ol>
        </section>

        <section className="mb-10">
          <h2 className="mb-1 text-xl font-semibold text-lt-fg">5 · Paperwork moving before a quote is ready</h2>
          <p className="mb-4 text-[14px] text-lt-fg3">
            Sometimes the client wants to sign while you are still pricing it. You can open the portal without
            sending a quote.
          </p>
          <ol className="list-none border-b border-lt-hairline p-0">
            <Step n={1} title="Save the quote as a draft first">
              <p>
                There has to be an order on the job, even an unsent draft — the portal link belongs to the order.
                <strong> Save Draft</strong> is enough.
              </p>
            </Step>
            <Step n={2} title="Open the order and find Portal access">
              <p>
                On the order page, scroll to <strong>Portal access</strong> → the{' '}
                <strong>Send paperwork portal</strong> box.
              </p>
            </Step>
            <Step n={3} title="Type their email and send">
              <p>
                <strong>Send Paperwork Portal</strong> emails the link and opens the rental agreement for signing
                in one go. No quote, and no pricing, goes with it.
              </p>
            </Step>
          </ol>
        </section>

        <section className="mb-10">
          <h2 className="mb-1 text-xl font-semibold text-lt-fg">6 · Chasing the missing pieces</h2>
          <p className="mb-4 text-[14px] text-lt-fg3">
            All of this is on the job page, under the <strong>Paperwork</strong> tiles. Each tile jumps to its
            own section.
          </p>
          <ol className="list-none border-b border-lt-hairline p-0">
            <Step n={1} title="Rental agreement — Send for signature">
              <p>
                The button names the person it reaches, so you never have to guess. It emails the portal link and
                opens the agreement for signing in one action.
              </p>
            </Step>
            <Step n={2} title="COI — Copy COI link">
              <p>
                A drop link you can paste into an email or a text, for a client or their broker. Whatever they
                drop lands on the job and gets reviewed.
              </p>
              <p>
                Got it by email instead? <strong>+ Upload COI</strong> files it here so HQ stays the truth.
              </p>
            </Step>
            <Step n={3} title="Card — Send CC request">
              <p>
                Sends the client the card authorization step in their portal. Check it is going to whoever
                actually handles payment, not just the production contact. It turns on once the job has a quote
                or a reservation on it.
              </p>
            </Step>
            <Step n={4} title="Already signed on paper? Upload signed agreement">
              <p>
                If they signed off-portal — paper, or the old form — use{' '}
                <strong>↑ Upload signed agreement</strong> on the job.
              </p>
              <Note tone="warn" label="This is the one that stops the asking">
                Uploading the signed PDF is what makes the client&rsquo;s portal show the agreement as signed.
                Filing it anywhere else leaves them being asked to sign something they already signed.
              </Note>
            </Step>
          </ol>
        </section>

        <section>
          <h2 className="mb-1 text-xl font-semibold text-lt-fg">Old way → new way</h2>
          <p className="mb-4 text-[14px] text-lt-fg3">Same paperwork. One link, and it reports back.</p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[34rem] border-collapse text-[14px]">
              <thead>
                <tr className="border-b border-lt-fg2/30 text-left text-[10px] font-bold uppercase tracking-[0.1em] text-lt-fg3">
                  <th className="py-2 pr-4">You used to</th>
                  <th className="py-2 pr-4">Now</th>
                  <th className="py-2">Where</th>
                </tr>
              </thead>
              <tbody className="text-lt-fg2">
                {[
                  ['Email the booking package', 'Send the quote — the portal link rides along', 'Job → + New quote → Send quote →'],
                  ['Email the rental agreement form', 'It releases itself when they approve the quote', 'Nothing to do'],
                  ['Ask for a COI by email', 'Send the drop link, or let the portal collect it', 'Job → Certificate of Insurance → Copy COI link'],
                  ['Collect card details by form', 'They authorize it themselves in the portal', 'Job → Card Authorization → Send CC request'],
                  ['Keep a list of who sent what back', 'The Paperwork tiles say what is outstanding', 'Job page, top of the page'],
                  ['Wonder whether they opened it', 'Portal access shows Invited vs Active', 'Order → Portal access'],
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
          <Note tone="plain" label="Accounts with an annual agreement">
            Some clients have a signed annual agreement on file. Their portal says so and does not ask them to
            sign again, and an approved company COI carries forward if it covers the dates. Send the quote the
            same way — the portal works the rest out.
          </Note>
        </section>

        <footer className="mt-10 border-t border-lt-hairline pt-4 text-[13px] text-lt-fg3">
          <p>
            When the gear comes back, the other half of this is{' '}
            <Link href="/guides/finishing-a-job" className="font-semibold underline underline-offset-2">
              Finishing a job
            </Link>{' '}
            — invoicing it and closing it out.
          </p>
          <p className="mt-2">
            Portal links are per contact, expire after 7 days, and can be re-sent or revoked from the
            order&rsquo;s Portal access panel. Internal — this page is not on sirreel.com.
          </p>
        </footer>
      </div>
    </div>
  )
}
