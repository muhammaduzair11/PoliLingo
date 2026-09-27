#!/usr/bin/env node
/**
 * Stops a build whose stylesheet lost part of app/globals.css.
 *
 *   npm run build
 *     -> next build, then (postbuild) node scripts/check-build-css.mjs
 *
 *   node scripts/check-build-css.mjs [dir]
 *     -> checks [dir] instead of .next/static
 *
 * A production build once shipped a stylesheet without the console and
 * account partials, although app/globals.css imports them and clean builds
 * include them. Nothing else failed, so the site went out half-styled. This
 * passes only when one stylesheet has a rule from each: .signin-card
 * (app/styles/account.css) and .console-shell (app/styles/console.css).
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const MARKERS = ['.signin-card', '.console-shell'];

/** Every .css file under dir, at any depth. */
export function stylesheets(dir) {
  return readdirSync(dir, { recursive: true })
    .map(String)
    .filter((path) => path.endsWith('.css'))
    .map((path) => join(dir, path));
}

/**
 * 'missing' when dir does not exist (nothing was built there), 'ok' when a
 * stylesheet has every marker, otherwise 'incomplete'.
 */
export function checkBuildCss(dir) {
  if (!existsSync(dir)) return { status: 'missing', files: [] };
  const files = stylesheets(dir);
  const complete = files.find((file) => {
    const css = readFileSync(file, 'utf8');
    return MARKERS.every((marker) => css.includes(marker));
  });
  return complete
    ? { status: 'ok', files, file: complete }
    : { status: 'incomplete', files };
}

function main(dir) {
  const result = checkBuildCss(dir);
  if (result.status === 'missing') {
    console.warn(`check-build-css: ${dir} does not exist, nothing to check.`);
    return 0;
  }
  if (result.status === 'ok') {
    console.log(
      `check-build-css: ok, ${result.file} has ${MARKERS.join(' and ')}.`,
    );
    return 0;
  }
  console.error(
    [
      `check-build-css: none of the ${result.files.length} stylesheet(s) in ${dir} has both ${MARKERS.join(' and ')}.`,
      'The build lost CSS that app/globals.css imports (app/styles/account.css, app/styles/console.css), so the site would ship half-styled.',
      'Build again from a clean state: delete .next locally, or redeploy on Vercel without the build cache.',
    ].join('\n'),
  );
  return 1;
}

const invoked = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : '';
if (import.meta.url === invoked) {
  process.exitCode = main(process.argv[2] ?? join('.next', 'static'));
}
