import { revalidatePath } from 'next/cache';

import { DataTable } from '@/components/data-table';
import { Shell } from '@/components/shell';
import { Badge, Metric, Notice, PageHead,
  ServiceRoleRequired, ago, when } from '@/components/ui';
import { requireAdmin } from '@/lib/auth';
import { measureSms, sendSms, smsConfigured, withOptOut } from '@/lib/sms';
import { hasServiceRole, sb } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

type ProfileRow = {
  id: string;
  full_name: string | null;
  phone: string | null;
  phone_verified: boolean | null;
  role: string | null;
  marketing_sms_consent: boolean | null;
  marketing_opted_out_at: string | null;
};

type CampaignRow = {
  id: string;
  name: string;
  body: string;
  audience: string;
  recipients: number;
  delivered: number;
  failed: number;
  status: string;
  created_at: string;
  sent_at: string | null;
};

const AUDIENCES: Record<string, { label: string; match: (p: ProfileRow) => boolean }> = {
  consented: { label: 'Everyone who opted in', match: () => true },
  consented_hosts: { label: 'Hosts who opted in', match: (p) => p.role === 'lister' },
  consented_renters: { label: 'Renters who opted in', match: (p) => p.role !== 'lister' },
};

/**
 * Sending SMS to people who asked for it.
 *
 * The audience is not everyone with a number on file. Kenya's Data Protection
 * Act treats direct marketing as a purpose of its own: a phone number given so
 * a host could confirm a viewing was not given for offers, and consent to one
 * is not consent to the other. So every audience here is drawn from
 * marketing_sms_consent, and there is deliberately no way to reach anybody else
 * from this screen -- an "everyone" button is the only feature that would make
 * this page dangerous.
 *
 * Every message carries an opt-out line, appended by the sender rather than
 * left to whoever writes the copy. Consent has to be as easy to withdraw as it
 * was to give, and a message with no way out is what gets a sender id blocked.
 *
 * And withdrawing it works: marketing_opted_out_at excludes somebody from every
 * audience here regardless of what their consent flag still says. Consent is
 * only the first of the two questions -- the second is whether they have since
 * changed their mind, and asking only the first is how a service keeps
 * messaging the person who asked it to stop.
 */
export default async function MarketingPage() {
  await requireAdmin();

  const [profiles, campaigns] = await Promise.all([
    sb<ProfileRow>('profiles', {
      query:
        'select=id,full_name,phone,phone_verified,role,marketing_sms_consent,marketing_opted_out_at',
    }),
    sb<CampaignRow>('sms_campaigns', { query: 'select=*&order=created_at.desc&limit=50' }),
  ]);

  const all = profiles.rows ?? [];
  const consented = all.filter((p) => p.marketing_sms_consent && p.phone && !p.marketing_opted_out_at);
  const optedOut = all.filter((p) => p.marketing_opted_out_at);
  const withNumber = all.filter((p) => p.phone);

  async function send(formData: FormData) {
    'use server';

    const name = String(formData.get('name') ?? '').trim();
    const rawBody = String(formData.get('body') ?? '').trim();
    const audience = String(formData.get('audience') ?? 'consented');
    const confirm = String(formData.get('confirm') ?? '');

    if (!name || !rawBody) return;
    // Typed out in full, because the cost of this button is other people's
    // attention and it cannot be taken back once it has gone.
    if (confirm !== 'SEND') return;

    const body = withOptOut(rawBody);

    const audiences = await sb<ProfileRow>('profiles', {
      // The opt-out filter belongs in the query rather than in the loop below.
      // A filter applied after the rows arrive is one somebody can later move,
      // reorder or short-circuit; this one cannot be got past.
      query:
        'select=id,full_name,phone,phone_verified,role,marketing_sms_consent,marketing_opted_out_at' +
        '&marketing_sms_consent=eq.true&phone=not.is.null' +
        '&marketing_opted_out_at=is.null',
    });

    const rule = AUDIENCES[audience] ?? AUDIENCES.consented;
    const recipients = (audiences.rows ?? []).filter(rule.match);

    const created = await sb<{ id: string }>('sms_campaigns', {
      method: 'POST',
      body: {
        name,
        body,
        audience,
        recipients: recipients.length,
        status: recipients.length === 0 ? 'sent' : 'sending',
        sent_at: new Date().toISOString(),
      },
      returning: true,
    });

    const campaignId = created.rows?.[0]?.id;
    let delivered = 0;
    let failed = 0;

    for (const person of recipients) {
      const result = await sendSms(person.phone as string, body);
      if (result.ok) delivered += 1;
      else failed += 1;

      // One row per person, written whether it worked or not. If somebody says
      // they were messaged without asking, this is what answers it.
      await sb('sms_messages', {
        method: 'POST',
        body: {
          campaign_id: campaignId,
          profile_id: person.id,
          msisdn: person.phone,
          status: result.ok ? 'sent' : 'failed',
          provider_message_id: result.ok ? result.messageId : null,
          error: result.ok ? null : result.error,
        },
      });
    }

    if (campaignId) {
      await sb('sms_campaigns', {
        query: `id=eq.${campaignId}`,
        method: 'PATCH',
        body: { delivered, failed, status: failed > 0 && delivered === 0 ? 'failed' : 'sent' },
      });
    }

    revalidatePath('/marketing');
  }

  const sample = measureSms(withOptOut('Your message goes here.'));

  return (
    <Shell>
      <PageHead
        title="Marketing"
        description="SMS to people who opted in. Everyone else is unreachable from this screen, by design."
      />

      {!hasServiceRole ? <ServiceRoleRequired reads="sms_campaigns and sms_messages" /> : null}

      {!smsConfigured() ? (
        <Notice tone="error" title="SMS is not configured">
          Set <code>INFOBIP_BASE_URL</code> and <code>INFOBIP_API_KEY</code>, and optionally{' '}
          <code>INFOBIP_SMS_SENDER</code>, in the server environment.
        </Notice>
      ) : null}

      {consented.length === 0 ? (
        <Notice tone="warn" title="Nobody has opted in yet, so nothing can be sent">
          {withNumber.length} of {all.length} accounts have a phone number on file, and none of them
          has agreed to marketing SMS. A number given so a host could confirm a viewing was not given
          for offers — under the Data Protection Act 2019 those are separate purposes, and consent to
          one is not consent to the other. The app needs to ask, on the profile or at sign-up, before
          this page can do anything. That is the next piece of work, not a setting to change here.
        </Notice>
      ) : null}

      <div className="grid cols-4" style={{ marginBottom: 16 }}>
        <Metric label="Opted in" value={consented.length} tone={consented.length > 0 ? 'good' : undefined} hint="Reachable from this page" />
        <Metric label="Have a number" value={withNumber.length} hint={`${all.length} accounts in total`} />
        <Metric
          label="Opted out"
          value={optedOut.length}
          tone={optedOut.length > 0 ? 'warn' : undefined}
          hint="Excluded from every audience"
        />
        <Metric
          label="Messages delivered"
          value={(campaigns.rows ?? []).reduce((sum, c) => sum + (c.delivered ?? 0), 0)}
          hint={`${(campaigns.rows ?? []).filter((c) => c.status === 'sent').length} campaigns sent`}
        />
      </div>

      <form action={send} className="card" style={{ display: 'grid', gap: 14, marginBottom: 22 }}>
        <div>
          <label className="label" htmlFor="name">Campaign name</label>
          <input id="name" name="name" className="input" placeholder="August — new homes in Westlands" required />
          <div className="dim" style={{ fontSize: 12, marginTop: 4 }}>For your records. Never sent to anybody.</div>
        </div>

        <div>
          <label className="label" htmlFor="audience">Who receives it</label>
          <select id="audience" name="audience" className="input">
            {Object.entries(AUDIENCES).map(([key, a]) => (
              <option key={key} value={key}>{a.label}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="label" htmlFor="body">Message</label>
          <textarea id="body" name="body" className="input" rows={4}
            placeholder="Three new studios in Westlands from KES 28,000. See them on E Space." required />
          <div className="dim" style={{ fontSize: 12, marginTop: 6, lineHeight: 1.6 }}>
            <strong>&ldquo;{withOptOut('…')}&rdquo;</strong> is appended automatically — it is not optional.
            <br />
            An empty message with only that line costs {sample.segments} segment
            {sample.segments === 1 ? '' : 's'} in {sample.encoding}. Curly quotes and en dashes push
            a message into UCS-2, which cuts what fits from 160 characters to 70 and doubles the bill.
            Type straight quotes and hyphens.
          </div>
        </div>

        <div>
          <label className="label" htmlFor="confirm">Type SEND to confirm</label>
          <input id="confirm" name="confirm" className="input" placeholder="SEND" autoComplete="off" />
          <div className="dim" style={{ fontSize: 12, marginTop: 4 }}>
            This spends money and cannot be taken back once it has gone.
          </div>
        </div>

        <div>
          <button className="btn primary" type="submit" disabled={consented.length === 0}>
            Send campaign
          </button>
        </div>
      </form>

      <DataTable
        head={['Campaign', 'Audience', 'Sent to', 'Delivered', 'When', 'Status']}
        placeholder="Search campaigns…"
        noun="campaign"
        empty={<><strong>No campaigns yet.</strong>Anything sent from this page is recorded here.</>}>
        {(campaigns.rows ?? []).map((c) => (
          <tr key={c.id} data-search={`${c.name} ${c.body}`}>
            <td>
              <div style={{ fontWeight: 700 }}>{c.name}</div>
              <div className="review-text" style={{ marginTop: 4 }}>{c.body}</div>
            </td>
            <td>{AUDIENCES[c.audience]?.label ?? c.audience}</td>
            <td className="num">{c.recipients}</td>
            <td className="num">
              {c.delivered}
              {c.failed > 0 ? <div className="mono" style={{ color: 'var(--bad)' }}>{c.failed} failed</div> : null}
            </td>
            <td className="dim nowrap">
              <div>{ago(c.sent_at ?? c.created_at)}</div>
              <div className="mono">{when(c.sent_at ?? c.created_at)}</div>
            </td>
            <td>
              <Badge value={c.status} tone={c.status === 'sent' ? 'green' : c.status === 'failed' ? 'red' : 'amber'} />
            </td>
          </tr>
        ))}
      </DataTable>

      <div style={{ marginTop: 20 }}>
        <Notice tone="warn" title="STOP replies still have to be entered by hand">
          An opt-out is honoured the moment it is recorded: anybody with
          <code>marketing_opted_out_at</code> set is excluded from every audience on this page,
          whatever their consent flag still says. What is missing is the part that records it —
          nothing is listening for the STOP reply, so until an Infobip inbound webhook is wired up,
          somebody who opts out stays reachable until a person sets that column for them. Worth
          building before a campaign goes to more than a handful of people.
        </Notice>
      </div>
    </Shell>
  );
}
