import { hasServiceRole } from '@/lib/supabase';

/**
 * The difference between "nothing happened" and "you cannot see it".
 *
 * PostgREST answers a blocked SELECT with 200 and an empty array, not an
 * error. So a table the console has no permission to read looks exactly like a
 * table with nothing in it -- and this console currently authenticates with the
 * publishable key, which row-level security denies on most of the sensitive
 * tables. There were four listing reports and one support ticket in the
 * database while both pages showed a tidy "nothing here".
 *
 * A banner across every page used to say so. It was accurate and it was
 * ignored, because a notice repeated on every screen becomes furniture. This
 * says it only where it is actually happening: on a page that has come back
 * empty, when the key that would have filled it is missing. If the key is set
 * and the page is empty, the page really is empty and this renders nothing.
 */
export function BlockedNotice({ what }: { what: string }) {
  if (hasServiceRole) return null;

  return (
    <div className="blocked">
      <strong>This list may not be empty.</strong>
      <p>
        The console is reading with the publishable key, which row-level security blocks on{' '}
        {what}. A blocked read returns no rows rather than an error, so this looks the same as
        having none.
      </p>
      <p className="blocked-how">
        Set <code>SUPABASE_SERVICE_ROLE_KEY</code> in <code>espace-admin/.env.local</code> and
        restart. Supabase → Project Settings → API keys → the <strong>secret</strong> key. It is
        server-side only and never reaches a browser.
      </p>
    </div>
  );
}
