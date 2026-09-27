#!/usr/bin/env node
/**
 * Prints the latest 6-digit sign-in code the LOCAL Supabase stack emailed to
 * an address (docs/platform.md §2):
 *
 *   npm run otp -- reviewer.ps@polilingo.test
 *
 * Reads the local mail catcher on http://127.0.0.1:54324 (override with
 * POLILINGO_MAIL_URL): Mailpit's API first, then Inbucket's for older
 * stacks. Local only; it never talks to the real project.
 */

const BASE = (
  process.env.POLILINGO_MAIL_URL ?? 'http://127.0.0.1:54324'
).replace(/\/+$/, '');
const CODE = /(?<![0-9A-Za-z])([0-9]{6})(?![0-9A-Za-z])/;

async function getJson(url) {
  const response = await fetch(url, {
    headers: { accept: 'application/json' },
  });
  if (!response.ok) throw new Error(`${url} answered ${response.status}`);
  return response.json();
}

const strip = (html) => String(html ?? '').replace(/<[^>]*>/g, ' ');

function codeIn(...texts) {
  for (const text of texts) {
    const match = CODE.exec(String(text ?? ''));
    if (match) return match[1];
  }
  return null;
}

async function fromMailpit(email) {
  const query = encodeURIComponent(`to:"${email}"`);
  const found = await getJson(`${BASE}/api/v1/search?query=${query}&limit=20`);
  const messages = [...(found.messages ?? [])].sort(
    (a, b) => Date.parse(b.Created ?? 0) - Date.parse(a.Created ?? 0),
  );
  for (const summary of messages) {
    const message = await getJson(`${BASE}/api/v1/message/${summary.ID}`);
    const code = codeIn(message.Text, strip(message.HTML), summary.Snippet);
    if (code) return code;
  }
  return null;
}

async function fromInbucket(email) {
  const mailbox = encodeURIComponent(email.split('@')[0]);
  const list = await getJson(`${BASE}/api/v1/mailbox/${mailbox}`);
  const messages = [...(list ?? [])].sort(
    (a, b) => Date.parse(b.date ?? 0) - Date.parse(a.date ?? 0),
  );
  for (const summary of messages) {
    const message = await getJson(
      `${BASE}/api/v1/mailbox/${mailbox}/${summary.id}`,
    );
    const code = codeIn(message.body?.text, strip(message.body?.html));
    if (code) return code;
  }
  return null;
}

async function main() {
  const email = (process.argv[2] ?? '').trim().toLowerCase();
  if (!email.includes('@')) {
    console.error(
      'Usage: npm run otp -- <email>   (for example reviewer.ps@polilingo.test)',
    );
    process.exitCode = 2;
    return;
  }
  const errors = [];
  const readers = [
    { name: 'Mailpit', read: fromMailpit },
    { name: 'Inbucket', read: fromInbucket },
  ];
  for (const { name, read } of readers) {
    try {
      const code = await read(email);
      if (code) {
        console.log(code);
        return;
      }
    } catch (err) {
      errors.push(
        `${name}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  console.error(
    `No sign-in code found for ${email} at ${BASE}. Ask for a code in the app first, ` +
      'and check the local stack is running (npm run db:start).' +
      (errors.length ? `\n  ${errors.join('\n  ')}` : ''),
  );
  process.exitCode = 1;
}

await main();
