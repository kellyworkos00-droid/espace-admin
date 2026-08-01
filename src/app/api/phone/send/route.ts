import { NextResponse } from 'next/server';

import { normaliseMsisdn, sendPin } from '@/lib/infobip';

/**
 * Starts phone verification.
 *
 * Public on purpose -- the app calls this before anyone has an account -- so it
 * is deliberately narrow: it accepts a phone number, nothing else, and returns
 * only an opaque pin id. The Infobip key never leaves the server, because a key
 * shipped inside an APK can be extracted and used to send SMS at your expense.
 *
 * Abuse is bounded by Infobip's own per-number limit (3 a day) and per
 * application limit (100 a day), set when the application was created.
 */
export async function POST(request: Request) {
  let phone = '';

  try {
    const body = (await request.json()) as { phone?: string };
    phone = String(body.phone ?? '');
  } catch {
    return NextResponse.json({ ok: false, message: 'Invalid request.' }, { status: 400 });
  }

  const msisdn = normaliseMsisdn(phone);
  if (!msisdn) {
    return NextResponse.json(
      { ok: false, message: 'Enter a valid Safaricom number, like 07XX XXX XXX.' },
      { status: 400 }
    );
  }

  const result = await sendPin(msisdn);

  if (!result.ok) {
    return NextResponse.json({ ok: false, message: result.message }, { status: 502 });
  }

  return NextResponse.json({ ok: true, pinId: result.pinId, to: msisdn });
}
