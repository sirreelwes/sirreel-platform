/**
 * Job-name matching for the Planyo importer's attach decision.
 *
 * Every MUST-match case below is a real pair; every MUST-NOT case is a
 * real pair of DISTINCT productions for the same client, taken from the
 * seven CREATED_NEW_SIBLING decisions the sync has made to date. The
 * rung feeds `anchored` in resolveJobForBooking, so a false positive
 * here attaches a booking to the wrong show.
 *
 * Run: npm run test:job-name-match
 */
import { jobNamesRelated, looseKey, nameTokens } from '@/lib/jobs/jobNameMatch'

let fail = 0
const eq = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) fail++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label} → ${JSON.stringify(got)}${ok ? '' : ` (want ${JSON.stringify(want)})`}`)
}
const match = (a: string, b: string) => eq(`"${a}" ~ "${b}"`, jobNamesRelated(a, b), true)
const noMatch = (a: string, b: string) => eq(`"${a}" ≁ "${b}"`, jobNamesRelated(a, b), false)

// ── Helpers ──
eq('looseKey drops punctuation', looseKey('WS-RK'), 'wsrk')
eq('nameTokens splits on punctuation', nameTokens('WS-RK'), ['ws', 'rk'])
eq('nameTokens on a bare name', nameTokens('Toast'), ['toast'])

// ── MUST match ──
// The case that started this: SR-JOB-0315 "WS" (Darsh's self-serve entry)
// and Planyo cart 5789830 "WS-RK" (Jose's booking) — one Chaotic Neutral
// shoot that became two jobs on 2026-09-09.
match('WS', 'WS-RK')
match('WS-RK', 'WS')
// Punctuation and case are not evidence.
match('Kit Kat', 'KitKat')
match('kit kat', 'KIT-KAT')
// One name is the other plus a suffix.
match('Toast', 'Toast 2')
match('Shift Music Video', 'Shift')
// Containment on a substantial shared run.
match('Hills', 'The Hills')

// ── MUST NOT match — distinct productions, same client ──
// The Echobend rule (Wes, Jul 14): four shoots, one client, one week.
noMatch('Echobend A', 'Echobend B')
noMatch('Echobend C', 'Echobend D')
// The false positive the old rule allowed at FULL rung score: "newsroom"
// contains "ws", so an incoming Newsroom booking claimed the job "WS".
noMatch('Newsroom', 'WS')
noMatch('WS', 'Showstopper')
// Real siblings the sync flagged — all genuinely different shows.
noMatch('WC x KOI', 'The Hypnotist')
noMatch('Toast', 'Friday Aug 28')
noMatch('Goggles', 'Hot Pink')
noMatch('Goggles', 'Beach Chairs')
noMatch('Wrong Number', 'Hockey')
noMatch('Wrong Number', 'Kit Kat')
noMatch('V-La-61', 'God of Wrath & Ruin')
noMatch('V-La-61', 'Homegirls Before Husbands')
noMatch('WS-RK', 'Street')
// Two POs for one client are two jobs — they differ only in the number,
// which is the whole identity.
noMatch('PO 4074', 'PO #4055')
noMatch('LADT7_Secret_Agent', 'LADT8_Secret_Agent')

// ── Degenerate input ──
noMatch('', 'WS')
noMatch('WS', '')
eq('null is not a match', jobNamesRelated(null, 'WS'), false)
eq('undefined is not a match', jobNamesRelated('WS', undefined), false)
noMatch('---', 'WS')

console.log(fail === 0 ? '\nall job-name-match checks passed' : `\n${fail} FAILED`)
process.exit(fail === 0 ? 0 : 1)
