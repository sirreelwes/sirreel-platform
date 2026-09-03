'use client';

/**
 * The after-hours instructions, as a page. Rendered from two places:
 *
 *   /portal/job/[slug]/after-hours   the client, inside their portal session
 *   /after-hours/[token]             a driver or PA, holding a share link
 *
 * One component because they are the same page. The driver's copy is not a
 * cut-down version — a driver who can't get in is the failure this whole
 * feature exists to prevent, so they get the codes, the gate, the steps and
 * the phone number in full. What differs is only what surrounds it: the
 * client gets the share panel and a way back to their project; the driver
 * gets neither, because they have no project page and nobody to forward to.
 *
 * WHO IS READING THIS: someone on a phone, in the dark, at a gate, with one
 * hand. Every decision below follows from that:
 *
 *   - The two codes are the largest type on the page, above everything that
 *     isn't the address. Not a numbered list to parse — two slabs you can
 *     read at arm's length.
 *   - The address is tap-to-navigate. The mailing address alone puts drivers
 *     on the wrong side of the block; the gate is on Kewen, not Lankershim.
 *   - The phone number is a tel: link near the top and again at the bottom.
 *     When this page has failed its reader, the fix is a phone call.
 *   - Dropping off and picking up are separate blocks, because the mistakes
 *     differ: a drop-off with no photo has no receipt; a pickup that takes
 *     the wrong cart strands another production.
 */

import { PORTAL, PORTAL_SERIF } from '@/lib/brand/portalTokens';

export interface AfterHoursStepShape {
  kind: 'text' | 'code';
  text: string;
  code?: string | null;
  codeLabel?: string;
}

export interface AfterHoursViewData {
  projectName: string;
  /** The agent's standing line for this job. */
  note: string | null;
  /** On a share only — what the person who forwarded it typed. */
  message?: string | null;
  recipientName?: string | null;
  gateCode: string | null;
  containerCode: string | null;
  steps: AfterHoursStepShape[];
  location: {
    entity: string;
    street: string;
    cityStateZip: string;
    gateName: string;
    mapsUrl: string;
  };
  schedule: { weekdays: string; saturday: string; sunday: string };
  support: { phone: string; phoneHref: string; staffedHours: string; helpUrl: string };
  rules: { droppingOff: string; pickingUp: string };
  agent: { name: string | null; email: string | null; phone: string | null } | null;
}

export function AfterHoursShell({
  subtitle,
  children,
}: {
  subtitle?: string | null;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen" style={{ backgroundColor: '#F8F7F4' }}>
      <header className="w-full" style={{ backgroundColor: PORTAL.dark }}>
        <div className="max-w-2xl mx-auto px-6 py-7 text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/sirreel-logo-white.png"
            alt="SirReel Studio Services"
            width={160}
            style={{ display: 'inline-block', maxWidth: 160, height: 'auto' }}
          />
          <div className="mx-auto mt-3" style={{ width: 48, height: 2, backgroundColor: PORTAL.gold }} />
          <div
            className="mt-3 text-[10px] uppercase font-semibold"
            style={{ color: PORTAL.gold, letterSpacing: '2.5px' }}
          >
            After-hours access
          </div>
          <h1
            className="mt-1 text-white text-[24px] font-light italic leading-tight"
            style={{ fontFamily: PORTAL_SERIF }}
          >
            Picking up or dropping off.
          </h1>
          {subtitle && <div className="mt-1 text-[13px] text-white/60">{subtitle}</div>}
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-5 py-6 space-y-5">{children}</main>

      <footer className="mt-6 border-t border-gray-200" style={{ backgroundColor: '#fafaf8' }}>
        <div className="max-w-2xl mx-auto px-6 py-6 text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/s-logo-black.png"
            alt="SirReel"
            width={30}
            style={{ display: 'inline-block', width: 30, height: 'auto', opacity: 0.55 }}
          />
          <p className="mt-2 text-[10px] tracking-wide leading-relaxed" style={{ color: '#888' }}>
            SirReel Studio Services
            <br />
            8500 Lankershim Blvd, Sun Valley, CA 91352
          </p>
          <p className="mt-2 text-[11px]" style={{ color: PORTAL.gold }}>
            After-hours:{' '}
            <a href="tel:+18884777335" style={{ color: PORTAL.gold }}>
              (888) 477-7335
            </a>
          </p>
        </div>
      </footer>
    </div>
  );
}

/** The error state. Always ends in a phone number, never in an apology. */
export function AfterHoursProblem({ message }: { message: string }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <p className="text-[15px] text-gray-900 leading-relaxed">{message}</p>
      <a
        href="tel:+18884777335"
        className="mt-4 inline-block px-5 py-3 rounded-lg text-[15px] font-semibold text-white"
        style={{ backgroundColor: PORTAL.dark }}
      >
        Call (888) 477-7335
      </a>
      <p className="mt-3 text-[12px] text-gray-500">
        The line is answered around the clock — give them the production name and they can verify
        you and get you in.
      </p>
    </div>
  );
}

export function AfterHoursBody({ data }: { data: AfterHoursViewData }) {
  return (
    <>
      {/* Where. First, because this is read in the car. */}
      <a
        href={data.location.mapsUrl}
        target="_blank"
        rel="noreferrer"
        className="block bg-white rounded-xl border border-gray-200 p-5 hover:border-gray-400 transition-colors"
      >
        <div className="text-[10px] font-semibold uppercase tracking-widest text-gray-500">
          Where to go
        </div>
        <div className="mt-1.5 text-[17px] font-semibold text-gray-900 leading-snug">
          {data.location.street}
        </div>
        <div className="text-[15px] text-gray-700">{data.location.cityStateZip}</div>
        <div className="mt-2 text-[15px] font-semibold" style={{ color: '#8a6a1f' }}>
          Enter through {data.location.gateName}
        </div>
        <div className="mt-2 text-[13px] text-gray-500">Tap for directions →</div>
      </a>

      {/* The codes. The reason the page exists. */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <CodeCard label="Gate code" code={data.gateCode} hint="Enter it on the keypad, then hold #" />
        <CodeCard
          label="Storage container"
          code={data.containerCode}
          hint="Container is immediately left of Gate 1"
        />
      </div>

      {/* What the production told this specific person. Above the agent's
          standing line, because it is the newer and more specific fact. */}
      {data.message && (
        <NoteBlock label="From the production" text={data.message} />
      )}
      {data.note && <NoteBlock label="For this job" text={data.note} />}

      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <div className="text-[10px] font-semibold uppercase tracking-widest text-gray-500">
          On arrival
        </div>
        <ol className="mt-3 space-y-2.5">
          {data.steps.map((s, i) => (
            <li key={i} className="flex gap-3 text-[15px] text-gray-800 leading-relaxed">
              <span
                className="flex-none w-5 h-5 rounded-full text-[11px] font-bold flex items-center justify-center mt-0.5"
                style={{ backgroundColor: PORTAL.dark, color: PORTAL.gold }}
              >
                {i + 1}
              </span>
              <span>
                {s.text}
                {s.kind === 'code' && s.code && (
                  <span className="ml-1.5 font-mono font-bold text-gray-900">{s.code}</span>
                )}
              </span>
            </li>
          ))}
        </ol>
      </div>

      {/* Two errands, two different ways to get it wrong. */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="text-[13px] font-bold text-gray-900">If you&rsquo;re dropping off</div>
          <p className="mt-1.5 text-[14px] text-gray-700 leading-relaxed">{data.rules.droppingOff}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="text-[13px] font-bold text-gray-900">If you&rsquo;re picking up</div>
          <p className="mt-1.5 text-[14px] text-gray-700 leading-relaxed">{data.rules.pickingUp}</p>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <div className="text-[10px] font-semibold uppercase tracking-widest text-gray-500">
          Yard hours
        </div>
        <div className="mt-1.5 text-[15px] text-gray-800 leading-relaxed">
          {data.schedule.weekdays}
          <br />
          {data.schedule.saturday}
          <br />
          <span className="text-gray-500">{data.schedule.sunday}</span>
        </div>
        <p className="mt-2 text-[13px] text-gray-500">
          Outside these hours the yard is unstaffed — the codes above are how you get in and out.
        </p>
      </div>

      {/* When the page has failed you. */}
      <div className="rounded-xl p-5" style={{ backgroundColor: PORTAL.dark }}>
        <div
          className="text-[10px] font-semibold uppercase tracking-widest"
          style={{ color: PORTAL.gold }}
        >
          If anything is wrong
        </div>
        <p className="mt-1.5 text-[14px] text-white/80 leading-relaxed">
          A code that doesn&rsquo;t work, a container that won&rsquo;t open, gear that isn&rsquo;t
          there — call us. The line is answered 24 hours.
        </p>
        <a
          href={data.support.phoneHref}
          className="mt-3 inline-block px-5 py-3 rounded-lg text-[15px] font-bold"
          style={{ backgroundColor: PORTAL.gold, color: PORTAL.dark }}
        >
          Call {data.support.phone}
        </a>
        {data.agent?.name && (
          <p className="mt-3 text-[13px] text-white/60">
            Your rep is {data.agent.name}
            {data.agent.email ? (
              <>
                {' · '}
                <a href={`mailto:${data.agent.email}`} style={{ color: PORTAL.gold }}>
                  {data.agent.email}
                </a>
              </>
            ) : null}
            {data.agent.phone ? ` · ${data.agent.phone}` : ''}
          </p>
        )}
      </div>
    </>
  );
}

function NoteBlock({ label, text }: { label: string; text: string }) {
  return (
    <div className="rounded-xl p-5" style={{ backgroundColor: '#FDF8EC', border: '1px solid #E8D7A8' }}>
      <div
        className="text-[10px] font-semibold uppercase tracking-widest"
        style={{ color: '#8a6a1f' }}
      >
        {label}
      </div>
      <p className="mt-1.5 text-[15px] text-gray-900 leading-relaxed whitespace-pre-wrap">{text}</p>
    </div>
  );
}

/**
 * One code, sized to be read at arm's length. A missing code says so in
 * words and points at the phone — an em-dash where a number belongs reads
 * as "there is no code on this gate", which sends a driver to a keypad
 * expecting it to be open.
 */
function CodeCard({ label, code, hint }: { label: string; code: string | null; hint: string }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <div className="text-[10px] font-semibold uppercase tracking-widest text-gray-500">{label}</div>
      {code ? (
        <>
          <div
            className="mt-1 font-mono font-bold text-gray-900 leading-none"
            style={{ fontSize: 40, letterSpacing: '0.05em' }}
          >
            {code}
          </div>
          <div className="mt-2 text-[13px] text-gray-500">{hint}</div>
        </>
      ) : (
        <>
          <div className="mt-2 text-[15px] font-semibold text-gray-900">Call for this one</div>
          <div className="mt-1 text-[13px] text-gray-500">
            We don&rsquo;t have it recorded here — the 24-hour line does.
          </div>
        </>
      )}
    </div>
  );
}
