// Regression tests for scripts/validate-config.mjs's semantic rules,
// including the two added in the 2026-08-04 review-findings pass (the
// git-commit/git-push/gh-pr-create ask_cmd_patterns triad, and CHANGE_ME
// placeholder rejection). The review's own conclusion was that a test
// suite would have caught these production gaps mechanically — this file
// is that suite for the config validator specifically.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FRAMEWORK_ROOT = path.join(__dirname, '..');
const VALIDATE_SCRIPT = path.join(FRAMEWORK_ROOT, 'scripts', 'validate-config.mjs');

// A minimal config satisfying every schema/semantic rule — each test
// mutates one thing away from this baseline.
function baseConfig() {
  return {
    version: 1,
    team: {
      name: 'test-team',
      git_remote: 'git@github.com:test/test.git',
      branch_prefixes: { feature: 'feat/', bug: 'bug/' },
    },
    stack: {
      package_manager: 'npm',
      lint_cmd: 'echo lint {file}',
      test_cmd: 'echo test {file}',
      extra_validate_cmd: 'echo validate',
      flags: { no_install: true },
    },
    verify_hook: {
      include_glob: 'src/**/*.ts',
      test_pattern: '{base}.test.ts',
      loop_budget: 3,
    },
    hard_rules: [{ id: 'rule-one', statement: 'A rule.', audit: 'static', review_gate: 'blocking' }],
    tiers: { D_triggers: ['trigger'], E_triggers: ['trigger'], C_needs_reviewer: 'arch-team' },
    permissions: {
      deny_read: [],
      deny_cmd_patterns: [],
      ask_cmd_patterns: ['git commit', 'git push', 'gh pr create'],
      ask_write_paths: [],
      allow_write_paths: [],
    },
    ticket_source: { type: 'manual' },
    pull_request: { required_labels: ['ai-assisted'] },
  };
}

function runValidate(configObj, extraArgs = []) {
  const dir = mkdtempSync(path.join(tmpdir(), 'ai-sdlc-validate-test-'));
  const configPath = path.join(dir, 'project.config.yml');
  writeFileSync(configPath, yaml.dump(configObj));
  try {
    return spawnSync('node', [VALIDATE_SCRIPT, '--config', configPath, ...extraArgs], { encoding: 'utf8' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('a minimal valid config passes', () => {
  const result = runValidate(baseConfig());
  assert.equal(result.status, 0, result.stderr);
});

test('every real shipped config passes validation', () => {
  for (const configPath of [
    path.join(FRAMEWORK_ROOT, 'project.config.yml'),
    path.join(FRAMEWORK_ROOT, 'templates', 'stacks', 'gradle-kotlin.config.yml'),
    path.join(FRAMEWORK_ROOT, 'templates', 'stacks', 'node-pnpm.config.yml'),
    path.join(FRAMEWORK_ROOT, 'templates', 'stacks', 'xcode-swift.config.yml'),
    path.join(FRAMEWORK_ROOT, 'templates', 'stacks', 'php-laravel.config.yml'),
  ]) {
    const result = spawnSync('node', [VALIDATE_SCRIPT, '--config', configPath], { encoding: 'utf8' });
    assert.equal(result.status, 0, `${configPath} failed:\n${result.stderr}`);
  }
});

test('rejects a config missing pull_request entirely', () => {
  const cfg = baseConfig();
  delete cfg.pull_request;
  const result = runValidate(cfg);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /pull_request/);
});

test('rejects the ai-assisted PR label being dropped', () => {
  const cfg = baseConfig();
  cfg.pull_request.required_labels = ['something-else'];
  const result = runValidate(cfg);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /ai-assisted/);
});

test('rejects gh pr create missing from ask_cmd_patterns (N2 regression)', () => {
  const cfg = baseConfig();
  cfg.permissions.ask_cmd_patterns = ['git commit', 'git push'];
  const result = runValidate(cfg);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /gh pr create/);
});

test('rejects git commit missing from ask_cmd_patterns', () => {
  const cfg = baseConfig();
  cfg.permissions.ask_cmd_patterns = ['git push', 'gh pr create'];
  const result = runValidate(cfg);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /git commit/);
});

test('rejects duplicate branch prefixes across ticket types', () => {
  const cfg = baseConfig();
  cfg.team.branch_prefixes.bug = 'feat/';
  const result = runValidate(cfg);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /duplicates/);
});

test('rejects an out-of-range loop_budget', () => {
  const cfg = baseConfig();
  cfg.verify_hook.loop_budget = 99;
  const result = runValidate(cfg);
  assert.notEqual(result.status, 0);
});

test('rejects a duplicate hard_rules id', () => {
  const cfg = baseConfig();
  cfg.hard_rules.push({ id: 'rule-one', statement: 'Same id again.', audit: 'verifier', review_gate: 'advisory' });
  const result = runValidate(cfg);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /duplicates/);
});

test('rejects a write-verbed read_tools entry for an mcp ticket source', () => {
  const cfg = baseConfig();
  cfg.ticket_source = { type: 'mcp', mcp_connector: 'X', read_tools: ['Foo_CreateItem'] };
  const result = runValidate(cfg);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /write-capable/);
});

test('CHANGE_ME (N4 regression): warns without failing by default, fails under --strict', () => {
  const cfg = baseConfig();
  cfg.team.name = 'CHANGE_ME-team';

  const warnResult = runValidate(cfg);
  assert.equal(warnResult.status, 0, warnResult.stderr);
  assert.match(warnResult.stderr, /CHANGE_ME/);

  const strictResult = runValidate(cfg, ['--strict']);
  assert.notEqual(strictResult.status, 0);
  assert.match(strictResult.stderr, /CHANGE_ME/);
});

test('non-matching include_glob (N1 smoke test): warns without failing by default, fails under --strict', () => {
  const cfg = baseConfig();
  cfg.verify_hook.include_glob = 'totally/nonexistent/**/*.xyz';

  const warnResult = runValidate(cfg);
  assert.equal(warnResult.status, 0, warnResult.stderr);
  assert.match(warnResult.stderr, /matches ZERO/);

  const strictResult = runValidate(cfg, ['--strict']);
  assert.notEqual(strictResult.status, 0);
});
