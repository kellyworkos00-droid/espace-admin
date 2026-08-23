'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

/**
 * Keeps a server-rendered page current without a reload.
 *
 * Polling rather than a Supabase realtime subscription, and that is a decision
 * rather than a shortcut. Realtime needs a key in the browser, and the only key
 * safe to ship there is the anon one -- which would mean a select policy on
 * support_tickets, which would mean anyone holding the app's publishable key
 * could read every ticket in the system, screenshots and phone numbers
 * included. A fifteen-second poll behind the console's login costs one query
 * and gives up nothing.
 *
 * It stops while the tab is hidden: a console left open on a second monitor
 * should not spend the night querying.
 */
export function AutoRefresh({ seconds = 15 }: { seconds?: number }) {
  const router = useRouter();
  const [live, setLive] = useState(true);

  useEffect(() => {
    const onVisibility = () => {
      const visible = document.visibilityState === 'visible';
      setLive(visible);
      // Catch up on return rather than waiting out the interval.
      if (visible) router.refresh();
    };

    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [router]);

  useEffect(() => {
    if (!live) return;

    const timer = window.setInterval(() => router.refresh(), seconds * 1000);
    return () => window.clearInterval(timer);
  }, [live, router, seconds]);

  return (
    <div
      className={live ? 'keystate is-ok' : 'keystate is-limited'}
      title={live ? `Refreshing every ${seconds}s` : 'Paused while this tab is in the background'}>
      <span className="keystate-dot" />
      {live ? `Live · every ${seconds}s` : 'Paused'}
    </div>
  );
}
