/**
 * scripts/check-build-css.mjs: the post-build guard that fails a build whose
 * stylesheet lost the account and console partials.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkBuildCss } from '../scripts/check-build-css.mjs';

function withDir(files, run) {
  const dir = mkdtempSync(join(tmpdir(), 'check-build-css-'));
  try {
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(join(dir, path, '..'), { recursive: true });
      writeFileSync(join(dir, path), text);
    }
    return run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('a stylesheet with both partials passes, at any depth', () => {
  withDir(
    {
      'chunks/a.css': '.hero{color:red}',
      'chunks/deep/b.css':
        '.signin-card{padding:0}.console-shell{display:grid}',
    },
    (dir) => {
      const result = checkBuildCss(dir);
      assert.equal(result.status, 'ok');
      assert.equal(result.files.length, 2);
      assert.match(result.file, /b\.css$/);
    },
  );
});

test('the partials split across two stylesheets do not pass', () => {
  withDir(
    {
      'a.css': '.signin-card{padding:0}',
      'b.css': '.console-shell{display:grid}',
    },
    (dir) => assert.equal(checkBuildCss(dir).status, 'incomplete'),
  );
});

test('a build without the partials, or without any CSS, fails', () => {
  withDir({ 'a.css': '.hero{color:red}' }, (dir) =>
    assert.equal(checkBuildCss(dir).status, 'incomplete'),
  );
  withDir({ 'a.js': '".signin-card .console-shell"' }, (dir) =>
    assert.equal(checkBuildCss(dir).status, 'incomplete'),
  );
});

test('nothing built yet is only a warning', () => {
  assert.equal(
    checkBuildCss(join(tmpdir(), 'check-build-css-does-not-exist')).status,
    'missing',
  );
});
