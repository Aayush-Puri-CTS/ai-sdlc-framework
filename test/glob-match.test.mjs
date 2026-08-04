// Regression tests for hooks/lib/glob-match.mjs — specifically the two
// real production bugs from framework-reviews/FRAMEWORK-REVIEW.md (N1: a
// brace-alternation include_glob never matched anything under the prior
// POSIX `case`-based matcher; C3: a plain `**` glob didn't match a file
// with zero intermediate directories). If either of these regress, it's
// a silent Phase-1 outage in a real repo — these must never go red
// quietly.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GLOB_MATCH = path.join(__dirname, '..', 'hooks', 'lib', 'glob-match.mjs');

function runGlobMatch(args) {
  const result = spawnSync('node', [GLOB_MATCH, ...args], { encoding: 'utf8' });
  assert.equal(result.status, 0, `glob-match.mjs exited ${result.status}: ${result.stderr}`);
  const out = {};
  for (const line of result.stdout.trim().split('\n')) {
    const [k, v] = line.split('=');
    out[k] = v;
  }
  return out;
}

test('N1 regression: brace alternation matches (src/**/*.{ts,tsx} vs src/App.tsx)', () => {
  const r = runGlobMatch(['--path', 'src/App.tsx', '--include', 'src/**/*.{ts,tsx}', '--test-pattern', 'NoMatch.kt']);
  assert.equal(r.INCLUDE_MATCH, 'true');
});

test('C3 regression: zero-depth ** matches (src/**/*.ts vs src/app.module.ts)', () => {
  const r = runGlobMatch(['--path', 'src/app.module.ts', '--include', 'src/**/*.ts', '--test-pattern', 'NoMatch.kt']);
  assert.equal(r.INCLUDE_MATCH, 'true');
});

test('deliberate non-match still does not match', () => {
  const r = runGlobMatch(['--path', 'docs/readme.md', '--include', 'src/**/*.ts', '--test-pattern', 'NoMatch.kt']);
  assert.equal(r.INCLUDE_MATCH, 'false');
});

test('dot:true preserves the prior case-statement behavior for dotfile paths', () => {
  const r = runGlobMatch(['--path', 'src/.hidden/foo.ts', '--include', 'src/**/*.ts', '--test-pattern', 'NoMatch.kt']);
  assert.equal(r.INCLUDE_MATCH, 'true');
});

test('a skip pattern is reported independently of the include match', () => {
  const r = runGlobMatch([
    '--path', 'src/generated/foo.ts',
    '--include', 'src/**/*.ts',
    '--skip', '**/generated/**',
    '--test-pattern', 'NoMatch.kt',
  ]);
  assert.equal(r.INCLUDE_MATCH, 'true');
  assert.equal(r.SKIP_MATCH, 'true');
});

test('multiple --skip flags are all considered', () => {
  const r = runGlobMatch([
    '--path', 'src/foo.md',
    '--include', 'src/**/*',
    '--skip', '**/generated/**',
    '--skip', '**/*.md',
    '--test-pattern', 'NoMatch.kt',
  ]);
  assert.equal(r.SKIP_MATCH, 'true');
});

test('test-pattern self-match: the edited file IS the test file', () => {
  const r = runGlobMatch([
    '--path', 'app/FooTest.kt',
    '--basename', 'FooTest.kt',
    '--include', 'app/**/*.kt',
    '--test-pattern', 'FooTest.kt',
  ]);
  assert.equal(r.TEST_SELF_MATCH, 'true');
});

test('test-pattern self-match is false for an unrelated basename', () => {
  const r = runGlobMatch([
    '--path', 'app/Foo.kt',
    '--basename', 'Foo.kt',
    '--include', 'app/**/*.kt',
    '--test-pattern', 'FooTest.kt',
  ]);
  assert.equal(r.TEST_SELF_MATCH, 'false');
});
