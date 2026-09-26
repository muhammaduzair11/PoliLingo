'use client';
/* oxlint-disable react/react-compiler -- The session hint is read from document.cookie after mount, so the static HTML is the same for everyone. No React Compiler is configured. */
import { lazy, Suspense, useEffect, useState } from 'react';
import { setAccount } from '@/lib/account-store';
import { hasSessionHint } from '@/lib/auth-hint';

// Loaded only when a session cookie is present, so an anonymous visitor
// never downloads supabase-js (docs/platform.md 4.5, 4.6). Keep this a
// dynamic import: tests/boundaries.test.mjs checks it.
const AccountRuntime = lazy(() => import('./account/runtime'));

/**
 * Mounted once by app/layout.tsx inside LearningProvider. After mount: no
 * session cookie means anonymous, published to the account store at once;
 * a cookie loads the account runtime, which decides.
 */
export function AccountBoot() {
  const [hint, setHint] = useState(false);
  useEffect(() => {
    if (hasSessionHint(document.cookie)) setHint(true);
    else setAccount({ status: 'anonymous' });
  }, []);
  if (!hint) return null;
  return (
    <Suspense fallback={null}>
      <AccountRuntime />
    </Suspense>
  );
}
