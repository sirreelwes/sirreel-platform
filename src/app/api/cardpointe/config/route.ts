import { NextRequest, NextResponse } from 'next/server';

/**
 * GET /api/cardpointe/config
 *
 * Returns the CardSecure tokenizer iframe URL. Two variants:
 *   default          → card tokenizer (16-digit PAN)
 *   ?mode=echeck     → ACH (eCheck) tokenizer — accepts a bank
 *                      account number; routing number captured
 *                      separately on the form server-side
 *
 * Phase 6 commit 3 — adds the eCheck variant. UAT-only for now;
 * production cutover comes after ACH underwriting completes.
 *
 * The CardConnect iframe takes `useexpiry` / `usecvv` flags to
 * suppress card-only fields for ACH. ACH also takes `usemonthnames`
 * etc. — for the basic tokenizer we just drop the expiry/CVV inputs.
 */
export async function GET(req: NextRequest) {
  // Phase 6 commit 1 client honors CARDPOINTE_ENV, but the iframe URL
  // base still reads from the legacy UAT env var — same hostname
  // serves both prod and UAT tokenizers per CardConnect docs (the
  // distinction is which gateway you POST to, not which iframe loads).
  // When prod env lands we'll switch this to read the env-appropriate
  // *_URL alongside the REST client.
  const base = process.env.CARDPOINTE_UAT_URL;
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
