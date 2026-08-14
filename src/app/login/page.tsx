import { redirect } from 'next/navigation';

import { createSession, credentialsConfigured, credentialsMatch, isSignedIn } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  if (await isSignedIn()) redirect('/');

  const params = await searchParams;
  const configured = credentialsConfigured();

  async function signIn(formData: FormData) {
    'use server';

    const email = String(formData.get('email') ?? '');
    const password = String(formData.get('password') ?? '');

    // One message for every failure: saying which field was wrong tells an
    // attacker whether the address is a real operator account.
    if (!credentialsMatch(email, password)) {
      redirect('/login?error=1');
    }

    await createSession();
    redirect('/');
  }

  return (
    <div className="login-wrap">
      <div className="login-card">
        {/* The three colours here were hard-coded hexes, so this was the one
            screen that ignored the theme entirely — a white card with fixed
            dark text, in dark mode. */}
        <span className="login-lockup" role="img" aria-label="E Space" />

        <h1>Operations</h1>
        <p>
          {/* It does not release escrow — that belongs to the renter, in the
              app. Claiming otherwise on the sign-in screen is the sort of
              thing somebody later repeats in a support reply. */}
          Payouts, verification and disputes for E Space. Access is per person;
          do not share it.
        </p>

        {!configured ? (
          <div className="notice warn">
            <strong>Credentials not set</strong>
            Set <code>ADMIN_EMAIL</code> and <code>ADMIN_PASSWORD</code> in <code>.env.local</code>,
            then restart. Sign-in stays disabled until you do.
          </div>
        ) : null}

        {params.error ? <div className="notice error">Incorrect email or password.</div> : null}

        <form action={signIn}>
          <label className="field-label" htmlFor="email">
            Email
          </label>
          <input
            id="email"
            name="email"
            type="text"
            autoComplete="username"
            autoFocus
            required
            style={{ marginBottom: 14 }}
          />

          <label className="field-label" htmlFor="password">
            Password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
          />

          <button className="btn primary" style={{ width: '100%', marginTop: 18 }} type="submit">
            Sign in
          </button>
        </form>
      </div>
    </div>
  );
}
