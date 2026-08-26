/**
 * Title → PersonRole mapping tests.
 *
 *   npx tsx tests/crm/role-mapping.test.ts
 *   npm run test:role-mapping
 *
 * Pure + offline: no DB, no AI, no env.
 *
 * Why this file exists: on 2026-08-26 Wes pointed at Emmett Tekstra —
 * signature "Production Designer | Art Director", captured cleanly,
 * role stored as OTHER. Two bugs, both invisible without a test: no
 * ART_DIRECTOR bucket existed, and compound titles were matched whole
 * so neither half was ever tested on its own.
 *
 * Every title string below is REAL — taken from the 250 contacts that
 * held a parsed title and a role of OTHER. The false-positive cases at
 * the bottom matter just as much: a wrong role is worse than OTHER,
 * because it puts the contact in a segment sales will actually mail.
 */

import { PersonRole } from '@prisma/client'
import { mapTitleToRole, splitTitleSegments } from '../../src/lib/crm/roleMapping'

const failures: string[] = []

function check(title: string, want: PersonRole, why: string): void {
  const got = mapTitleToRole(title)
  if (got === want) {
    console.log(`  ok — ${why}`)
  } else {
    failures.push(`${why}\n      title: ${JSON.stringify(title)}\n      want ${want}, got ${got}`)
    console.log(`  FAIL — ${why} (want ${want}, got ${got})`)
  }
}

console.log('\nThe case that started it')
check('Production Designer | Art Director', PersonRole.ART_DIRECTOR,
  "Emmett Tekstra's signature — the whole reason this file exists")

console.log('\nCompound titles split on every real separator')
check('Location Scout/Manager', PersonRole.LOCATION_MANAGER, 'slash')
check('Production Designer / Set Designer / Prop Stylist', PersonRole.ART_DIRECTOR, 'multiple slashes')
check('Set Design + Prop Styling + Interiors', PersonRole.ART_DIRECTOR, 'plus')
check('Art Director, IATSE 800 ADG', PersonRole.ART_DIRECTOR, 'comma, with a union local that matches nothing')
check('Studio Production Services / Event Director', PersonRole.OTHER,
  'neither half is a production role we bucket — must stay OTHER, not guess')

console.log('\nRule precedence beats word order')
check('Set Designer | UPM', PersonRole.UPM, 'UPM outranks art dept regardless of which half comes first')
check('UPM | Set Designer', PersonRole.UPM, 'and the same the other way round')
check('Locations Coordinator', PersonRole.LOCATION_MANAGER,
  'a locations person, not a generic coordinator')
check('Art Coordinator', PersonRole.ART_COORDINATOR,
  'art coordinator keeps its own bucket, not folded into ART_DIRECTOR')

console.log('\nArt department')
check('Production Designer', PersonRole.ART_DIRECTOR, 'production designer')
check('Art Department', PersonRole.ART_DIRECTOR, 'department name used as a title')
check('Production Design & Art Direction', PersonRole.ART_DIRECTOR, 'ampersand is NOT a split point but still matches')
check('Set Decorator', PersonRole.ART_DIRECTOR, 'set dec')
check('Props Master', PersonRole.ART_DIRECTOR, 'props')

console.log('\nLocations')
check('Key Assistant Location Manager', PersonRole.LOCATION_MANAGER, 'assistant variant')
check('Location Manager', PersonRole.LOCATION_MANAGER, 'plain')

console.log('\nProduction office')
check('Production Manager', PersonRole.PRODUCTION_MANAGER, 'the 24 contacts stuck from before the rule shipped')
check('Sr. Production Manager', PersonRole.PRODUCTION_MANAGER, 'seniority prefix')
check('Head of Production', PersonRole.PRODUCTION_MANAGER, 'reads as the manager tier in practice')
check('Asst. Prod. Supervisor', PersonRole.PRODUCTION_SUPERVISOR, 'abbreviated supervisor')
check('Production Accountant', PersonRole.PRODUCTION_ACCOUNTANT, 'accounting cuts the PO')
check('Office PA', PersonRole.PRODUCTION_ASSISTANT, 'often who actually places the order')
check('Unit Production Manager', PersonRole.UPM, 'UPM wins over the production-manager rule')

console.log('\nGrip and electric are separate departments (Wes, 2026-08-26)')
check('Key Grip', PersonRole.GRIP, 'the 4 key grips that had no bucket')
check('Best Boy Grip', PersonRole.GRIP, 'qualified best boy resolves to its department')
check('Dolly Grip', PersonRole.GRIP, 'dolly grip')
check('Gaffer', PersonRole.GAFFER_ELECTRIC, 'gaffer')
check('Best Boy Electric', PersonRole.GAFFER_ELECTRIC, 'the other qualified best boy')
check('Chief Lighting Technician', PersonRole.GAFFER_ELECTRIC, 'the formal title for gaffer')
check('Key Grip / Gaffer', PersonRole.GRIP, 'compound across both — grip wins by rule order, not word order')
check('Best Boy', PersonRole.OTHER,
  'BARE best boy is deliberately unmatched — convention reads it as electric, but "usually" is not good enough for a field we segment on')

console.log('\nFalse positives — a wrong role is worse than OTHER')
check('Project Manager', PersonRole.OTHER, 'not a production manager')
check('Senior Project Manager', PersonRole.OTHER, 'still not')
check('PM', PersonRole.OTHER, 'bare PM is too collision-prone to map — deliberately unmatched')
check('Director', PersonRole.OTHER, 'a film director is not an art director')
check('Executive Director', PersonRole.OTHER, 'nonprofit title, not production')
check('Administrative Assistant', PersonRole.OTHER, 'not a production assistant')
check('Rental Agent', PersonRole.OTHER, 'works at a competitor, not on a production')
check('Head Alchemist', PersonRole.OTHER, 'real title in the book; means nothing to us')
check('Driver', PersonRole.OTHER, 'no bucket, and guessing transpo would be wrong')
check('', PersonRole.OTHER, 'empty string')
check('   ', PersonRole.OTHER, 'whitespace only')

console.log('\nSegment splitting itself')
{
  const segs = splitTitleSegments('Production Designer | Art Director')
  const ok = segs.includes('Production Designer') && segs.includes('Art Director')
    && segs.includes('Production Designer | Art Director')
  console.log(ok ? '  ok — keeps both halves AND the original whole string'
                 : `  FAIL — got ${JSON.stringify(segs)}`)
  if (!ok) failures.push('splitTitleSegments must keep both halves and the whole string')
}
{
  const segs = splitTitleSegments('Producer')
  const ok = segs.length === 1 && segs[0] === 'Producer'
  console.log(ok ? '  ok — a single title yields exactly one segment'
                 : `  FAIL — got ${JSON.stringify(segs)}`)
  if (!ok) failures.push('splitTitleSegments must not duplicate a single-segment title')
}

if (failures.length > 0) {
  console.error(`\n${failures.length} failure(s):\n`)
  failures.forEach((f) => console.error(`  - ${f}\n`))
  process.exit(1)
}
console.log('\nAll role-mapping tests passed.\n')
