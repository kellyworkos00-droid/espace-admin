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
        <div className="brand" style={{ padding: 0, color: '#0b1a17' }}>
          E <span style={{ color: '#0f6a59' }}>Space</span>
          <small style={{ color: '#8a9aa1' }}>OPERATIONS</small>
        </div>

        <h1>Sign in</h1>
        <p>This console releases escrow and pays hosts. Do not share access.</p>

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
