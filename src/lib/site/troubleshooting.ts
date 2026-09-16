/**
 * AHA troubleshooting tutorials — the things that go wrong on a truck at
 * 10pm, sectioned by symptom.
 *
 * Wes 2026-09-16: "let's set up AHA tutorials ... sectioned in AHA for
 * things like lift gate troubleshooting, battery issues, lost keys."
 *
 * ONE SOURCE OF TRUTH, same as src/lib/site/setupGuides.ts: the public
 * page and the assistant's knowledge both read from here, so AHA can never
 * quote a step the published guide no longer says.
 *
 * WHY THIS IS NOT A SetupGuide. A setup guide is linear — kit, placement,
 * steps toward one outcome. Troubleshooting is symptom-keyed and, more
 * importantly, it has to be able to STOP. A lift gate is a hydraulic
 * machine that injures people; the useful thing AHA can do is walk the two
 * or three safe checks and then say "stop, call us", not keep suggesting
 * things. Every guide therefore carries `stopIf` and AHA is told to treat
 * it as a hard boundary.
 *
 * WHAT IS DELIBERATELY NOT HERE. Anything needing tools, anything under a
 * raised gate, anything hydraulic or electrical beyond a switch position,
 * and any instruction to defeat a safety interlock. Also no unit-specific
 * facts (where a given truck's cutoff switch lives, which gates we run) —
 * those vary across the fleet and a confident wrong answer in the dark is
 * worse than "call us". `openQuestions` records the ones worth filling in;
 * it is repo-side only and never reaches the prompt or the public page.
 */

export interface TroubleshootingCheck {
  /** What to try, in the order it should be tried. */
  title: string
  body: string
}

export interface TroubleshootingGuide {
  slug: string
  title: string
  eyebrow: string
  /** One-liner for the card and the page meta description. */
  summary: string
  /** Plain-language symptoms a caller might say. Helps AHA pick the guide. */
  symptoms: string[]
  /** Safe checks, in order. No tools, no panels, no hydraulics. */
  checks: TroubleshootingCheck[]
  /** Hard stops. If any is true, escalate — do not keep troubleshooting. */
  stopIf: string[]
  /** What we need from the caller when it does get handed to a person. */
  tellUs: string[]
  /**
   * Compact brief injected into AHA's system prompt. Prompt budget on
   * EVERY message, so keep it tight and factual. No credentials, nothing
   * unit-specific, and it must carry the stop conditions.
   */
  assistantBrief: string
  /**
   * SirReel facts a person has to confirm before this guide can get more
   * specific. Repo-side only — never rendered, never in the prompt. Fleet
   * (Julian / Chris) answers these; then the guide gets better.
   */
  openQuestions: string[]
}

export const LIFT_GATE_GUIDE: TroubleshootingGuide = {
  slug: 'lift-gate',
  title: 'Lift gate will not work',
  eyebrow: 'Troubleshooting',
  summary:
    'The two or three safe things to check when a lift gate is dead or will not lower — and the point at which to stop and call us.',
  symptoms: [
    'lift gate not working',
    'gate will not go down',
    'gate will not lift the load',
    'nothing happens when I hit the switch',
    'gate is stuck halfway',
  ],
  checks: [
    {
      title: 'Start the truck and leave it running',
      body:
        'A lift gate runs off the truck battery and pulls hard. Running it with the engine off is the single most common way a gate goes dead mid-load. Start the engine, let it run a minute, then try again.',
    },
    {
      title: 'Set the parking brake and put it in park or neutral',
      body:
        'Many gates are interlocked and simply will not power up until the parking brake is set. It costs nothing to check.',
    },
    {
      title: 'Check the gate power switch is on',
      body:
        'There is usually a power or cutoff switch for the gate, often in the cab or near the battery box. If someone shut it off at the end of the last load, the controls are dead with no other symptom. Where it sits differs by truck — if you cannot find it, that is the moment to call rather than hunt.',
    },
    {
      title: 'Make sure the gate is fully unlatched and clear',
      body:
        'Stow pins, latches or a retaining strap still engaged will stop a gate cold. Look at the platform and make sure nothing is holding it and nothing is resting on it.',
    },
    {
      title: 'If it lifted before and will not now, take weight off',
      body:
        'A gate that hums or strains but will not raise is overloaded. Take some of the load off and try again. Do not try to "help" it up by hand.',
    },
  ],
  stopIf: [
    'Anyone is under, on, or reaching into the gate',
    'You see fluid leaking, or a bent, cracked or damaged platform',
    'A cable, chain or hinge looks damaged or out of place',
    'The gate is stuck part-way with a load on it',
    'Fixing it would need tools, opening a panel, or touching hydraulics or wiring',
  ],
  tellUs: [
    'The unit number on the truck',
    'What the gate does when you hit the switch — nothing, a click, a hum, or it moves partway',
    'Whether the engine is running and the parking brake is set',
    'Whether there is a load on the gate right now',
  ],
  assistantBrief: `LIFT GATE WILL NOT WORK — walk these in order, one at a time:
1. Start the truck and leave it running. A gate run with the engine off flattens the battery; this is the most common cause by far.
2. Set the parking brake, in park or neutral — many gates are interlocked and will not power up without it.
3. Check the gate's power/cutoff switch is ON (often in the cab or near the battery box). Where it sits VARIES BY TRUCK — if they cannot find it, hand off to a person rather than guessing a location.
4. Check nothing is holding the platform: stow pins, latches, a retaining strap, or something resting on it.
5. Hums or strains but will not raise = overloaded. Take weight off. Never tell anyone to help it by hand.
STOP and escalate immediately, do not keep troubleshooting, if: anyone is under or on the gate; fluid is leaking; the platform, a cable, chain or hinge is damaged; the gate is stuck part-way WITH A LOAD; or the fix would need tools, a panel opened, or touching hydraulics or wiring.
NEVER suggest bypassing a safety interlock, bleeding or topping up hydraulic fluid, or any electrical work.`,
  openQuestions: [
    'Which lift gate makes are in the fleet (Maxon / Waltco / Tommy Gate / Anthony)? Steps could name the actual control layout.',
    'Where does the gate power cutoff live on each truck type? Right now the guide has to say "varies by truck".',
    'Is there a documented manual-lower or emergency-lower procedure we are willing to talk a client through, or is that always a person?',
    'Do we want a photo of the control and the cutoff on the public page?',
  ],
}

export const BATTERY_GUIDE: TroubleshootingGuide = {
  slug: 'battery',
  title: 'Truck will not start',
  eyebrow: 'Troubleshooting',
  summary:
    'What the sound it makes tells you, the two things that usually caused it, and when to stop and get help.',
  symptoms: [
    'truck will not start',
    'battery is dead',
    'clicking when I turn the key',
    'it cranks slow',
    'nothing happens at all',
  ],
  checks: [
    {
      title: 'Listen to what it does — that is the diagnosis',
      body:
        'Rapid clicking usually means a flat battery. One loud click and nothing means a flat battery or the starter. Cranking slowly means a weak battery. Dash lights and radio but no crank still points at the battery. Complete silence with no dash lights at all points at a disconnect switch or a connection.',
    },
    {
      title: 'Work out what drained it',
      body:
        'On a production truck it is almost always one of two things: the lift gate was run with the engine off, or interior lights, an inverter or a charger were left on overnight. Knowing which one matters, because a battery that was flattened by a gate will likely do it again on the same shift.',
    },
    {
      title: 'Turn everything off, then check the battery disconnect',
      body:
        'Switch off lights, heater, radio, inverter and anything plugged in. If the truck has a battery disconnect or master switch, make sure it is on. Then wait a full minute before trying again — a rested battery will sometimes turn over once more.',
    },
    {
      title: 'Only jump start if the battery looks normal',
      body:
        'Look at it first. If it is swollen, cracked, leaking, or smells like rotten eggs, do not jump it and do not stay near it. Otherwise: both vehicles off, red to the dead positive, red to the good positive, black to the good negative, and the last black to a bare metal point on the dead truck away from the battery. Run the good vehicle a few minutes before trying.',
    },
    {
      title: 'Once it starts, keep it running',
      body:
        'Let it run and drive it rather than idling if you can. Shutting it straight off usually means doing this again. Tell us it happened either way, so we can get the battery tested before it strands someone.',
    },
  ],
  stopIf: [
    'The battery is swollen, cracked or leaking, or smells like rotten eggs',
    'You see or smell smoke, or anything is hot to the touch',
    'The jump leads spark heavily or get hot',
    'It starts and then dies again straight away',
    'You would have to remove or disconnect anything to go further',
  ],
  tellUs: [
    'The unit number on the truck',
    'Exactly what it does when you turn the key',
    'Whether the dash lights come on',
    'Whether the lift gate was used with the engine off, or anything was left on overnight',
    'Where the truck is parked right now',
  ],
  assistantBrief: `TRUCK WILL NOT START / BATTERY — the sound is the diagnosis:
- Rapid clicking = flat battery. One click then nothing = flat battery or starter. Slow crank = weak battery. Dash lights but no crank = battery. NO dash lights at all = disconnect switch or a connection.
- Cause on a production truck is almost always the lift gate run with the engine off, or lights/inverter/charger left on overnight. Ask which.
- Safe steps: turn everything off; make sure the battery disconnect/master switch is ON; wait a full minute; try again.
- Jump starting: only if the battery looks normal. Both vehicles off; red to dead positive, red to good positive, black to good negative, last black to BARE METAL on the dead truck away from the battery. Run the good vehicle a few minutes first. Once running, keep it running.
STOP and escalate, do not keep troubleshooting, if: the battery is swollen, cracked, leaking or smells of rotten eggs; there is smoke or heat; leads spark heavily or get hot; it starts then dies again; or going further would mean removing or disconnecting anything.
Always tell them to report it even after a successful jump, so the battery gets tested.`,
  openQuestions: [
    'Do our trucks carry jump packs or leads? If so the guide should say where, and this becomes a much better answer.',
    'Do we have a roadside assistance account a driver should be given instead of waiting on on-call?',
    'Which units have a battery disconnect/master switch, and where is it?',
    'Should a client ever be told to jump it themselves, or do we prefer that to always be us?',
  ],
}

export const LOST_KEYS_GUIDE: TroubleshootingGuide = {
  slug: 'lost-keys',
  title: 'Lost or locked-in keys',
  eyebrow: 'Troubleshooting',
  summary:
    'What to do first, how to keep the truck secure, and why this one goes to a person quickly.',
  symptoms: [
    'lost the keys',
    'locked the keys in the truck',
    'cannot find the key',
    'key will not turn',
    'locked out',
  ],
  checks: [
    {
      title: 'Check the three places keys actually go',
      body:
        'Still in the ignition, in the lock box if the truck has one, or in someone else\'s pocket. Ask everyone on the crew who touched the truck today before assuming they are gone. Most "lost" keys are found in under five minutes.',
    },
    {
      title: 'If the key is locked inside, do not force anything',
      body:
        'Slim jims, wedges and coat hangers damage door seals, wiring and airbag sensors on modern vehicles, and that damage is on the rental. Call instead. This is faster than it sounds.',
    },
    {
      title: 'Make the truck safe before you leave it',
      body:
        'If it is running, leave it running and stay with it. If it is unlocked and the keys are genuinely gone, do not walk away from it — an unsecured truck with gear in it is the real problem, not the key. Tell us where it is parked.',
    },
    {
      title: 'Call us rather than solving it yourself',
      body:
        'Getting a truck open or re-keyed is ours to arrange, not yours. A locksmith called by the production is usually slower and more expensive than what we can do, and cutting a key for our vehicle without us is not something we can authorise.',
    },
  ],
  stopIf: [
    'The truck is running and cannot be secured',
    'The truck is unlocked and unattended with gear in it',
    'Anyone is thinking about forcing a door or window',
    'It is blocking traffic, a driveway or a set',
    'A key broke off in the lock or the ignition',
  ],
  tellUs: [
    'The unit number on the truck',
    'Exactly where the truck is parked',
    'Whether it is locked or unlocked, and whether it is running',
    'Whether the key is inside the truck, or genuinely lost',
    'Who on the crew had it last',
  ],
  assistantBrief: `LOST OR LOCKED-IN KEYS — short guide, then a person:
- First: check the ignition, the lock box, and everyone on the crew who touched the truck today. Most are found in minutes.
- NEVER tell anyone to force a door or window, or to use a slim jim, wedge or coat hanger — that damages seals, wiring and airbag sensors and the damage lands on the rental.
- Securing the truck matters more than the key: if it is running, stay with it; if it is unlocked with gear inside, do not leave it. Get the parked location.
- Getting a truck opened or re-keyed is SirReel's to arrange, not the production's. Do not suggest they call a locksmith themselves, and do not state any spare-key location — you do not have one.
- This escalates quickly: collect unit number, exact location, locked or unlocked, running or not, key inside or lost, and who had it last, then hand off to a person.
STOP and escalate immediately if: the truck is running and cannot be secured; it is unlocked and unattended with gear in it; anyone is about to force a door; it is blocking traffic or a set; or a key snapped off in the lock or ignition.`,
  openQuestions: [
    'What IS the spare key policy? Do we hold spares, where, and who can release one? The guide deliberately says nothing because a wrong answer here is a stolen truck.',
    'Do we have a locksmith we use, and should on-call hand out that number?',
    'Who pays for a re-key when a production loses a key — is that in the rental agreement?',
    'Do any units use a key fob or an immobiliser that a locksmith cannot simply cut for?',
  ],
}

export const TROUBLESHOOTING_GUIDES: TroubleshootingGuide[] = [
  LIFT_GATE_GUIDE,
  BATTERY_GUIDE,
  LOST_KEYS_GUIDE,
]

export function getTroubleshootingGuide(slug: string): TroubleshootingGuide | undefined {
  return TROUBLESHOOTING_GUIDES.find((g) => g.slug === slug)
}
