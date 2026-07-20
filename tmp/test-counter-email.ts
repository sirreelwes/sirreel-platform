import { buildCounterEmail } from '../src/lib/contracts/buildCounterEmail'

const decisions = [
  { clauseRef: '5', decision: 'COUNTER' as const, note: null, changeIndex: 0 },
  { clauseRef: '7', decision: 'COUNTER' as const, note: 'Holding $1M per occurrence.', changeIndex: 1 },
  { clauseRef: '8', decision: 'ACCEPT' as const, note: null, changeIndex: 2 },
  { clauseRef: '11', decision: 'ACCEPT' as const, note: null, changeIndex: 3 },
  { clauseRef: '15', decision: 'REJECT' as const, note: null, changeIndex: 6 },
  { clauseRef: 'Fleet-new', decision: 'REJECT' as const, note: 'Mutual indemnity is a hard no.', changeIndex: 8 },
  { clauseRef: '30-new', decision: 'ACCEPT' as const, note: null, changeIndex: 9 },
  { clauseRef: '31-new', decision: 'COUNTER' as const, note: null, changeIndex: 10 },
  { clauseRef: '17', decision: 'PENDING' as const, note: null, changeIndex: 7 },
]
const { subject, body } = buildCounterEmail({
  aiChanges: [],
  decisions,
  company: { name: 'Black Dog Films' },
  job: { jobCode: 'SR-JOB-0042', name: 'Untitled Feature' },
  primaryContact: { fullName: 'Otibho Okojie', email: 'otibho@gmail.com' },
  senderName: 'Wes Bailey',
})
console.log('SUBJECT:', subject)
console.log('\n' + body)

// mailto encoding: old (URLSearchParams) vs new (manual percent-encoding)
const p = new URLSearchParams(); p.set('subject', subject); p.set('body', body)
const oldHref = `mailto:${encodeURIComponent('otibho@gmail.com')}?${p.toString()}`
const crlf = body.replace(/\r\n|\r|\n/g, '\r\n')
const newHref = `mailto:${encodeURIComponent('otibho@gmail.com')}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(crlf)}`
console.log('\nold href has "+":', oldHref.includes('Hi+') || oldHref.includes('SirReel+'), '| len', oldHref.length)
console.log('new href has "+":', newHref.includes('+'), '| spaces as %20:', newHref.includes('Hi%20'), '| CRLF as %0D%0A:', newHref.includes('%0D%0A'), '| len', newHref.length, newHref.length > 1800 ? '→ Open-in-mail DISABLED' : '→ Open-in-mail enabled')
console.log('\ncopy-email payload unchanged (raw body, no CRLF/encoding):', !body.includes('\r') && !body.includes('%20'))
