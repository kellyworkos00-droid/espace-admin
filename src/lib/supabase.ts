import 'server-only';

/**
 * Server-side Supabase access for the console.
 *
 * Deliberately a thin fetch wrapper over PostgREST rather than the JS client:
 * this runs only on the server, needs no realtime or auth session, and keeping
 * it to fetch means the service-role key can never be bundled into anything the
 * browser receives.
 *
 * It prefers the service-role key so the console can act on rows regardless of
 * row-level security, and falls back to the anon key so the read-only screens
 * still work before that key has been supplied.
 */

const URL_BASE = process.env.SUPABASE_URL ?? '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';

export const hasServiceRole = Boolean(SERVICE_KEY);

function key() {
  return SERVICE_KEY || ANON_KEY;
}

export function supabaseConfigured() {
  return Boolean(URL_BASE && key());
}

type QueryOptions = {
  /** PostgREST query string, without the leading `?`. */
  query?: string;
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  /** Ask PostgREST for the affected rows back. */
  returning?: boolean;
  /** Adds an exact row count to the response headers. */
  count?: boolean;
};

export type QueryResult<T> = {
  rows: T[];
  /** Total rows matching the filter, when `count` was requested. */
  total: number | null;
  error: string | null;
};

export async function sb<T = Record<string, unknown>>(
  table: string,
  { query = '', method = 'GET', body, returning, count }: QueryOptions = {}
): Promise<QueryResult<T>> {
  if (!supabaseConfigured()) {
    return { rows: [], total: null, error: 'Supabase is not configured. Set SUPABASE_URL and a key.' };
  }

  const headers: Record<string, string> = {
    apikey: key(),
    Authorization: `Bearer ${key()}`,
    'Content-Type': 'application/json',
  };

  const prefer: string[] = [];
  if (returning) prefer.push('return=representation');
  if (count) prefer.push('count=exact');
  if (prefer.length) headers.Prefer = prefer.join(',');

  try {
    const response = await fetch(`${URL_BASE}/rest/v1/${table}${query ? `?${query}` : ''}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      // Operations data must never be served stale.
      cache: 'no-store',
    });

    const text = await response.text();

    if (!response.ok) {
      return { rows: [], total: null, error: `${response.status}: ${text.slice(0, 300)}` };
    }

    // content-range looks like "0-24/137"; the part after the slash is the total.
    const range = response.headers.get('content-range');
    const total = range && range.includes('/') ? Number(range.split('/')[1]) : null;

    return {
      rows: text ? (JSON.parse(text) as T[]) : [],
      total: Number.isFinite(total) ? total : null,
      error: null,
    };
  } catch (error) {
    return {
      rows: [],
      total: null,
      error: error instanceof Error ? error.message : 'Request failed',
    };
  }
}

/** Row count only, without transferring the rows. */
export async function countRows(table: string, query = ''): Promise<number> {
  const result = await sb(table, { query: `select=id&limit=1${query ? `&${query}` : ''}`, count: true });
  return result.total ?? result.rows.length;
}
