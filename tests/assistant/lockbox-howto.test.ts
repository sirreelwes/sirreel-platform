/**
 * AHA's lock box how-to: the picture, the caption, and never a code.
 *
 *   npx tsx tests/assistant/lockbox-howto.test.ts
 *   npm run test:lockbox-howto
 *
 * Pure + offline. Pins the four things that make the 2026-09-13 capability
 * work at the back of a truck at night:
 *   1. the MMS carries a PUBLIC https URL — Twilio fetches the media itself,
 *      unauthenticated, so a private or relative URL means no picture;
 *   2. the caption CARRIES THE LINK, because a carrier may drop the media on
 *      a message it still delivers, and MMS on a 10DLC number is a per-number
 *      capability we do not control;
 *   3. a non-https media URL is DROPPED, never sent — a bad MediaUrl fails
 *      the whole message, text included;
 *   4. nothing in the words is a code, and Jose's sentence is intact.
 */
import { buildMessageParams } from '../../src/lib/sms/sendSms'
import {
  LOCKBOX_GUIDE_PATH,
  LOCKBOX_PHOTO_PATH,
  LOCKBOX_STEPS,
  LOCKBOX_TROUBLESHOOTING,
  lockboxGuideUrl,
  lockboxPhotoCaption,
  lockboxPhotoUrl,
  lockboxTextOnly,
} from '../../src/lib/site/lockboxGuide'

const failures: string[] = []
function ok(cond: boolean, why: string): void {
  if (cond) console.log(`  ok — ${why}`)
  else { console.log(`  FAIL — ${why}`); failures.push(why) }
}
function eq(got: unknown, want: unknown, why: string): void {
  if (got === want) console.log(`  ok — ${why}`)
  else { console.log(`  FAIL — ${why}\n      got  ${got}\n      want ${want}`); failures.push(why) }
}

const SERVICE = { from: null, messagingServiceSid: 'MGda3482bd81e2c26b45cc188de36124dc' }

console.log("\nJose's sentence is the instruction, unchanged")
{
  eq(
    LOCKBOX_STEPS,
    'Start by sliding down the clear button, enter code and then push down at the top button to open.',
    'the wording he typed to May is what goes out',
  )
  ok(lockboxPhotoCaption().startsWith(LOCKBOX_STEPS), 'the caption leads with the steps, not with a link')
  ok(lockboxTextOnly().startsWith(LOCKBOX_STEPS), 'the no-photo fallback leads with the same steps')
}

console.log('\nthe URLs are absolute and public — Twilio fetches the media itself')
{
  ok(lockboxPhotoUrl().startsWith('https://'), 'photo URL is absolute https')
  ok(lockboxPhotoUrl().endsWith(LOCKBOX_PHOTO_PATH), 'photo URL points at the file under /public')
  ok(lockboxGuideUrl().endsWith(LOCKBOX_GUIDE_PATH), 'guide URL points at /help/lockbox')
  ok(!lockboxPhotoUrl().includes('/api/'), 'the photo is a static file, not a proxy route that could require auth')
}

console.log('\nthe caption carries the link, because the picture may not arrive')
{
  ok(lockboxPhotoCaption().includes(lockboxGuideUrl()), 'MMS caption contains the guide link')
  ok(lockboxTextOnly().includes(lockboxGuideUrl()), 'text-only fallback contains the guide link')
  ok(lockboxPhotoCaption().length <= 320, 'caption fits a couple of segments — it is read under a picture')
}

console.log('\nMediaUrl rides on the send, and only when it is https')
{
  const mms = buildMessageParams(SERVICE, { to: '+18185551234', body: 'hi', mediaUrls: [lockboxPhotoUrl()] })
  eq(mms.getAll('MediaUrl').length, 1, 'one attachment → one MediaUrl')
  eq(mms.get('MediaUrl'), lockboxPhotoUrl(), 'the attachment is the keypad photo')
  eq(mms.get('MessagingServiceSid'), SERVICE.messagingServiceSid, 'still goes through the registered service')
  ok(!mms.has('From'), 'and still carries no From')

  const plain = buildMessageParams(SERVICE, { to: '+18185551234', body: 'hi' })
  eq(plain.getAll('MediaUrl').length, 0, 'no media asked for → no MediaUrl, so ordinary texts are unchanged')

  const bad = buildMessageParams(SERVICE, {
    to: '+18185551234',
    body: 'hi',
    mediaUrls: ['http://hq.sirreel.com/help/lockbox-keypad.jpg', '/help/lockbox-keypad.jpg', '', lockboxPhotoUrl()],
  })
  eq(bad.getAll('MediaUrl').length, 1, 'http, relative and empty URLs are dropped — a bad MediaUrl fails the whole message')
  eq(bad.get('MediaUrl'), lockboxPhotoUrl(), 'the one https URL survives')
  eq(bad.get('Body'), 'hi', 'and the text is untouched by the dropping')

  const many = buildMessageParams(SERVICE, { to: '+18185551234', body: 'hi', mediaUrls: Array(14).fill(lockboxPhotoUrl()) })
  eq(many.getAll('MediaUrl').length, 10, 'capped at the carrier limit of 10')
}

console.log('\nnothing that goes out is a code')
{
  const words = [lockboxPhotoCaption(), lockboxTextOnly(), ...LOCKBOX_TROUBLESHOOTING.flatMap((t) => [t.q, t.a])].join(' ')
  // A run of 3+ digits that is not part of a URL is what a gate or lock box
  // code looks like. The guide must never contain one — it is a public page
  // and an unauthenticated MMS.
  const digits = words.replace(/https?:\/\/\S+/g, '').match(/\d{3,}/g)
  eq(digits, null, 'no 3+ digit run anywhere in the words AHA sends or the page shows')
  ok(!/\bcode is\b/i.test(words), 'and nothing claims to state a code')
  ok(LOCKBOX_TROUBLESHOOTING.length >= 3, 'the page answers more than the happy path')
}

console.log('')
if (failures.length) { console.error(`${failures.length} failure(s)`); process.exit(1) }
console.log('all good')
