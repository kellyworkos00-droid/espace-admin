import 'server-only';

import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { createHash, timingSafeEqual } from 'crypto';

const COOKIE = 'espace_admin_session';

/**
 * Gate for the console.
 *
 * Email and password held in the environment, exchanged for an httpOnly
 * cookie. Credentials live in `.env.local`, which is git-ignored, so nothing
 * secret is ever committed.
 *
 * This is intentionally the simplest thing that is not open to the internet.
 * It is NOT a substitute for per-operator accounts: every action in this
 * console moves money or changes what renters see, and a shared login cannot
 * tell you who did it. Move to real identities with an audit trail before more
 * than one person has access.
 */
function digest(value: string) {
  return createHash('sha256').update(value).digest();
}

/** Fixed-width compare, so neither length nor content leaks through timing. */
function safeEqual(a: string, b: string) {
  return timingSafeEqual(digest(a), digest(b));
}

function adminEmail() {
  return (process.env.ADMIN_EMAIL ?? '').trim().toLowerCase();
}

function adminPassword() {
  return process.env.ADMIN_PASSWORD ?? '';
}

export function credentialsConfigured() {
  const password = adminPassword();
  return Boolean(adminEmail() && password && password !== 'change-me-now');
}

/** The session token is derived from the credentials, so changing them signs everyone out. */
function expectedToken() {
  return createHash('sha256')
    .update(`espace-admin:${adminEmail()}:${adminPassword()}`)
    .digest('hex');
}

export function credentialsMatch(email: string, password: string) {
  if (!credentialsConfigured()) return false;

  // Both are compared even when the email is already wrong, so a valid address
  // cannot be identified by how quickly the request comes back.
  const emailOk = safeEqual(email.trim().toLowerCase(), adminEmail());
  const passwordOk = safeEqual(password, adminPassword());
  return emailOk && passwordOk;
}

/**
 * Whether this request actually arrived over HTTPS.
 *
 * Checked per request rather than assumed from NODE_ENV. A production build
 * served over plain HTTP -- `npm run start`, or reaching the machine on its LAN
 * address -- would otherwise set a Secure cookie that the browser silently
 * refuses to store, so signing in appeared to work and then bounced straight
 * back to the login page.
 *
 * Behind Vercel and most proxies the original scheme survives in
 * x-forwarded-proto; the direct protocol is only visible when there is no proxy.
 */
async function isSecureRequest() {
  const store = await headers();
  const forwarded = store.get('x-forwarded-proto');
  if (forwarded) return forwarded.split(',')[0].trim() === 'https';
  return (store.get('referer') ?? '').startsWith('https://');
}

export async function createSession() {
  const store = await cookies();
  store.set(COOKIE, expectedToken(), {
    httpOnly: true,
    sameSite: 'lax',
    // Secure only when the connection really is HTTPS, so it is enforced in
    // deployment without breaking a local or LAN-served build.
    secure: await isSecureRequest(),
    path: '/',
    maxAge: 60 * 60 * 8,
  });
}

export async function destroySession() {
  const store = await cookies();
  store.delete(COOKIE);
}

export async function isSignedIn() {
  if (!credentialsConfigured()) return false;

  const store = await cookies();
  const token = store.get(COOKIE)?.value;
  if (!token) return false;

  const expected = expectedToken();
  if (token.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(token), Buffer.from(expected));
}

/** Guards a page. Every screen except the sign-in page calls this first. */
export async function requireAdmin() {
  if (!(await isSignedIn())) {
    redirect('/login');
  }
}
