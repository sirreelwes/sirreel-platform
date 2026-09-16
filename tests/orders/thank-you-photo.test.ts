/**
 * Thank-you photo source tests.
 *
 *   npx tsx tests/orders/thank-you-photo.test.ts
 *   npm run test:thank-you-photo
 *
 * Pure + offline — the DB half (resolveThankYouPhoto) is exercised by
 * running the compose page; what is pinned here is the gate in front of it.
 *
 * The compose page used to post `photoUrlOverride`, a raw URL the preview
 * and send routes dropped straight into the email's <img src>. That meant
 * the candid never rendered (private blob → 403 in the recipient's inbox)
 * AND that any signed-in user could point a client-facing email at any host.
 * The body now NAMES a source. These tests exist so a URL can never again be
 * mistaken for one.
 */
import { parsePhotoSource } from '../../src/lib/orders/thankYouPhoto'

const failures: string[] = []
function eq(got: unknown, want: unknown, why: string): void {
  const g = JSON.stringify(got), w = JSON.stringify(want)
  if (g === w) console.log(`  ok — ${why}`)
  else { console.log(`  FAIL — ${why}\n      got  ${g}\n      want ${w}`); failures.push(why) }
}

console.log('parsePhotoSource — only the three names are a source')
eq(parsePhotoSource('weekly'), 'weekly', 'the agent\'s candid')
eq(parsePhotoSource('order'), 'order', 'a JOB_PHOTO on this order')
eq(parsePhotoSource('none'), 'none', 'no photo — the slot collapses')

console.log('\nanything else is not a source')
eq(parsePhotoSource(undefined), null, 'absent → null, so the caller keeps the historical ladder')
eq(parsePhotoSource(null), null, 'null → null')
eq(parsePhotoSource(''), null, 'empty string is not a source')
eq(parsePhotoSource('WEEKLY'), null, 'case matters — no accidental near-miss')
eq(parsePhotoSource(123), null, 'a number is not a source')
eq(parsePhotoSource({ source: 'weekly' }), null, 'an object is not a source')

console.log('\na URL is not a source — this is the whole point')
eq(
  parsePhotoSource('https://blob.vercel-storage.com/agents/u1/candid-abc.jpg'),
  null,
  'the private blob URL the page used to post is refused',
)
eq(
  parsePhotoSource('https://evil.example.com/tracking-pixel.gif'),
  null,
  'an attacker-supplied url can never reach a client-facing <img src>',
)
eq(parsePhotoSource('/api/public/agent-photo/u1'), null, 'not even one of our own paths')

if (failures.length) { console.log(`\n${failures.length} failure(s)`); process.exit(1) }
console.log('\nall passed')
