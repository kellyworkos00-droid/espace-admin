import 'server-only';

import { normaliseMsisdn } from '@/lib/infobip';

/**
 * Plain SMS, for campaigns.
 *
 * Separate from infobip.ts's 2FA calls on purpose. Those go through Infobip's
 * 2FA application, which manages PIN state and rate limits per number; a
 * marketing message has none of that and would be charged and throttled under
 * rules meant for one-time codes.
 *
 * Server only, and it stays that way. This key spends money on every call.
 */

const BASE = (process.env.INFOBIP_BASE_URL ?? '').replace(/\/+$/, '');
const KEY = process.env.INFOBIP_API_KEY ?? '';
/** What the message appears to come from. Alphanumeric senders need registering with the operator. */
const SENDER = process.env.INFOBIP_SMS_SENDER ?? 'ESpace';

export function smsConfigured() {
  return Boolean(BASE && KEY);
}

export { normaliseMsisdn };

// ---------------------------------------------------------------------------
// What a message costs
// ---------------------------------------------------------------------------

/**
 * GSM-7 is the cheap alphabet. Anything outside it forces the whole message
 * into UCS-2, which more than halves what fits -- and it is usually one
 * character doing it: a curly quote pasted from a document, or an en dash.
 * Worth knowing before sending rather than after being billed.
 */
const GSM7 =
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?" +
  '¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà';
/** These take two GSM-7 characters each, not one. */
const GSM7_EXTENDED = '^{}\\[~]|€';

export type SmsCost = {
  characters: number;
  encoding: 'GSM-7' | 'UCS-2';
  segments: number;
  /** The characters that forced UCS-2, if any. Shown so they can be replaced. */
  offenders: string[];
};

export function measureSms(text: string): SmsCost {
  const offenders = Array.from(
    new Set(
      Array.from(text).filter((ch) => !GSM7.includes(ch) && !GSM7_EXTENDED.includes(ch))
    )
  );

  if (offenders.length > 0) {
    const characters = Array.from(text).length;
    return {
      characters,
      encoding: 'UCS-2',
      segments: characters === 0 ? 0 : Math.ceil(characters / (characters <= 70 ? 70 : 67)),
      offenders,
    };
  }

  const characters = Array.from(text).reduce(
    (total, ch) => total + (GSM7_EXTENDED.includes(ch) ? 2 : 1),
    0
  );

  return {
    characters,
    encoding: 'GSM-7',
    segments: characters === 0 ? 0 : Math.ceil(characters / (characters <= 160 ? 160 : 153)),
    offenders: [],
  };
}

// ---------------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------------

export type SmsSendResult =
  | { ok: true; messageId: string | null }
  | { ok: false; error: string };

export async function sendSms(msisdn: string, text: string): Promise<SmsSendResult> {
  if (!smsConfigured()) {
    return { ok: false, error: 'SMS is not configured: set INFOBIP_BASE_URL and INFOBIP_API_KEY.' };
  }

  const to = normaliseMsisdn(msisdn);
  if (!to) {
    // Never guessed at. A malformed number is a charge with no chance of
    // arriving, and the person is left thinking they were not written to.
    return { ok: false, error: `Not a usable Kenyan number: ${msisdn}` };
  }

  try {
    const response = await fetch(`${BASE}/sms/2/text/advanced`, {
      method: 'POST',
      headers: {
        Authorization: `App ${KEY}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        messages: [{ from: SENDER, destinations: [{ to }], text }],
      }),
    });

    const data = (await response.json()) as {
      messages?: { messageId?: string; status?: { name?: string; description?: string } }[];
      requestError?: { serviceException?: { text?: string } };
    };

    if (!response.ok) {
      const detail =
        data.requestError?.serviceException?.text ?? `Infobip returned ${response.status}`;
      console.error('sendSms failed', response.status, JSON.stringify(data).slice(0, 300));
      return { ok: false, error: detail };
    }

    const first = data.messages?.[0];
    const state = first?.status?.name ?? '';

    // Infobip answers 200 for a message it then rejects, so the status has to be
    // read rather than the HTTP code trusted.
    if (state && !/^(PENDING|MESSAGE_ACCEPTED|DELIVERED)/.test(state)) {
      return { ok: false, error: first?.status?.description ?? state };
    }

    return { ok: true, messageId: first?.messageId ?? null };
  } catch (error) {
    console.error('sendSms threw', error);
    return { ok: false, error: 'Could not reach the SMS service.' };
  }
}

/**
 * The line that has to be on every marketing message.
 *
 * Not optional and not a nicety: consent has to be as easy to withdraw as it
 * was to give, and a message with no way out is the thing that gets a sender id
 * blocked by the operator. Appended by the sender rather than left to whoever
 * writes the copy, because it is the one part that must not be forgotten.
 */
export const OPT_OUT_LINE = 'Reply STOP to opt out.';

export function withOptOut(body: string) {
  const trimmed = body.trim();
  return trimmed.endsWith(OPT_OUT_LINE) ? trimmed : `${trimmed}\n${OPT_OUT_LINE}`;
}
