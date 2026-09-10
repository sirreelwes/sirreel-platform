/**
 * SMS send-path tests.
 *
 *   npm run test:sms-config
 *
 * The A2P 10DLC campaign was approved 2026-09-10 against one Messaging
 * Service. Carriers treat a text as registered only when it goes out
 * through that service, and a text that goes out from a bare number that
 * was never added to the service is filtered as unregistered with NO error
 * at send time. So the cases pinned here are the ones where being wrong is
 * invisible:
 *
 *   - with the service SID set, the request names the service and carries
 *     no From (a number outside the service then fails loudly)
 *   - without it, the From number still works, normalised to E.164
 *   - a service SID that is not an MG… value is reported, not sent
 *   - nothing configured stays the quiet "SMS is off" state
 *
 * Pure functions only; nothing here touches Twilio or the DB.
 */
import { buildMessageParams, resolveTwilioConfig } from '../../src/lib/sms/sendSms'

let failed = 0
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) console.log(`  ✓ ${name}`)
  else { failed++; console.log(`  ✗ ${name}`, detail === undefined ? '' : JSON.stringify(detail)) }
}

const env = (o: Record<string, string>) => o as unknown as NodeJS.ProcessEnv
const base = { TWILIO_ACCOUNT_SID: 'AC' + 'a'.repeat(32), TWILIO_API_KEY_SID: 'SK' + 'b'.repeat(32), TWILIO_API_KEY_SECRET: 'secret' }
const SERVICE = 'MGda3482bd81e2c26b45cc188de36124dc'

console.log('resolveTwilioConfig')
{
  const r = resolveTwilioConfig(env({ ...base, TWILIO_MESSAGING_SERVICE_SID: SERVICE }))
  check('service SID alone is a complete configuration', r.config !== null && r.config.messagingServiceSid === SERVICE && r.config.from === null, r)
}
{
  const r = resolveTwilioConfig(env({ ...base, TWILIO_FROM_NUMBER: '(747) 335-1665' }))
  check('from number alone still configures the fallback path', r.config !== null && r.config.messagingServiceSid === null && r.config.from === '(747) 335-1665', r)
}
{
  const r = resolveTwilioConfig(env({ ...base, TWILIO_MESSAGING_SERVICE_SID: SERVICE, TWILIO_FROM_NUMBER: '+17473351665' }))
  check('both set keeps both; the service wins at send time', r.config !== null && r.config.messagingServiceSid === SERVICE && r.config.from === '+17473351665', r)
}
{
  const r = resolveTwilioConfig(env({ ...base, TWILIO_MESSAGING_SERVICE_SID: 'AC' + 'c'.repeat(32) }))
  check('a non-MG service SID is a named misconfiguration', r.config === null && /MG/.test(r.reason ?? ''), r)
}
{
  const r = resolveTwilioConfig(env({ ...base }))
  check('credentials with no sender name both options in the reason', r.config === null && /TWILIO_MESSAGING_SERVICE_SID/.test(r.reason ?? '') && /TWILIO_FROM_NUMBER/.test(r.reason ?? ''), r)
}
{
  const r = resolveTwilioConfig(env({}))
  check('nothing set is the quiet off state (no reason)', r.config === null && r.reason === null, r)
}

console.log('buildMessageParams')
{
  const p = buildMessageParams({ from: '+17473351665', messagingServiceSid: SERVICE }, { to: '+18185551234', body: 'hi', statusCallback: 'https://hq.sirreel.com/api/public/sms/status' })
  check('service configured → MessagingServiceSid, no From', p.get('MessagingServiceSid') === SERVICE && !p.has('From'), p.toString())
  check('destination, body and status callback carried', p.get('To') === '+18185551234' && p.get('Body') === 'hi' && p.get('StatusCallback') === 'https://hq.sirreel.com/api/public/sms/status', p.toString())
}
{
  const p = buildMessageParams({ from: '747-335-1665', messagingServiceSid: null }, { to: '+18185551234', body: 'hi' })
  check('no service → From, normalised to E.164', p.get('From') === '+17473351665' && !p.has('MessagingServiceSid'), p.toString())
  check('no status callback when none given', !p.has('StatusCallback'), p.toString())
}
{
  const p = buildMessageParams({ from: null, messagingServiceSid: SERVICE }, { to: '+18185551234', body: 'x'.repeat(2000) })
  check('body capped at 1500 characters', (p.get('Body') ?? '').length === 1500)
}

if (failed) { console.log(`\n${failed} failing`); process.exit(1) }
console.log('\nall passing')
