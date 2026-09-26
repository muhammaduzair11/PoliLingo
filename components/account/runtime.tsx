'use client';
/* oxlint-disable react/react-compiler -- A mount effect publishes to the external account store. No React Compiler is configured. */
import { useEffect } from 'react';
import { setAccount } from '@/lib/account-store';
import { SyncAgent } from './sync-agent';

/**
 * STUB (foundation). Track A replaces this with the account runtime
 * (docs/platform.md 4.6): it creates the browser client, reads the session,
 * subscribes to onAuthStateChange, publishes to the account store and
 * renders <SyncAgent />. components/account-boot.tsx loads it with a dynamic
 * import only when a session cookie is present, so its signature, a default
 * export taking no props, is final.
 *
 * Until then the session is not read: the store stays 'unknown'.
 */
export default function AccountRuntime() {
  useEffect(() => {
    setAccount({ status: 'unknown' });
  }, []);
  return <SyncAgent />;
}
