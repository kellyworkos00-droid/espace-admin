import 'server-only';

/**
 * Infobip 2FA, server side only.
 *
 * The API key can send SMS at real cost, so it lives in the server environment
 * and nothing here is ever imported by the mobile app. The app talks to the two
 * routes under /api/phone instead, which is the whole reason they exist.
 */

const BASE = (process.env.INFOBIP_BASE_URL ?? '').replace(/\/+$/, '');
const KEY = process.env.INFOBIP_API_KEY ?? '';
const APPLICATION_ID = process.env.INFOBIP_2FA_APPLICATION_ID ?? '';
const MESSAGE_ID = process.env.INFOBIP_2FA_MESSAGE_ID ?? '';

export function infobipConfigured() {
  return Boolean(BASE && KEY && APPLICATION_ID && MESSAGE_ID);
}

/**
 * Normalises a Kenyan mobile number to 2547XXXXXXXX.
 *
 * Returns null rather than guessing: sending a PIN to a mistyped number is a
 * charge with no possible benefit, and the user is left waiting for a code that
 * went somewhere else.
 */
export function normaliseMsisdn(input: string): string | null {
  const digits = input.replace(/[^0-9]/g, '');

  if (/^254(7|1)\d{8}$/.test(digits)) return digits;
  if (/^0(7|1)\d{8}$/.test(digits)) return `254${digits.slice(1)}`;
  if (/^(7|1)\d{8}$/.test(digits)) return `254${digits}`;

  return null;
}

type SendResult = { ok: true; pinId: string } | { ok: false; message: string };

export async function sendPin(msisdn: string): Promise<SendResult> {
  if (!infobipConfigured()) {
    return { ok: false, message: 'Phone verification is not configured on the server.' };
  }

  try {
    const response = await fetch(`${BASE}/2fa/2/pin?ncNeeded=false`, {
      method: 'POST',
      headers: {
        Authorization: `App ${KEY}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        applicationId: APPLICATION_ID,
        messageId: MESSAGE_ID,
        from: 'ServiceSMS',
        to: msisdn,
      }),
    });

    const data = (await response.json()) as { pinId?: string; requestError?: unknown };

    if (!response.ok || !data.pinId) {
      // Infobip's own text can name the account or the number; keep it out of
      // the client and let the server log carry the detail.
      console.error('Infobip sendPin failed', response.status, JSON.stringify(data).slice(0, 400));
      return {
        ok: false,
        message:
          response.status === 429
            ? 'Too many codes requested for this number. Try again later.'
            : 'We could not send the code. Check the number and try again.',
      };
    }

    return { ok: true, pinId: data.pinId };
  } catch (error) {
    console.error('Infobip sendPin threw', error);
    return { ok: false, message: 'We could not reach the SMS service. Try again shortly.' };
  }
}

type VerifyResult =
  | { ok: true; verified: true }
  | { ok: true; verified: false; message: string; attemptsLeft: number | null }
  | { ok: false; message: string };

export async function verifyPin(pinId: string, pin: string): Promise<VerifyResult> {
  if (!infobipConfigured()) {
    return { ok: false, message: 'Phone verification is not configured on the server.' };
  }

  try {
    const response = await fetch(`${BASE}/2fa/2/pin/${encodeURIComponent(pinId)}/verify`, {
      method: 'POST',
      headers: {
        Authorization: `App ${KEY}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ pin }),
    });

    const data = (await response.json()) as {
      verified?: boolean;
      attemptsRemaining?: number;
      pinError?: string;
    };

    if (!response.ok) {
      console.error('Infobip verifyPin failed', response.status, JSON.stringify(data).slice(0, 400));
      return { ok: false, message: 'We could not check that code. Try again.' };
    }

    if (data.verified) return { ok: true, verified: true };

    const left = typeof data.attemptsRemaining === 'number' ? data.attemptsRemaining : null;
    return {
      ok: true,
      verified: false,
      attemptsLeft: left,
      message:
        left === 0
          ? 'Too many wrong codes. Request a new one.'
          : 'That code is not right. Check it and try again.',
    };
  } catch (error) {
    console.error('Infobip verifyPin threw', error);
    return { ok: false, message: 'We could not reach the SMS service. Try again shortly.' };
  }
}
