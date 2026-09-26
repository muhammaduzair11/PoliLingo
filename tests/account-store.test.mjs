// lib/account-store.ts: the external store the header chip and sync status
// read through useSyncExternalStore.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getAccountSnapshot,
  getServerAccountSnapshot,
  initialAccount,
  initialFor,
  resetAccountStore,
  setAccount,
  subscribeAccount,
} from '../lib/account-store.ts';

test('it starts unknown, and the server always renders unknown', () => {
  resetAccountStore();
  assert.deepEqual(getAccountSnapshot(), {
    status: 'unknown',
    userId: null,
    email: null,
    initial: null,
    sync: 'idle',
    lastSyncedAt: null,
  });
  assert.equal(getServerAccountSnapshot(), initialAccount);
  assert.ok(Object.isFrozen(getAccountSnapshot()));
});

test('signing in publishes the identity and an initial', () => {
  resetAccountStore();
  let calls = 0;
  const unsubscribe = subscribeAccount(() => calls++);
  const next = setAccount({
    status: 'signed-in',
    userId: 'u1',
    email: 'zainab@example.com',
  });
  assert.equal(calls, 1);
  assert.equal(next, getAccountSnapshot());
  assert.equal(next.initial, 'Z');
  assert.equal(next.userId, 'u1');
  unsubscribe();
});

test('an unchanged patch keeps the snapshot and notifies nobody', () => {
  resetAccountStore();
  setAccount({ status: 'signed-in', userId: 'u1', email: 'a@b.c' });
  const before = getAccountSnapshot();
  let calls = 0;
  const unsubscribe = subscribeAccount(() => calls++);
  assert.equal(setAccount({ status: 'signed-in', userId: 'u1' }), before);
  assert.equal(setAccount({}), before);
  assert.equal(calls, 0);
  setAccount({ sync: 'syncing' });
  assert.equal(calls, 1);
  assert.notEqual(getAccountSnapshot(), before);
  unsubscribe();
  setAccount({ sync: 'synced' });
  assert.equal(calls, 1, 'no calls after unsubscribing');
});

test('becoming anonymous forgets the last account', () => {
  resetAccountStore();
  setAccount({
    status: 'signed-in',
    userId: 'u1',
    email: 'a@b.c',
    sync: 'synced',
    lastSyncedAt: '2026-09-26T10:00:00Z',
  });
  const anonymous = setAccount({ status: 'anonymous' });
  assert.deepEqual(anonymous, { ...initialAccount, status: 'anonymous' });
});

test('sync status moves on its own', () => {
  resetAccountStore();
  setAccount({ status: 'signed-in', userId: 'u1', email: 'a@b.c' });
  for (const sync of [
    'syncing',
    'synced',
    'offline',
    'error',
    'paused',
    'idle',
  ])
    assert.equal(setAccount({ sync }).sync, sync);
  assert.equal(getAccountSnapshot().userId, 'u1');
});

test('initialFor takes the first letter or digit', () => {
  assert.equal(initialFor('zainab@example.com'), 'Z');
  assert.equal(initialFor('_9lives@example.com'), '9');
  assert.equal(initialFor('ایمان@example.com'), 'ا');
  assert.equal(initialFor(''), null);
  assert.equal(initialFor(null), null);
  assert.equal(initialFor(undefined), null);
});
