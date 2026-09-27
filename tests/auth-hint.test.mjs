// lib/auth-hint.ts: whether document.cookie holds a Supabase session, which
// decides whether a learner page loads the account runtime at all.
import test from 'node:test';
import assert from 'node:assert/strict';
import { hasSessionHint } from '../lib/auth-hint.ts';

test('a session cookie, whole or split into chunks, is a hint', () => {
  for (const cookie of [
    'sb-abcdefghijklmnop-auth-token=base64-eyJ',
    'sb-127-auth-token=x',
    'theme=light; sb-abcdefghijklmnop-auth-token=base64-eyJ',
    'a=1;sb-proj-auth-token.0=base64-part',
    'a=1; sb-proj-auth-token.12=part',
    'sb-proj-auth-token-code-verifier=v; sb-proj-auth-token.1=p',
  ])
    assert.equal(hasSessionHint(cookie), true, cookie);
});

test('no cookie, other cookies, or only a sign-in in progress is no hint', () => {
  for (const cookie of [
    '',
    'theme=light',
    'sb-proj-auth-token-code-verifier=abc',
    'sb-proj-auth-token-code-verifier.0=abc',
    'xsb-proj-auth-token=1',
    'my-sb-proj-auth-token=1',
    'sb--auth-token=1',
    'pl_age_band=18%2B; sb-proj-refresh=1',
    'value=sb-proj-auth-token=1',
  ])
    assert.equal(hasSessionHint(cookie), false, cookie);
});
