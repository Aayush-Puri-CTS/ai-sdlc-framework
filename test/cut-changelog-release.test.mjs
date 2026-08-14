// Unit coverage for scripts/cut-changelog-release.mjs, run directly
// against a scratch directory (not via the full scaffolder) since this
// script's behavior is independent of scaffolding.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FRAMEWORK_ROOT = path.join(__dirname, '..');
const SCRIPT = path.join(FRAMEWORK_ROOT, 'scripts', 'cut-changelog-release.mjs');
const CHANGELOG_TEMPLATE = path.join(FRAMEWORK_ROOT, 'templates', 'CHANGELOG.template.md');

function freshRepo() {
  const dir = mkdtempSync(path.join(tmpdir(), 'ai-sdlc-cut-changelog-test-'));
  mkdirSync(path.join(dir, 'changelog.d'), { recursive: true });
  writeFileSync(path.join(dir, 'changelog.d', 'README.md'), '# Changelog Fragments\n');
  // Strip the leading HTML comment the same way scaffold.mjs's
  // stripLeadingTemplateComment does, so this fixture matches what a
  // real scaffolded repo's CHANGELOG.md actually looks like.
  const template = readFileSync(CHANGELOG_TEMPLATE, 'utf8');
  const stripped = template.replace(/^\s*<!--[\s\S]*?-->\s*\n?/, '');
  writeFileSync(path.join(dir, 'CHANGELOG.md'), stripped);
  return dir;
}

function fragment(dir, filename, content) {
  writeFileSync(path.join(dir, 'changelog.d', filename), content + '\n');
}

function cutRelease(dir, extraArgs = []) {
  return spawnSync('node', [SCRIPT, ...extraArgs], { cwd: dir, encoding: 'utf8' });
}

test('consolidates fragments into a dated section, grouped and ordered by Keep a Changelog category', () => {
  const dir = freshRepo();
  try {
    fragment(dir, 'PROJ-102.fixed.md', 'Fix a null pointer in the session refresh path.');
    fragment(dir, 'PROJ-101.added.md', 'Add rate limiting to the login endpoint.');
    fragment(dir, 'PROJ-103.security.md', 'Patch a token-leak in debug logging.');

    const result = cutRelease(dir, ['--version', '1.0.0', '--date', '2026-08-14']);
    assert.equal(result.status, 0, result.stderr);

    const changelog = readFileSync(path.join(dir, 'CHANGELOG.md'), 'utf8');
    assert.match(changelog, /## \[1\.0\.0\] - 2026-08-14/);
    // Added, then Fixed, then Security — canonical order, not filesystem/creation order.
    const addedIdx = changelog.indexOf('### Added');
    const fixedIdx = changelog.indexOf('### Fixed');
    const securityIdx = changelog.indexOf('### Security');
    assert.ok(addedIdx > 0 && addedIdx < fixedIdx && fixedIdx < securityIdx, 'sections out of Keep a Changelog order');
    assert.match(changelog, /- \(PROJ-101\): Add rate limiting to the login endpoint\./);
    assert.match(changelog, /- \(PROJ-102\): Fix a null pointer in the session refresh path\./);
    assert.match(changelog, /- \(PROJ-103\): Patch a token-leak in debug logging\./);

    assert.deepEqual(
      readdirSync(path.join(dir, 'changelog.d')).sort(),
      ['README.md'],
      'consumed fragments should be deleted, README.md left alone'
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a second release is inserted above the first (newest on top), which is preserved untouched', () => {
  const dir = freshRepo();
  try {
    fragment(dir, 'PROJ-101.added.md', 'Add rate limiting to the login endpoint.');
    let result = cutRelease(dir, ['--version', '1.0.0', '--date', '2026-08-14']);
    assert.equal(result.status, 0, result.stderr);

    fragment(dir, 'PROJ-201.added.md', 'Add dark mode toggle.');
    result = cutRelease(dir, ['--version', '1.1.0', '--date', '2026-08-20']);
    assert.equal(result.status, 0, result.stderr);

    const changelog = readFileSync(path.join(dir, 'CHANGELOG.md'), 'utf8');
    const v110Idx = changelog.indexOf('## [1.1.0]');
    const v100Idx = changelog.indexOf('## [1.0.0]');
    assert.ok(v110Idx > 0 && v110Idx < v100Idx, 'newer release should be inserted above the older one');
    assert.match(changelog, /- \(PROJ-101\): Add rate limiting to the login endpoint\./, 'first release content was lost');
    assert.match(changelog, /- \(PROJ-201\): Add dark mode toggle\./);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('an empty changelog.d/ (only README.md) is a no-op, not an error', () => {
  const dir = freshRepo();
  try {
    const before = readFileSync(path.join(dir, 'CHANGELOG.md'), 'utf8');
    const result = cutRelease(dir, ['--version', '1.0.0', '--date', '2026-08-14']);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(readFileSync(path.join(dir, 'CHANGELOG.md'), 'utf8'), before, 'CHANGELOG.md should be untouched with nothing to release');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a malformed fragment filename blocks the whole cut without touching anything', () => {
  const dir = freshRepo();
  try {
    fragment(dir, 'PROJ-101.added.md', 'A good entry.');
    fragment(dir, 'PROJ-999.notacategory.md', 'A bad entry.');
    const before = readFileSync(path.join(dir, 'CHANGELOG.md'), 'utf8');

    const result = cutRelease(dir, ['--version', '1.0.0', '--date', '2026-08-14']);
    assert.notEqual(result.status, 0, 'a malformed fragment should fail the cut');
    assert.match(result.stderr, /notacategory/);

    assert.equal(readFileSync(path.join(dir, 'CHANGELOG.md'), 'utf8'), before, 'CHANGELOG.md should be untouched on failure');
    assert.deepEqual(
      readdirSync(path.join(dir, 'changelog.d')).sort(),
      ['PROJ-101.added.md', 'PROJ-999.notacategory.md', 'README.md'],
      'no fragment should be deleted when the cut fails'
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('an empty fragment file blocks the cut', () => {
  const dir = freshRepo();
  try {
    fragment(dir, 'PROJ-101.added.md', '');
    writeFileSync(path.join(dir, 'changelog.d', 'PROJ-101.added.md'), '   \n');
    const result = cutRelease(dir, ['--version', '1.0.0', '--date', '2026-08-14']);
    assert.notEqual(result.status, 0, 'an empty fragment should fail the cut');
    assert.match(result.stderr, /is empty/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('dies with a clear message if CHANGELOG.md does not exist', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'ai-sdlc-cut-changelog-test-'));
  try {
    mkdirSync(path.join(dir, 'changelog.d'), { recursive: true });
    fragment(dir, 'PROJ-101.added.md', 'Add rate limiting to the login endpoint.');
    const result = cutRelease(dir, ['--version', '1.0.0']);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /CHANGELOG\.md doesn't exist/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('dies without --version', () => {
  const dir = freshRepo();
  try {
    const result = cutRelease(dir, []);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /missing required --version/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
