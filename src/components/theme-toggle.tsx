'use client';

import { useEffect, useState } from 'react';

import { IconMoon, IconSun } from './icons';

/**
 * Light/dark switch.
 *
 * Starts on whatever the OS says and only writes a preference once someone
 * actually picks one, so a machine set to dark is not forced back to white on
 * first load.
 *
 * The stored choice is applied by a blocking script in the layout, before the
 * first paint. This component cannot do that job -- it mounts after hydration,
 * which is one frame too late and shows up as a white flash on every
 * navigation.
 */

const KEY = 'espace-console-theme';

export function ThemeToggle() {
  const [theme, setTheme] = useState<'light' | 'dark' | null>(null);

  useEffect(() => {
    const stored = window.localStorage.getItem(KEY);
    if (stored === 'light' || stored === 'dark') {
      setTheme(stored);
      return;
    }
    setTheme(window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  }, []);

  const toggle = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    document.documentElement.dataset.theme = next;
    window.localStorage.setItem(KEY, next);
  };

  // Rendered blank until the real theme is known, so the button never claims
  // to switch to the mode already showing.
  if (!theme) return <button className="theme-toggle" type="button" aria-hidden="true" style={{ opacity: 0 }} />;

  return (
    <button className="theme-toggle" type="button" onClick={toggle}>
      {theme === 'dark' ? <IconSun /> : <IconMoon />}
      <span>{theme === 'dark' ? 'Light mode' : 'Dark mode'}</span>
    </button>
  );
}
