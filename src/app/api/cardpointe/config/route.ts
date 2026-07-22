import { NextRequest, NextResponse } from 'next/server';
import { cardpointeBaseUrl } from '@/lib/cardpointe/client';

/**
 * GET /api/cardpointe/config
 *
 * Returns the CardSecure tokenizer iframe URL. Two variants:
 *   default          → card tokenizer (16-digit PAN)
 *   ?mode=echeck     → ACH (eCheck) tokenizer — accepts a bank
 *                      account number; routing number captured
 *                      separately on the form server-side
 *
 * The tokenizer host follows CARDPOINTE_ENV via cardpointeBaseUrl() —
 * the SAME env-appropriate host used by the REST gateway client — so
 * the token is minted on the same environment it will be charged
 * against. (In UAT and PROD alike, one host serves both the /itoke/
 * iframe and the /cardconnect/rest gateway.)
 *
 * The CardConnect iframe takes `useexpiry` / `usecvv` flags to
 * suppress card-only fields for ACH. ACH also takes `usemonthnames`
 * etc. — for the basic tokenizer we just drop the expiry/CVV inputs.
 */
export async function GET(req: NextRequest) {
  const base = cardpointeBaseUrl();
  if (!base) return NextResponse.json({ error: 'CardPointe not configured' }, { status: 500 });

  const mode = req.nextUrl.searchParams.get('mode') === 'echeck' ? 'echeck' : 'card';
  const css = 'body%7Bmargin%3A0%3Bfont-family%3Asans-serif%7Dinput%7Bwidth%3A100%25%3Bbox-sizing%3Aborder-box%3Bborder%3A1px+solid+%23e5e7eb%3Bborder-radius%3A8px%3Bpadding%3A10px+12px%3Bfont-size%3A14px%3Boutline%3Anone%7Dinput%3Afocus%7Bborder-color%3A%23111827%7D';

  // Shared params: format input, fire event on validation issues,
  // tokenize when the field is left inactive for 500ms.
  const common = `formatinput=true&invalidinputevent=true&tokenizewheninactive=true&inactivityto=500&css=${css}`;

  let iframeUrl: string;
  if (mode === 'echeck') {
    // eCheck tokenizer: switch the tokenize target to ACH, suppress
    // expiry/CVV (card-only fields). The CardConnect iframe param
    // `usemonthnames=false&useexpiry=false&usecvv=false` keeps the
    // surface as a single bank-account field; routing # is captured
    // on our form and posted alongside the token.
    iframeUrl = `${base}/itoke/ajax-tokenizer.html?tokenizetype=echeck&useexpiry=false&usecvv=false&${common}`;
  } else {
    iframeUrl = `${base}/itoke/ajax-tokenizer.html?${common}`;
  }

  return NextResponse.json({ iframeUrl, mode });
}
