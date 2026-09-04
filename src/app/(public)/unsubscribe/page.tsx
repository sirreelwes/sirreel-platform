/**
 * Public unsubscribe landing page.
 *
 * Reached from the footer of every outreach email. Unauthenticated by
 * necessity — the person clicking may not be a portal user, may be
 * reading on a phone eighteen months later, and must not be asked to
 * prove anything. The signed token in the link is the proof.
 *
 * ── Why it acts on GET ─────────────────────────────────────────────
 * A confirm-button step reads as friction designed to keep people
 * subscribed, and mailbox providers increasingly judge us on how easy
 * this is. So the click IS the unsubscribe: land here, it is already
 * done, and the page says so.
 *
 * The usual objection to acting on GET is prefetchers and scanners
 * firing the link. Here that objection cuts the other way — a scanner
 * unsubscribing someone is a far better failure than a person who
 * clicked and stayed subscribed. Suppression is also reversible by a
 * human, so an accidental one is recoverable; a missed one is a
 * compliance breach.
 *
 * A bad or missing signature is NOT treated as an error to fix — the
 * page tells them to reply to the email and we will do it by hand,
 * because someone in the act of unsubscribing should never hit a wall.
 */

import { verifyUnsubscribeToken } from '@/lib/outreach/unsubscribeToken'
import { suppressEmail } from '@/lib/outreach/suppression'
import { prisma } from '@/lib/prisma'
import { AlertTriangle, Check } from 'lucide-react'

export const dynamic = 'force-dynamic'

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px',
        background: '#f5f5f4',
        fontFamily:
          'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Helvetica, Arial, sans-serif',
      }}
    >
      <div
        style={{
          maxWidth: '30rem',
          width: '100%',
          background: '#fff',
          border: '1px solid #e7e5e4',
          borderRadius: '16px',
          padding: '32px',
          textAlign: 'center',
          color: '#1c1917',
        }}
      >
        {children}
        <p style={{ marginTop: '28px', fontSize: '12px', color: '#a8a29e' }}>
          SirReel Studio Services
        </p>
      </div>
    </main>
  )
}

export default async function UnsubscribePage({
  searchParams,
}: {
  searchParams: Promise<{ e?: string; t?: string }>
}) {
  const { e, t } = await searchParams
  const email = verifyUnsubscribeToken(e ?? null, t ?? null)

  if (!email) {
    return (
      <Shell>
        <h1 style={{ fontSize: '20px', fontWeight: 600, margin: '0 0 12px' }}>
          We couldn&rsquo;t read that link
        </h1>
        <p style={{ fontSize: '14px', lineHeight: 1.6, color: '#57534e', margin: 0 }}>
          It may have been broken by your email app. Reply to the email you received with
          &ldquo;unsubscribe&rdquo; and we&rsquo;ll take you off the list by hand — you don&rsquo;t
          need to do anything else.
        </p>
      </Shell>
    )
  }

  let ok = true
  try {
    const person = await prisma.person.findUnique({ where: { email }, select: { id: true } })
    await suppressEmail({
      email,
      reason: 'UNSUBSCRIBED',
      source: 'unsubscribe-link',
      personId: person?.id ?? null,
    })
  } catch (err) {
    console.error('[unsubscribe] failed to record suppression:', err)
    ok = false
  }

  return (
    <Shell>
      <div style={{ fontSize: '32px', marginBottom: '12px' }}>{ok ? <Check size={14} aria-hidden /> : <AlertTriangle size={14} aria-hidden />}</div>
      <h1 style={{ fontSize: '20px', fontWeight: 600, margin: '0 0 12px' }}>
        {ok ? 'You\u2019re unsubscribed' : 'We couldn\u2019t finish that'}
      </h1>
      <p style={{ fontSize: '14px', lineHeight: 1.6, color: '#57534e', margin: 0 }}>
        {ok ? (
          <>
            <strong style={{ color: '#1c1917' }}>{email}</strong> won&rsquo;t receive any more
            marketing email from us.
          </>
        ) : (
          <>
            Something went wrong on our end. Reply to the email you received with
            &ldquo;unsubscribe&rdquo; and we&rsquo;ll take care of it by hand.
          </>
        )}
      </p>
      {ok && (
        <p style={{ fontSize: '13px', lineHeight: 1.6, color: '#78716c', marginTop: '16px' }}>
          You&rsquo;ll still get email about rentals you book with us — quotes, agreements,
          invoices and pickup details. Those aren&rsquo;t marketing.
        </p>
      )}
    </Shell>
  )
}
