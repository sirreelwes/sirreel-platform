import { NextResponse } from 'next/server';

export async function GET() {
  const base = process.env.CARDPOINTE_UAT_URL;
  if (!base) return NextResponse.json({ error: 'CardPointe not configured' }, { status: 500 });

  const iframeUrl = `${base}/itoke/ajax-tokenizer.html?formatinput=true&invalidinputevent=true&tokenizewheninactive=true&inactivityto=500&css=body%7Bmargin%3A0%3Bfont-family%3Asans-serif%7Dinput%7Bwidth%3A100%25%3Bbox-sizing%3Aborder-box%3Bborder%3A1px+solid+%23e5e7eb%3Bborder-radius%3A8px%3Bpadding%3A10px+12px%3Bfont-size%3A14px%3Boutline%3Anone%7Dinput%3Afocus%7Bborder-color%3A%23111827%7D`;

  return NextResponse.json({ iframeUrl });
}
