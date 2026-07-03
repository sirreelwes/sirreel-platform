import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { PARSING_MODEL } from "@/lib/ai/models";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Text extraction of a multi-page PDF can run long — give the function
// headroom beyond the plan default.
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    if (!file) return NextResponse.json({ error: "No file" }, { status: 400 });

    const buffer = await file.arrayBuffer();
    const base64 = Buffer.from(buffer).toString("base64");

    const response = await anthropic.messages.create({
      model: PARSING_MODEL,
      // 4096 truncated multi-page docs mid-extraction (silently dropping
      // line items). 8192 covers every real quote doc seen so far; if we
      // still hit the cap we fail loudly below instead of returning a
      // partial item list.
      max_tokens: 8192,
      messages: [{
        role: "user",
        content: [
          {
            type: "document",
            source: { type: "base64", media_type: "application/pdf", data: base64 },
          },
          {
            type: "text",
            text: "Extract all text from this document. Return only the raw text content, no commentary.",
          },
        ],
      }],
    });

    const text = response.content[0].type === "text" ? response.content[0].text : "";
    if (response.stop_reason === "max_tokens") {
      // Truncated extraction would silently drop line items — refuse it.
      console.error(`[parse-pdf] extraction truncated at max_tokens (${text.length} chars extracted)`);
      return NextResponse.json(
        { error: "This PDF is too long to read automatically — paste the relevant email text instead, or enter items manually." },
        { status: 422 }
      );
    }
    return NextResponse.json({ text });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
