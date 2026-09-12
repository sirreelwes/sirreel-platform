/**
 * The delivery-status callback URL carries its key.
 *
 *   npx tsx tests/sms/status-callback.test.ts
 *   npm run test:status-callback
 *
 * Pure + offline. Guards the 2026-09-11 bug: /api/public/sms/status
 * authenticates on an X-Twilio-Signature (needs TWILIO_AUTH_TOKEN, which
 * this account does NOT have) OR on ?key= matching TWILIO_WEBHOOK_SECRET.
 * The callback URL omitted the key, so every delivery receipt was rejected
 * 403 and every outbound row sat at 'queued' — an undelivered text looked
 * exactly like a delivered one. Invisible until the REST path sent its
 * first message, because a TwiML reply carries no status callback.
 */
import { statusCallbackUrl } from '../../src/lib/sms/threads'

const failures: string[] = []
function ok(cond: boolean, why: string): void {
  if (cond) console.log(`  ok — ${why}`)
  else { console.log(`  FAIL — ${why}`); failures.push(why) }
}
function eq(got: unknown, want: unknown, why: string): void {
  if (got === want) console.log(`  ok — ${why}`)
  else { console.log(`  FAIL — ${why}\n      got  ${got}\n      want ${want}`); failures.push(why) }
}

console.log('\nthe key is on the URL — without it the callback 403s')
{
  eq(
    statusCallbackUrl({ NEXT_PUBLIC_APP_URL: 'https://hq.sirreel.com', TWILIO_WEBHOOK_SECRET: 'PNabc123' } as NodeJS.ProcessEnv),
    'https://hq.sirreel.com/api/public/sms/status?key=PNabc123',
    'secret present → ?key= appended',
  )
  ok(
    statusCallbackUrl({ TWILIO_WEBHOOK_SECRET: 'PNabc123' } as NodeJS.ProcessEnv).startsWith('https://hq.sirreel.com/'),
    'no NEXT_PUBLIC_APP_URL → falls back to hq.sirreel.com',
  )
  eq(
    statusCallbackUrl({ NEXT_PUBLIC_APP_URL: 'https://hq.sirreel.com/', TWILIO_WEBHOOK_SECRET: 'PNabc123' } as NodeJS.ProcessEnv),
    'https://hq.sirreel.com/api/public/sms/status?key=PNabc123',
    'a trailing slash on the base does not produce a double slash',
  )
}

console.log('\nno secret → no key at all, not an empty one')
{
  eq(
    statusCallbackUrl({ NEXT_PUBLIC_APP_URL: 'https://hq.sirreel.com' } as NodeJS.ProcessEnv),
    'https://hq.sirreel.com/api/public/sms/status',
    'unset secret → bare URL',
  )
  eq(
    statusCallbackUrl({ NEXT_PUBLIC_APP_URL: 'https://hq.sirreel.com', TWILIO_WEBHOOK_SECRET: '   ' } as NodeJS.ProcessEnv),
    'https://hq.sirreel.com/api/public/sms/status',
    'whitespace-only secret → bare URL, never "?key="',
  )
}

console.log('\nthe secret survives the query string intact')
{
  const url = statusCallbackUrl({ NEXT_PUBLIC_APP_URL: 'https://hq.sirreel.com', TWILIO_WEBHOOK_SECRET: 'a b+c/d=e' } as NodeJS.ProcessEnv)
  eq(new URL(url).searchParams.get('key'), 'a b+c/d=e', 'a secret with URL-significant characters round-trips')
}

console.log(failures.length ? `\n${failures.length} FAILED\n` : '\nall passed\n')
process.exit(failures.length ? 1 : 0)
