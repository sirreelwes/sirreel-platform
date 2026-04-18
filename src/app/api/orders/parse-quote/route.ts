import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/prisma";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const PARSE_PROMPT = `You are a rental quote parser for SirReel Production Vehicles, a film/TV production rental company in Los Angeles.

Extract structured data from the following quote request (email, spec sheet, or order form).

Return ONLY valid JSON with this exact shape. Omit fields you cannot determine:

{
  "clientName": "Company name or person's company if clear",
  "contactName": "Person requesting",
  "contactEmail": "email address",
  "contactPhone": "phone if given",
  "productionName": "Show/production name if mentioned (e.g. 'Stranger Things S5')",
  "startDate": "YYYY-MM-DD",
  "endDate": "YYYY-MM-DD",
  "pickupLocation": "Where they want to pick up",
  "dropoffLocation": "Where returning if different",
  "rateType": "DAILY or WEEKLY",
  "notes": "Any special requirements or notes",
  "items": [
    {
      "description": "What they want - e.g. 'Cube truck', '5-ton grip truck', 'Passenger van'",
      "quantity": 1,
      "type": "VEHICLE | EQUIPMENT | EXPENDABLE | LABOR",
      "specs": "Any specific details like size, brand, etc."
    }
  ]
}

Rules:
- If dates are given as a duration (e.g. "for a week"), calculate endDate from startDate
- Default rateType to WEEKLY if duration is 4+ days, otherwise DAILY
- For film production vehicle requests, common types include: Cube truck, Cargo van, Sprinter van, Passenger van, 5-ton grip truck, 10-ton grip truck, Star wagon, Honey wagon, Wardrobe trailer, Makeup trailer, Production RV
- Return ONLY the JSON object, no markdown, no preamble

Input:
---
{INPUT}
---`;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { text } = body;

    if (!text) {
      return NextResponse.json({ error: "text required" }, { status: 400 });
    }

    if (!process.env.ANTHROPIC_API_KEY) {
      return NextResponse.json({ error: "AI service not configured" }, { status: 500 });
    }

    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-5-20250929",
      max_tokens: 2048,
      messages: [{
        role: "user",
        content: PARSE_PROMPT.replace("{INPUT}", text.slice(0, 15000)),
      }],
    });

    const aiText = response.content[0].type === "text" ? response.content[0].text : "";
    let parsed;
    try {
      // Strip any markdown fences
      const cleaned = aiText.replace(/```json\s*|```\s*/g, "").trim();
      parsed = JSON.parse(cleaned);
    } catch {
      return NextResponse.json({ error: "AI response was not valid JSON", raw: aiText }, { status: 500 });
    }

    // Match items against inventory
    const itemsWithMatches = await Promise.all(
      (parsed.items || []).map(async (item: { description: string; quantity: number; type: string; specs?: string }) => {
        const searchTerm = item.description || "";
        const inventoryMatches = await prisma.inventoryItem.findMany({
          where: {
            isActive: true,
            OR: [
              { description: { contains: searchTerm, mode: "insensitive" } },
              { code: { contains: searchTerm, mode: "insensitive" } },
            ],
          },
          include: { category: { select: { name: true } } },
          take: 3,
        });

        // Also match vehicles (Assets) — match on unitName, make, or model
        const assetMatches = await prisma.asset.findMany({
          where: {
            OR: [
              { unitName: { contains: searchTerm, mode: "insensitive" } },
              { make: { contains: searchTerm, mode: "insensitive" } },
              { model: { contains: searchTerm, mode: "insensitive" } },
              { category: { is: { name: { contains: searchTerm, mode: "insensitive" } } } },
            ],
          },
          include: { category: { select: { name: true, dailyRate: true, weeklyRate: true } } },
          take: 3,
        });

        return {
          ...item,
          matches: {
            inventory: inventoryMatches.map(m => ({
              id: m.id,
              code: m.code,
              description: m.description || m.code,
              dailyRate: m.dailyRate,
              weeklyRate: m.weeklyRate,
              category: m.category.name,
              type: "INVENTORY",
            })),
            assets: assetMatches.map(a => ({
              id: a.id,
              code: a.unitName,
              description: [a.year, a.make, a.model, a.unitName].filter(Boolean).join(" ") || a.unitName,
              dailyRate: a.category.dailyRate,
              weeklyRate: a.category.weeklyRate,
              category: a.category.name,
              type: "ASSET",
            })),
          },
        };
      })
    );

    // Try to match client to existing company — fuzzy match with stripped suffixes
    let clientMatch = null;
    if (parsed.clientName) {
      // Strip common suffixes for matching
      const stripSuffixes = (s: string) => s.toLowerCase()
        .replace(/[,.]/g, " ")
        .replace(/\b(llc|inc|llp|ltd|corp|co|corporation|company|productions?|films?|studios?|media|entertainment|group|pictures)\b/g, "")
        .replace(/\s+/g, " ")
        .trim();

      const searchTerm = stripSuffixes(parsed.clientName);
      const words = searchTerm.split(" ").filter(w => w.length >= 3);

      // Try full match first
      let companies = await prisma.company.findMany({
        where: { name: { contains: parsed.clientName, mode: "insensitive" } },
        select: { id: true, name: true, tier: true, coiOnFile: true, defaultAgentId: true },
        take: 10,
      });

      // If no match, try with stripped version
      if (companies.length === 0 && searchTerm) {
        companies = await prisma.company.findMany({
          where: { name: { contains: searchTerm, mode: "insensitive" } },
          select: { id: true, name: true, tier: true, coiOnFile: true, defaultAgentId: true },
          take: 10,
        });
      }

      // Still no match? Try matching by the first significant word
      if (companies.length === 0 && words.length > 0) {
        companies = await prisma.company.findMany({
          where: { name: { contains: words[0], mode: "insensitive" } },
          select: { id: true, name: true, tier: true, coiOnFile: true, defaultAgentId: true },
          take: 10,
        });
      }

      clientMatch = companies;
    }

    return NextResponse.json({
      parsed,
      itemsWithMatches,
      clientMatch,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
