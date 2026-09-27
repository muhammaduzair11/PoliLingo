// The lines learner pages never cross (docs/platform.md 4.5): no learner
// file imports Supabase, the RPC helper or the console; the account runtime
// is reached only through a dynamic import after a session cookie is seen;
// the proxy runs only on console, account and invitation routes; and no
// service-role or secret key appears anywhere in the app.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const posix = (path) => path.split(sep).join('/');
const rel = (path) => posix(relative(ROOT, path));
const read = (path) => readFileSync(join(ROOT, path), 'utf8');

function walk(dir, keep) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full, keep));
    else if (keep(full)) out.push(full);
  }
  return out;
}

const SOURCE = /\.(?:ts|tsx|mts|js|mjs|jsx)$/;

/** Learner files, as docs/platform.md 4.5 scopes them. */
function learnerFiles() {
  const components = readdirSync(join(ROOT, 'components'))
    .filter((name) => /\.tsx?$/.test(name))
    .map((name) => join(ROOT, 'components', name));
  const appExcluded = new Set([
    '(console)',
    'account',
    'sign-in',
    'auth',
    'invite',
    'api',
  ]);
  const app = walk(join(ROOT, 'app'), (f) => SOURCE.test(f)).filter(
    (f) => !appExcluded.has(rel(f).split('/')[1]),
  );
  const lib = walk(join(ROOT, 'lib'), (f) => SOURCE.test(f)).filter((f) => {
    const path = rel(f);
    return (
      !path.startsWith('lib/supabase/') &&
      !path.startsWith('lib/console/') &&
      path !== 'lib/rpc.ts'
    );
  });
  return [...components, ...app, ...lib];
}

/** Every module specifier a file imports, statically or dynamically. */
function specifiers(source) {
  const found = [];
  for (const pattern of [
    /\bfrom\s*['"]([^'"]+)['"]/g,
    /\bimport\s*['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ])
    for (const match of source.matchAll(pattern)) found.push(match[1]);
  return found;
}

/** A specifier as a repository path (lib/rpc), or itself for a package. */
function target(file, specifier) {
  if (specifier.startsWith('@/')) return specifier.slice(2);
  if (specifier.startsWith('.')) return rel(resolve(dirname(file), specifier));
  return specifier;
}

const FORBIDDEN = [
  [/^@supabase\//, 'a Supabase package'],
  [/^lib\/supabase(?:\/|$)/, 'lib/supabase'],
  [/^lib\/rpc(?:\.ts)?$/, 'lib/rpc.ts'],
  [/^lib\/console(?:\/|$)/, 'the console libraries'],
  [/^components\/console(?:\/|$)/, 'the console kit'],
];

test('the learner scan covers the learner surfaces', () => {
  const files = learnerFiles().map(rel);
  for (const expected of [
    'components/home.tsx',
    'components/learning-provider.tsx',
    'components/account-boot.tsx',
    'app/page.tsx',
    'app/layout.tsx',
    'app/settings/page.tsx',
    'lib/content.ts',
    'lib/progress.ts',
    'lib/release-cache.ts',
  ])
    assert.ok(files.includes(expected), `${expected} is scanned`);
  for (const file of files)
    assert.doesNotMatch(
      file,
      /^components\/(account|console|ui)\/|^app\/\(console\)|^lib\/(supabase|console)\/|^lib\/rpc\.ts$/,
    );
});

test('no learner file imports Supabase, the RPC helper or the console', () => {
  const offences = [];
  for (const file of learnerFiles()) {
    const source = readFileSync(file, 'utf8');
    for (const specifier of specifiers(source)) {
      const path = target(file, specifier);
      for (const [pattern, what] of FORBIDDEN)
        if (pattern.test(path))
          offences.push(`${rel(file)} imports ${what} (${specifier})`);
    }
  }
  assert.deepEqual(offences, []);
  // .env.example explains the rule in prose, so only its variables are checked.
  const names = [
    ...read('.env.example').matchAll(/^\s*#?\s*([A-Z][A-Z0-9_]*)=/gm),
  ].map((m) => m[1]);
  assert.ok(names.includes('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'));
  assert.deepEqual(
    names.filter((n) => /SERVICE_ROLE|SECRET|PRIVATE_KEY|PASSWORD/.test(n)),
    [],
  );
});

test('the import scan itself sees every form of import', () => {
  const file = join(ROOT, 'components', 'x.tsx');
  const found = specifiers(`
    import a from '@supabase/ssr';
    import { b } from "../lib/rpc";
    import type { C } from '@/lib/supabase/env';
    import '@/lib/console/access';
    const d = await import('../lib/supabase/browser');
    export { e } from './console/shell';
  `).map((s) => target(file, s));
  assert.deepEqual(found, [
    '@supabase/ssr',
    'lib/rpc',
    'lib/supabase/env',
    'components/console/shell',
    'lib/console/access',
    'lib/supabase/browser',
  ]);
  for (const path of found)
    assert.ok(
      FORBIDDEN.some(([pattern]) => pattern.test(path)),
      `${path} is caught`,
    );
});

test('account-boot loads the account runtime only through a dynamic import', () => {
  const source = read('components/account-boot.tsx');
  assert.match(source, /\bimport\(\s*['"]\.\/account\/runtime['"]\s*\)/);
  const statics = [...source.matchAll(/\bfrom\s*['"]([^'"]+)['"]/g)].map(
    (m) => m[1],
  );
  assert.deepEqual(
    statics.filter((s) => /account\/|supabase|rpc/.test(s)),
    [],
  );
  // The layout mounts it inside the provider.
  const layout = read('app/layout.tsx');
  assert.match(
    layout,
    /<LearningProvider>[\s\S]*<AccountBoot \/>[\s\S]*<\/LearningProvider>/,
  );
});

test("proxy.ts's matcher is a literal holding only the console, account and invitation prefixes", () => {
  const source = read('proxy.ts');
  assert.match(source, /export async function proxy\(/);
  const match = source.match(
    /export const config = \{\s*matcher:\s*\[([^\]]*)\]/,
  );
  assert.ok(match, 'config.matcher is an array literal');
  const entries = [...match[1].matchAll(/'([^']*)'/g)].map((m) => m[1]);
  assert.deepEqual(entries.sort(), [
    '/account/:path*',
    '/admin/:path*',
    '/edit/:path*',
    '/invite/:path*',
    '/review/:path*',
  ]);
  for (const learner of [
    '/',
    '/learn',
    '/lesson',
    '/onboarding',
    '/settings',
    '/sign-in',
    '/auth',
  ])
    assert.ok(
      !entries.some(
        (e) =>
          e === learner || (e.startsWith(`${learner}/`) && learner !== '/'),
      ),
      `${learner} never runs the proxy`,
    );
  assert.equal(existsSync(join(ROOT, 'middleware.ts')), false);
});

test('Supabase settings are read literally, and only the two public ones', () => {
  const env = read('lib/supabase/env.ts');
  assert.match(env, /process\.env\.NEXT_PUBLIC_SUPABASE_URL\b/);
  assert.match(env, /process\.env\.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY\b/);
  const example = read('.env.example');
  const names = [...example.matchAll(/^([A-Z][A-Z0-9_]*)=/gm)].map((m) => m[1]);
  assert.ok(names.includes('NEXT_PUBLIC_SUPABASE_URL'));
  assert.ok(names.includes('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'));
  assert.deepEqual(names.filter((n) => /SUPABASE/.test(n)).sort(), [
    'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
    'NEXT_PUBLIC_SUPABASE_URL',
  ]);
});

test('no service-role or secret key anywhere in the app', () => {
  const files = [
    ...walk(join(ROOT, 'app'), (f) => SOURCE.test(f)),
    ...walk(join(ROOT, 'components'), (f) => SOURCE.test(f)),
    ...walk(join(ROOT, 'lib'), (f) => SOURCE.test(f)),
    ...walk(join(ROOT, 'hooks'), (f) => SOURCE.test(f)),
    join(ROOT, 'proxy.ts'),
    join(ROOT, 'next.config.ts'),
  ];
  const offences = [];
  for (const file of files) {
    if (!existsSync(file)) continue;
    const source = readFileSync(file, 'utf8');
    for (const pattern of [
      /SERVICE_ROLE/,
      /service_role/,
      /SUPABASE_SECRET/,
      /sb_secret_/,
      /process\.env\.[A-Z0-9_]*(?:SECRET|PRIVATE)/,
    ])
      if (pattern.test(source)) offences.push(`${rel(file)}: ${pattern}`);
  }
  assert.deepEqual(offences, []);
});
