'use client';
/* oxlint-disable react/react-compiler -- Effects subscribe to window events and timers, keep the latest progress in a ref for async callbacks, and publish to the external account store. No React Compiler is configured. */
import { useEffect, useRef, useState } from 'react';
import { useLearning } from '@/components/learning-provider';
import { setAccount, useAccount, type SyncStatus } from '@/lib/account-store';
import {
  GENERIC_MESSAGE,
  NETWORK_MESSAGE,
  NOT_CONFIGURED_MESSAGE,
} from '@/lib/db-errors';
import { localDate, streak } from '@/lib/progress';
import { callRpc } from '@/lib/rpc';
import { browserSupabase } from '@/lib/supabase/browser';
import {
  PAUSE_KEY,
  accountChoice,
  applySnapshot,
  buildEnvelope,
  envelopeKey,
  focusDue,
  parseSnapshot,
  retryDelay,
  syncFailure,
} from '@/lib/sync';
import { AccountSwitchDialog } from './account-switch-dialog';

type Reason = 'sign-in' | 'progress' | 'focus' | 'online' | 'retry' | 'add';

/** Whether "Not now" paused sync to this account in this tab. */
function pausedFor(userId: string): boolean {
  try {
    return sessionStorage.getItem(PAUSE_KEY) === userId;
  } catch {
    return false;
  }
}

/**
 * Keeps this device's progress and the signed-in account's in step
 * (docs/platform.md 4.9). Mounted by the account runtime, so it only ever
 * runs for a signed-in learner; an anonymous visitor never loads it.
 *
 * It syncs once progress has loaded after sign-in, whenever a lesson is
 * rewarded, when the window regains focus (at most every 15 s) and when the
 * browser comes back online. One sync at a time: a request while one is on
 * its way runs once it lands. A failure retries with exponential backoff
 * when trying again can help. Status goes to the account store for the
 * header chip and the account page.
 *
 * Local progress only ever grows here: the account's snapshot is merged in
 * with applySnapshot(), and nothing is sent to an account the device did not
 * last sync to until the learner says Add (AccountSwitchDialog).
 */
export function SyncAgent() {
  const { state, ready, update } = useLearning();
  const account = useAccount();
  const userId =
    account.status === 'signed-in' && account.userId ? account.userId : null;

  const [asking, setAsking] = useState(false);
  const [adding, setAdding] = useState(false);
  // Add landed: the dialog shows its done state until the learner closes it.
  const [saved, setSaved] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');

  // The latest progress, for callbacks that outlive a render.
  const stateRef = useRef(state);
  // How many rewarded sessions the account already has from this device: the
  // count in the last envelope sent, then (once it lands) that envelope
  // merged with the account's answer. -1 until the first envelope goes out,
  // so a lesson finished before it waits for it. Any growth past it syncs,
  // whether or not the last attempt succeeded.
  const knownRewarded = useRef(-1);
  // The account the learner said Add to in this tab: no more asking for it.
  const addedTo = useRef<string | null>(null);
  // The running agent's entry point, so the dialog and the progress effect can call it.
  const run = useRef<(reason: Reason) => void>(() => {});

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    setAsking(false);
    setAdding(false);
    setSaved(false);
    setAddError(null);
    if (!ready || !userId) return;
    const uid = userId;
    const supabase = browserSupabase();
    let cancelled = false;
    let inFlight = false;
    let again: false | 'progress' | 'add' = false;
    let failures = 0;
    let lastStarted: number | null = null;
    let lastKey: string | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    knownRewarded.current = -1;

    const clearRetry = () => {
      if (retryTimer !== null) clearTimeout(retryTimer);
      retryTimer = null;
    };

    // A sync that cannot start: the status, and for Add the sentence in the dialog.
    function stop(reason: Reason, status: SyncStatus, message: string) {
      setAccount({ sync: status });
      if (reason === 'add') {
        setAdding(false);
        setAddError(message);
      }
    }

    async function sync(reason: Reason): Promise<void> {
      if (cancelled) return;
      if (inFlight) {
        // Add outranks the rest: its dialog is waiting for the answer.
        if (again !== 'add') again = reason === 'add' ? 'add' : 'progress';
        return;
      }
      if (reason !== 'add' && pausedFor(uid)) {
        setAccount({ sync: 'paused' });
        return;
      }
      const local = stateRef.current;
      if (addedTo.current !== uid && accountChoice(local, uid) === 'ask') {
        setAsking(true);
        return;
      }
      if (!supabase) {
        stop(reason, 'error', NOT_CONFIGURED_MESSAGE);
        return;
      }
      if (navigator.onLine === false) {
        // The online event tries again.
        stop(reason, 'offline', NETWORK_MESSAGE);
        return;
      }
      const envelope = buildEnvelope(local, localDate());
      const key = envelopeKey(envelope);
      // A lesson reward that changed nothing the account needs: skip it.
      if (reason === 'progress' && key === lastKey) return;

      clearRetry();
      inFlight = true;
      lastStarted = Date.now();
      // Counted from what is sent, not from what the device holds when the
      // answer lands: a lesson finished meanwhile is still unsent.
      knownRewarded.current = local.rewarded.length;
      setAccount({ sync: 'syncing' });
      const result = await callRpc<unknown>(supabase, 'import_local_progress', {
        p_envelope: envelope,
      });
      inFlight = false;
      if (cancelled) return;

      const snapshot = result.ok ? parseSnapshot(result.data) : null;
      if (!snapshot) {
        const error = result.ok
          ? { code: 'BAD_SNAPSHOT', message: GENERIC_MESSAGE }
          : result.error;
        const failure = syncFailure(error.code);
        failures += 1;
        stop(reason, failure.status, error.message);
        // Add waits for the learner to try again; everything else retries itself.
        if (failure.retry && reason !== 'add')
          retryTimer = setTimeout(
            () => void sync('retry'),
            retryDelay(failures),
          );
        // An Add clicked meanwhile still gets its one attempt; anything else
        // waits for the retry or the next trigger.
        if (again === 'add') {
          again = false;
          void sync('add');
        }
        return;
      }

      failures = 0;
      lastKey = key;
      const now = new Date();
      // What was sent plus what the account added: merging that back is not
      // new progress. A session rewarded while the request was out is on
      // top of this, so it still syncs.
      knownRewarded.current = applySnapshot(
        local,
        snapshot,
        uid,
        now,
      ).rewarded.length;
      update((s) => applySnapshot(s, snapshot, uid, now));
      setAccount({ sync: 'synced', lastSyncedAt: now.toISOString() });
      if (reason === 'add') {
        setAdding(false);
        setAddError(null);
        setSaved(true);
        setAnnouncement(
          "Done. This device's progress is saved to your account.",
        );
      }
      if (again) {
        const next = again;
        again = false;
        void sync(next);
      }
    }

    const onFocus = () => {
      if (focusDue(lastStarted, Date.now())) void sync('focus');
    };
    const onOnline = () => {
      failures = 0;
      void sync('online');
    };
    const onOffline = () => {
      if (!inFlight) setAccount({ sync: 'offline' });
    };
    window.addEventListener('focus', onFocus);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    run.current = (reason) => void sync(reason);
    void sync('sign-in');

    return () => {
      cancelled = true;
      clearRetry();
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      run.current = () => {};
    };
  }, [ready, userId, update]);

  // A lesson rewarded since the last sync.
  const rewarded = state.rewarded.length;
  useEffect(() => {
    if (knownRewarded.current >= 0 && rewarded > knownRewarded.current)
      run.current('progress');
  }, [rewarded]);

  function add() {
    if (!userId) return;
    addedTo.current = userId;
    setAddError(null);
    setAdding(true);
    setAnnouncement("Adding this device's progress to your account…");
    run.current('add');
  }

  function done() {
    setAsking(false);
    setSaved(false);
  }

  function notNow() {
    if (!userId) return;
    try {
      sessionStorage.setItem(PAUSE_KEY, userId);
    } catch {
      /* Without sessionStorage the pause lasts until this page reloads. */
    }
    setAsking(false);
    setAddError(null);
    setAccount({ sync: 'paused' });
    setAnnouncement(
      'Saving to your account is paused in this tab. Your progress stays on this device.',
    );
  }

  return (
    <>
      <AccountSwitchDialog
        open={asking && userId !== null}
        email={account.email}
        lessons={Object.keys(state.completed).length}
        xp={state.xp}
        streakDays={streak(state.activity)}
        pending={adding}
        done={saved}
        error={addError}
        onAdd={add}
        onNotNow={notNow}
        onDone={done}
      />
      <output className="sr-only" aria-live="polite">
        {announcement}
      </output>
    </>
  );
}
