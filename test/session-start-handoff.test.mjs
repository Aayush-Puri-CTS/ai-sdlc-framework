// Unit coverage for hooks/session-start-handoff.mjs, run directly
// against a scratch directory standing in for $CLAUDE_PROJECT_DIR.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FRAMEWORK_ROOT = path.join(__dirname, '..');
const HOOK_SCRIPT = path.join(FRAMEWORK_ROOT, 'hooks', 'session-start-handoff.mjs');

function freshRepo() {
  return mkdtempSync(path.join(tmpdir(), 'ai-sdlc-session-handoff-test-'));
}

function runHook(repoRoot) {
  return spawnSync('node', [HOOK_SCRIPT], { encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: repoRoot } });
}

test('exits 0 with no output when no handoff file exists', () => {
  const dir = freshRepo();
  try {
    const result = runHook(dir);
    assert.equal(result.status, 0);
    assert.equal(result.stdout, '');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('emits SessionStart additionalContext JSON containing the handoff content when present', () => {
  const dir = freshRepo();
  try {
    const stateDir = path.join(dir, '.claude', 'hooks', '.state');
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(path.join(stateDir, 'HANDOFF.md'), '# Session Handoff\n\n**Branch:** feat/x\n');

    const result = runHook(dir);
    assert.equal(result.status, 0);

    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.hookSpecificOutput.hookEventName, 'SessionStart');
    assert.match(parsed.hookSpecificOutput.additionalContext, /feat\/x/);
    assert.match(
      parsed.hookSpecificOutput.additionalContext,
      /delete .claude\/hooks\/.state\/HANDOFF\.md/,
      'should instruct the reading session to clean up the file once consumed'
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('does not delete or modify HANDOFF.md after surfacing it', () => {
  const dir = freshRepo();
  try {
    const stateDir = path.join(dir, '.claude', 'hooks', '.state');
    mkdirSync(stateDir, { recursive: true });
    const handoffPath = path.join(stateDir, 'HANDOFF.md');
    const original = '# Session Handoff\n\n**Branch:** feat/x\n';
    writeFileSync(handoffPath, original);

    runHook(dir);

    assert.equal(readFileSync(handoffPath, 'utf8'), original);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('falls back to process.cwd() and does not crash if CLAUDE_PROJECT_DIR is unset', () => {
  const dir = freshRepo();
  try {
    const env = { ...process.env };
    delete env.CLAUDE_PROJECT_DIR;
    const result = spawnSync('node', [HOOK_SCRIPT], { encoding: 'utf8', cwd: dir, env });
    assert.equal(result.status, 0);
    assert.equal(result.stdout, '');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
