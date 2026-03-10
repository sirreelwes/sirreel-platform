import { NextRequest, NextResponse } from 'next/server';

// TODO: Wire up to real Prisma data + Claude API via lib/ai.ts
// For now, this provides a local fallback that answers from mock data

const FLEET_SUMMARY = `Cube Truck: 31/41 available, 6 booked, 4 maint
Cargo Van w/ LG: 22/30 available, 5 booked, 3 maint
Passenger Van: 7/10 available, 3 booked, 1 maint
PopVan: 5/9 available, 2 booked, 2 maint
Camera Cube: 5/7 available, 2 booked
DLUX: 2/4 available, 2 booked
ProScout/VTR: 2/3 available, 1 booked
Studios: 8/10 available, 2 booked
Other: 19 available`;

const MAINT_LIST = `🔧 Cube #24(A): Bad motor — long-term @ High Tech
🔧 Cube #8: Transmission @ High Tech
🔧 Cube #15: Oil/Reverse sticky
🔧 Sprinter #2: Engine inspect
🔧 SC #38: Check engine light
🔧 Nissan #1: Motor mounts @ Dealership
🔧 Pop #3: Transmission — long-term
🔧 Pop #1: Interior lights
🔧 Cube #9: Battery issue`;

const BOOKINGS_LIST = `Cinepower & Light — 6× Cube — Active — Jose
Justin K Productions — 4× Cube — Confirmed — Oliver
Nathan Israel Prod — 5× Cargo — Active — Jose
Elli Legerski — 2× PopVan — Active — Jose
Snow Story — 2× DLUX — Confirmed — Jose
Nathalie SP Film — 3× Pass Van — Confirmed — Oliver
Maddie Harmon — 2× Camera Cube — Active — Dani
Fabletics — 2× Studio — Confirmed — Jose
Alyssa Benedetto — 3× Cube — Pending — Jose
Beth Schiffman — 2× Cube — Pending — Jose`;

export async function POST(req: NextRequest) {
  try {
    const { message, role } = await req.json();
    const q = message.toLowerCase();

    // Try Claude API first
    if (process.env.ANTHROPIC_API_KEY) {
      try {
        const res = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': process.env.ANTHROPIC_API_KEY,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model: 'claude-sonnet-4-20250514',
            max_tokens: 500,
            system: `You are SirReel's AI fleet assistant. Be concise. Today is ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}.\n\nFLEET:\n${FLEET_SUMMARY}\n\nBOOKINGS:\n${BOOKINGS_LIST}\n\nMAINTENANCE:\n${MAINT_LIST}`,
            messages: [{ role: 'user', content: message }],
          }),
        });

        if (res.ok) {
          const data = await res.json();
          const text = data.content?.[0]?.text || '';
          if (text) {
            return NextResponse.json({ reply: text });
          }
        }
      } catch {
        // Fall through to local
      }
    }

    // Local fallback
    let reply = "I can help with fleet availability, bookings, and maintenance. What do you need?";

    if (q.includes('avail') || q.includes('fleet') || q.includes('summary')) {
      reply = FLEET_SUMMARY;
    } else if (q.includes('maint') || q.includes('repair') || q.includes('down')) {
      reply = MAINT_LIST;
    } else if (q.includes('pending')) {
      reply = "2 pending bookings:\n⏳ Alyssa Benedetto — 3× Cube — Photo Shoot — Jose\n⏳ Beth Schiffman — 2× Cube — TV Pilot — Jose";
    } else if (q.includes('booking') || q.includes('active') || q.includes('rental')) {
      reply = BOOKINGS_LIST;
    } else if (q.includes('cube')) {
      reply = "Cube Trucks: 31 of 41 available. 6 booked (Cinepower & Light), 4 in maintenance (Cube #8, #9, #15, #24). 3 more pending for later this week.";
    } else if (q.includes('cargo') || q.includes('van')) {
      reply = "Cargo Vans w/ Liftgate: 22 of 30 available. 5 booked (Nathan Israel), 3 in maintenance (Sprinter #2, SC #38, SC #36).";
    } else if (q.includes('studio')) {
      reply = "Studios: 8 of 10 available. Fabletics has 2 booked for Spring Campaign (Jose). $3,000/day rate.";
    } else if (q.includes('jose') || q.includes('oliver') || q.includes('agent')) {
      reply = "Jose: 13 client accounts, 8 active/confirmed bookings, 2 pending.\nOliver: 3 client accounts, 2 confirmed bookings.\nDani: 2 client accounts, 1 active booking.";
    }

    return NextResponse.json({ reply });
  } catch (error) {
    return NextResponse.json(
      { reply: "Something went wrong. Try again." },
      { status: 500 }
    );
  }
}
