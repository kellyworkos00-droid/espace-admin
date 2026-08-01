import { NextResponse } from 'next/server';

import { verifyPin } from '@/lib/infobip';

/**
 * Checks a code against the pin id issued by /api/phone/send.
 *
 * A wrong code returns 200 with verified:false rather than an error status:
 * mistyping is an expected part of a normal flow, not a failure, and the app
 * needs the remaining attempt count to tell someone how much room they have
 * left before the code is locked.
 */
export async function POST(request: Request) {
  let pinId = '';
  let pin = '';

  try {
    const body = (await request.json()) as { pinId?: string; pin?: string };
    pinId = String(body.pinId ?? '');
    pin = String(body.pin ?? '').replace(/[^0-9]/g, '');
  } catch {
    return NextResponse.json({ ok: false, message: 'Invalid request.' }, { status: 400 });
  }

  if (!pinId || pin.length < 4) {
    return NextResponse.json({ ok: false, message: 'Enter the code from the SMS.' }, { status: 400 });
  }

  const result = await verifyPin(pinId, pin);

  if (!result.ok) {
    return NextResponse.json({ ok: false, message: result.message }, { status: 502 });
  }

  return NextResponse.json(result);
}
