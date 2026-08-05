/**
 * Client-facing gear setup guides surfaced on the public site (/help/[slug]).
 *
 * ONE SOURCE OF TRUTH — the public page, the printable PDF blurb, and the
 * after-hours assistant's knowledge all read from here, so a change to the
 * steps can't leave the assistant quoting stale instructions.
 *
 * CREDENTIALS ARE DELIBERATELY ABSENT. The public site is unauthenticated and
 * in the sitemap, so a Wi-Fi password here would be indexed. Per-unit network
 * names and passwords live on the physical case label and on the printed card
 * packed in the kit — never in this file, the page, or the assistant prompt.
 * The print-with-credentials version of the sheet is produced separately and
 * is not served from /public.
 *
 * The matching customer PDF lives at public/guides/<pdf> and is the same
 * one-page sheet, credential-free.
 */

export interface GuideStep {
  title: string
  body: string[]
}

export interface GuideFaq {
  q: string
  a: string
}

export interface SetupGuide {
  slug: string
  /** Card + hero title. */
  title: string
  /** Short kicker above the title. */
  eyebrow: string
  /** One-liner used on the /help card and as the page meta description. */
  summary: string
  /** Printable one-pager served from /public. */
  pdfHref: string
  /** What ships in the case. `optional` items render greyed with a note. */
  kit: Array<{ label: string; optional?: boolean }>
  steps: GuideStep[]
  /** Optional add-on section (e.g. the mesh router) — rendered as a callout. */
  addOn?: {
    name: string
    note: string
    points: Array<{ title: string; body: string }>
  }
  placement: { good: string[]; bad: string[] }
  aim?: { title: string; body: string }
  faqs: GuideFaq[]
  returnChecklist: string[]
  /**
   * Compact plain-text brief injected into the after-hours assistant's system
   * prompt. Keep it SHORT and factual — it is prompt budget on every message.
   * Never put credentials or anything unit-specific in here.
   */
  assistantBrief: string
}

export const STARLINK_MINI_GUIDE: SetupGuide = {
  slug: 'starlink-mini',
  title: 'Starlink Mini',
  eyebrow: 'Setup guide',
  summary:
    'Get your SirReel Starlink Mini online in under 10 minutes — placement, power, Wi-Fi and the optional mesh router.',
  pdfHref: '/guides/starlink-mini-setup.pdf',
  kit: [
    { label: 'Starlink Mini dish (folding kickstand built in)' },
    { label: 'Power supply + AC cord' },
    { label: 'Long DC power cable' },
    { label: 'Hard carry case' },
    { label: 'Mini Router + power adapter', optional: true },
  ],
  steps: [
    {
      title: 'Put it outside, facing north',
      body: [
        'Set the Mini outdoors on a flat surface — ground, apple box, cart lid — flip out the kickstand, and aim the face up at the sky and toward the north.',
        'A clear, open view of the sky matters more than exact aim. Glass does not work, so it has to be fully outside.',
      ],
    },
    {
      title: 'Plug it in',
      body: [
        'Run the DC cable from the dish to the power supply, then plug the power supply into standard 110V AC — house power, genny, or a distro drop.',
        'Lights and a faint fan mean it is booting. Give it 5–10 minutes on the first power-up while it finds satellites, and leave it alone during that.',
      ],
    },
    {
      title: 'Join the Wi-Fi',
      body: [
        'On your phone or laptop, open Wi-Fi settings and pick the SirReel network for your unit — it is named SirReel followed by the unit number.',
        'The network name and password are printed on the label on your case and on the setup card packed with it. Please do not change them — the next crew needs to get on. If you cannot find the label, call us and we will read them to you.',
      ],
    },
    {
      title: "Confirm you're online",
      body: [
        'Open a browser and load any normal site. If it loads you are up — hand the Wi-Fi name and password to the rest of the crew.',
        "Optional: the free Starlink app (iOS / Android) shows live speed and outages, and its obstruction checker will confirm the best aim for your exact spot.",
      ],
    },
  ],
  addOn: {
    name: 'Mini Router',
    note: 'Only if one is packed in your case — if there is not one, skip this entirely.',
    points: [
      {
        title: 'Plug it in',
        body: 'Any standard 110V outlet — inside the production office, trailer, or tent. It takes 2–3 minutes to power up and link to the dish.',
      },
      {
        title: 'Keep it close',
        body: 'Place it within about 25 ft of the Starlink Mini, as close to line-of-sight as you can. Truck walls, containers, and stucco cut that range hard.',
      },
      {
        title: 'Connect the same way',
        body: 'It is a mesh extender — it rebroadcasts the same network, same name and password. No second network to join, just better coverage away from the dish.',
      },
    ],
  },
  placement: {
    good: [
      'Open ground, parking lot, or field',
      'On top of a cart, case, or apple box',
      'Rooftop or an open balcony rail',
      'Well clear of the treeline, in the open',
    ],
    bad: [
      'Indoors, or inside a truck or trailer',
      'Under a tent, awning, or stage roof',
      'Inside a window — glass blocks the signal',
      'Under trees, or tight against a building',
    ],
  },
  aim: {
    title: 'Aim it north',
    body: 'Standard for the LA area. A clear view of the sky beats perfect aim — the Starlink app confirms the best angle for your spot.',
  },
  faqs: [
    {
      q: 'The network does not show up',
      a: 'Confirm power at the outlet and that both ends of the DC cable are fully seated. Wait a full 5 minutes after plugging in before you go looking.',
    },
    {
      q: 'Connected, but no internet',
      a: 'Almost always the sky view. Move the dish away from trees, tents, and structures — even a branch overhead matters — then wait 2–3 minutes.',
    },
    {
      q: 'It keeps cutting in and out',
      a: 'Partial obstruction, or the dish got bumped off level. Re-place it in the open on a flat, stable surface.',
    },
    {
      q: 'Weak signal indoors',
      a: "If you have the optional Mini Router, move it closer to the dish. Without one you are relying on the dish's own Wi-Fi, so work nearer to it.",
    },
    {
      q: 'Slow with the whole crew on it',
      a: 'It is one shared connection. Ask people to pause cloud syncs, dailies uploads, and streaming while someone needs the bandwidth.',
    },
    {
      q: 'Still stuck',
      a: 'Unplug it, wait 30 seconds, plug it back in and give it 5 minutes. If that does not do it, call the 24/7 line.',
    },
    {
      q: 'Can it stay out in the rain?',
      a: 'The dish is weather-rated and can stay out in the wet. Standing water, sand, and salt spray are not fine — keep it up off the ground in those conditions. The Mini Router is NOT weather-rated and must stay dry indoors.',
    },
  ],
  returnChecklist: [
    'Wipe off dirt, mud, and water — dry before packing',
    'Fold the kickstand flat against the dish',
    'Coil the DC cable loosely — no tight wraps or kinks',
    'Power supply and AC cord back in the case',
    'Mini Router + adapter back in the case, if you got one',
    'Latch the case shut before it goes on the truck',
  ],
  assistantBrief: `STARLINK MINI RENTALS — SirReel rents Starlink Mini satellite internet units. Full guide: sirreel.com/help/starlink-mini (printable PDF linked there).
- Arrives activated on the SirReel account; nothing for the client to sign up for. The dish has Wi-Fi built in.
- Setup: place it OUTSIDE on a flat surface with a clear view of the sky, kickstand out, facing north; plug into standard 110V; wait 5-10 min on first boot; join the unit's Wi-Fi.
- Each unit has its own network named "SirReel" + a unit number. NEVER state a network password — you do not have it. The name and password are printed on the case label and the setup card in the kit; if the client cannot find them, tell them to call the 24/7 line.
- Most common failure is obstruction: under a tent, tree, awning, stage roof, truck, or inside a window will not work. Glass blocks it.
- Some kits include an optional Mini Router — a mesh extender that rebroadcasts the SAME network name and password. It needs 110V power and must sit within ~25 ft of the dish. It is NOT weather-rated and must stay dry; the dish itself is fine in rain.
- Fix-it order: check power and both cable ends -> move to open sky -> unplug 30 s and re-plug, then wait 5 min -> call the 24/7 line.
- Tell clients NOT to factory-reset the dish or change the Wi-Fi settings; it is tied to the SirReel service account.`,
}

export const SETUP_GUIDES: SetupGuide[] = [STARLINK_MINI_GUIDE]

export function getSetupGuide(slug: string): SetupGuide | undefined {
  return SETUP_GUIDES.find((g) => g.slug === slug)
}
