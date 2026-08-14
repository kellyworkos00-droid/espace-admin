import { DataTable } from '@/components/data-table';
import { Shell } from '@/components/shell';
import {
  Badge,
  Metric,
  Notice,
  PageHead,
  PersonCell,
  ago,
  personIndex,
  personSearch,
  when,
  LoadError,
} from '@/components/ui';
import { requireAdmin } from '@/lib/auth';
import { hasServiceRole } from '@/lib/supabase';
import { getBookings, getListings, getMessages, getProfiles, type MessageRow } from '@/lib/queries';

export const dynamic = 'force-dynamic';

/**
 * Conversations, grouped into threads.
 *
 * This screen exists because the Terms of Service commit us to something the
 * console could not do. Clause 8 tells a renter that a refund request is
 * reviewed "against the listing and the messages between you", and clause 10
 * prohibits asking anyone to pay outside the platform -- both are promises
 * about reading a conversation, and there was no way to read one.
 *
 * Deciding a dispute on one party's screenshot is deciding it on one party's
 * account of it.
 *
 * Read-only, and it will stay that way. Nobody in operations should be able to
 * write into a conversation between a host and a renter, or edit what either
 * of them said -- the value of the record is that it was not touched.
 *
 * The off-platform flag is a hint, not a verdict. It matches words that appear
 * in ordinary messages too ("send the deposit on Friday"), so it sorts a
 * conversation to the top of someone's attention; it does not judge it.
 */

/** Phrases that tend to precede a request to pay outside escrow. */
const OFF_PLATFORM = [
  'send to my number',
  'send it to my',
  'pay directly',
  'directly to my',
  'outside the app',
  'off the app',
  'cash only',
  'no need to book',
  'cancel the booking and',
  'my till',
  'paybill',
  'send money to',
];

function flagged(body: string | null) {
  if (!body) return false;
  const text = body.toLowerCase();
  return OFF_PLATFORM.some((phrase) => text.includes(phrase));
}

type Thread = {
  key: string;
  messages: MessageRow[];
  participants: string[];
  bookingId: string | null;
  listingId: string | null;
  lastAt: string;
  flagged: boolean;
};

function buildThreads(rows: MessageRow[]): Thread[] {
  const byKey = new Map<string, MessageRow[]>();

  for (const row of rows) {
    // Falls back to the pair of participants where thread_key is null, so an
    // older message written before threading still lands in the right place
    // rather than becoming a conversation of one. Sorted so the same two
    // people produce one key whichever of them happened to send first.
    const pair = [row.sender_profile_id, row.recipient_profile_id].filter(Boolean).sort().join('~');
    const key = row.thread_key || pair || row.id;

    const list = byKey.get(key);
    if (list) list.push(row);
    else byKey.set(key, [row]);
  }

  const threads: Thread[] = [];

  for (const [key, messages] of byKey) {
    messages.sort((a, b) => a.sent_at.localeCompare(b.sent_at));
    const participants = [
      ...new Set(
        messages.flatMap((m) => [m.sender_profile_id, m.recipient_profile_id]).filter(Boolean)
      ),
    ] as string[];

    threads.push({
      key,
      messages,
      participants,
      bookingId: messages.find((m) => m.booking_id)?.booking_id ?? null,
      listingId: messages.find((m) => m.listing_id)?.listing_id ?? null,
      lastAt: messages[messages.length - 1].sent_at,
      flagged: messages.some((m) => flagged(m.body)),
    });
  }

  return threads.sort((a, b) => b.lastAt.localeCompare(a.lastAt));
}

export default async function MessagesPage() {
  await requireAdmin();

  const [messages, profiles, bookings, listings] = await Promise.all([
    getMessages(),
    getProfiles(),
    getBookings(),
    getListings(),
  ]);

  const people = personIndex(profiles.rows);
  const listingById = new Map(listings.rows.map((row) => [row.id, row]));
  const bookingById = new Map(bookings.rows.map((row) => [row.id, row]));

  const threads = buildThreads(messages.rows);
  const flaggedThreads = threads.filter((thread) => thread.flagged);

  return (
    <Shell>
      <PageHead
        title="Messages"
        description="The conversation behind a booking. This is the evidence a refund or a fraud report is decided on, so it is readable here and never editable."
      />

      <LoadError
        error={messages.error}
        what="messages"
        keyed={hasServiceRole}
        hint={<>If this mentions the table, the console&rsquo;s key may not be permitted to read <code>messages</code>.</>}
      />

      <div className="grid cols-3" style={{ marginBottom: 16 }}>
        <Metric label="Conversations" value={threads.length} hint={`${messages.rows.length} message(s)`} />
        <Metric
          label="About a booking"
          value={threads.filter((thread) => thread.bookingId).length}
          hint="Linked to a specific booking"
        />
        <Metric
          label="Worth reading"
          value={flaggedThreads.length}
          tone={flaggedThreads.length > 0 ? 'warn' : undefined}
          hint="Mention paying outside the app"
        />
      </div>

      {flaggedThreads.length > 0 ? (
        <Notice tone="warn" title={`${flaggedThreads.length} conversation(s) mention payment outside the app`}>
          Asking a renter to pay outside E Space is prohibited under clause 10 and removes their
          escrow protection entirely. Read the thread before acting — the same words appear in
          perfectly ordinary messages, so this is a prompt to look, not a finding.
        </Notice>
      ) : null}

      <DataTable
        head={['Between', 'About', 'Messages', 'Last', 'Conversation']}
        placeholder="Search by name, email, listing or message text…"
        noun="conversation"
        filters={[
          { value: 'flagged', label: 'Off-platform' },
          { value: 'booking', label: 'About a booking' },
          { value: 'other', label: 'General' },
        ]}
        empty={
          <>
            <strong>No messages yet.</strong>
            Conversations appear here as soon as a renter and a host start talking.
          </>
        }>
        {threads.map((thread) => {
          const listing = thread.listingId ? listingById.get(thread.listingId) : undefined;
          const booking = thread.bookingId ? bookingById.get(thread.bookingId) : undefined;
          const [first, second] = thread.participants;

          const haystack = [
            thread.participants.map((id) => personSearch(id, people)).join(' '),
            listing?.title,
            listing?.neighborhood,
            thread.bookingId,
            thread.messages.map((message) => message.body ?? '').join(' '),
          ]
            .filter(Boolean)
            .join(' ');

          return (
            <tr
              key={thread.key}
              data-search={haystack}
              data-filter={thread.flagged ? 'flagged' : thread.bookingId ? 'booking' : 'other'}>
              <td>
                <PersonCell id={first} people={people} />
                {second ? (
                  <div style={{ marginTop: 6 }}>
                    <PersonCell id={second} people={people} />
                  </div>
                ) : null}
              </td>

              <td className="dim">
                <div style={{ fontWeight: 700, color: 'var(--ink)' }}>
                  {listing?.title ?? (thread.bookingId ? 'A booking' : 'General enquiry')}
                </div>
                {booking ? (
                  <div style={{ marginTop: 4 }}>
                    <Badge value={booking.request_status ?? booking.status} />
                  </div>
                ) : null}
              </td>

              <td className="num">{thread.messages.length}</td>

              <td className="dim nowrap">
                {ago(thread.lastAt)}
                {thread.flagged ? (
                  <div style={{ marginTop: 4 }}>
                    <Badge value="off-platform" tone="amber" />
                  </div>
                ) : null}
              </td>

              <td>
                {/* Inline rather than behind a link. A dispute is read in full
                    or it is not read at all, and a thread is short enough to
                    open where it sits. */}
                <details>
                  <summary
                    style={{ cursor: 'pointer', fontWeight: 700, color: 'var(--brand)', fontSize: 12.5 }}>
                    Read all {thread.messages.length}
                  </summary>
                  <div className="thread" style={{ marginTop: 10, minWidth: 320 }}>
                    {thread.messages.map((message) => (
                      <div
                        key={message.id}
                        className={message.sender_profile_id === first ? 'msg' : 'msg right'}>
                        <div className="msg-who">
                          {people.get(message.sender_profile_id ?? '')?.name ?? 'Unknown'}
                        </div>
                        <div className="msg-bubble">{message.body ?? '(empty message)'}</div>
                        <div className="msg-time">{when(message.sent_at)}</div>
                      </div>
                    ))}
                  </div>
                </details>
              </td>
            </tr>
          );
        })}
      </DataTable>
    </Shell>
  );
}
