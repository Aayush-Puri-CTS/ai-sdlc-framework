// Coverage for adopting this framework into a repo that already has its
// own, unrelated Claude Code setup — CLAUDE.md/REVIEW.md, .claude/agents,
// or .claude/settings.json predating this framework entirely. Every
// scenario here mirrors one traced through by hand (and, for the
// settings.json case, caught as a real bug by an adversarial design
// review) before this suite existed; see the plan this shipped under for
// the full reasoning.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, symlinkSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FRAMEWORK_ROOT = path.join(__dirname, '..');
const SCAFFOLD_SCRIPT = path.join(FRAMEWORK_ROOT, 'scripts', 'scaffold.mjs');

function freshTargetDir() {
  const dir = mkdtempSync(path.join(tmpdir(), 'ai-sdlc-adopt-test-'));
  symlinkSync(path.join(FRAMEWORK_ROOT, 'node_modules'), path.join(dir, 'node_modules'));
  return dir;
}

function scaffold(dir, extraArgs = []) {
  return spawnSync('node', [SCAFFOLD_SCRIPT, '--target', dir, '--skip-install', ...extraArgs], { encoding: 'utf8' });
}

// --- B: invariant-core paths ---

test('B: a genuinely-diverging pre-existing agents/coordinator.md is moved aside, not overwritten', () => {
  const dir = freshTargetDir();
  try {
    mkdirSync(path.join(dir, '.claude', 'agents'), { recursive: true });
    const originalContent = '# My own unrelated coordinator notes, nothing to do with this framework\n';
    writeFileSync(path.join(dir, '.claude', 'agents', 'coordinator.md'), originalContent);

    const result = scaffold(dir, ['--template', 'gradle-kotlin']);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /moved aside pre-existing/);

    const asidePath = path.join(dir, '.claude', 'agents', 'coordinator.pre-ai-sdlc-framework.md');
    assert.ok(existsSync(asidePath), 'original file was not preserved under the expected aside name');
    assert.equal(readFileSync(asidePath, 'utf8'), originalContent);
    assert.match(readFileSync(path.join(dir, '.claude', 'agents', 'coordinator.md'), 'utf8'), /^---\nname: coordinator/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('B: re-running does not re-trigger or duplicate the aside file', () => {
  const dir = freshTargetDir();
  try {
    mkdirSync(path.join(dir, '.claude', 'agents'), { recursive: true });
    writeFileSync(path.join(dir, '.claude', 'agents', 'coordinator.md'), 'foreign content\n');

    let result = scaffold(dir, ['--template', 'gradle-kotlin']);
    assert.equal(result.status, 0, result.stderr);

    result = scaffold(dir);
    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch(result.stdout, /heads up/, 'a second run on an already-adopted repo should have nothing to report');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('B/false-positive regression: a repo with project.config.yml but no .ai-sdlc-version (predates version stamping) is NOT treated as foreign', () => {
  const dir = freshTargetDir();
  try {
    let result = scaffold(dir, ['--template', 'gradle-kotlin']);
    assert.equal(result.status, 0, result.stderr);

    // Simulate a repo that predates version-stamping (both real pilot
    // repos this framework shipped to are in exactly this state).
    rmSync(path.join(dir, '.claude', '.ai-sdlc-version'));

    result = scaffold(dir);
    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch(result.stdout, /moved aside/, 'project.config.yml presence should have prevented first-adoption misclassification');

    const coordinatorMd = readFileSync(path.join(dir, '.claude', 'agents', 'coordinator.md'), 'utf8');
    const frameworkSource = readFileSync(path.join(FRAMEWORK_ROOT, 'agents', 'coordinator.md'), 'utf8');
    assert.equal(coordinatorMd, frameworkSource, 'the repo\'s own real coordinator.md should be untouched, not renamed aside');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- C: settings.json merge ---

test('C: a foreign settings.json is merged, not replaced — foreign permissions migrate to settings.local.json, foreign hooks and top-level keys survive', () => {
  const dir = freshTargetDir();
  try {
    mkdirSync(path.join(dir, '.claude'), { recursive: true });
    writeFileSync(
      path.join(dir, '.claude', 'settings.json'),
      JSON.stringify(
        {
          agent: 'my-custom-agent',
          myCustomTopLevelKey: 'preserve-me',
          permissions: {
            deny: ['Read(.env.production)'],
            ask: ['Bash(rm:*)'],
            allow: [],
          },
          hooks: {
            PostToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo my-own-unrelated-hook' }] }],
          },
        },
        null,
        2
      )
    );

    const result = scaffold(dir, ['--template', 'gradle-kotlin']);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /migrated pre-existing permission rule/);
    assert.match(result.stdout, /already set "agent": "my-custom-agent"/);

    const settings = JSON.parse(readFileSync(path.join(dir, '.claude', 'settings.json'), 'utf8'));
    assert.equal(settings.agent, 'my-custom-agent', 'explicit pre-existing agent choice should be respected, not overridden');
    assert.equal(settings.myCustomTopLevelKey, 'preserve-me', 'unknown top-level key should be preserved');
    assert.ok(!settings.permissions.deny.includes('Read(.env.production)'), 'foreign deny entry should not land in settings.json');
    assert.ok(!settings.permissions.ask.includes('Bash(rm:*)'), 'foreign ask entry should not land in settings.json');
    assert.ok(settings.permissions.deny.includes('Edit(.claude/hooks/**)'), 'our own control-file protection should still be present');
    assert.equal(settings.hooks.PostToolUse.length, 2, 'the foreign hook group and our own should both be present');
    assert.ok(
      settings.hooks.PostToolUse.some((g) => g.hooks.some((h) => h.command === 'echo my-own-unrelated-hook')),
      'the foreign, unrelated hook group should survive untouched'
    );
    assert.equal(settings['$ai_sdlc_framework_managed'], true);

    const settingsLocal = JSON.parse(readFileSync(path.join(dir, '.claude', 'settings.local.json'), 'utf8'));
    assert.ok(settingsLocal.permissions.deny.includes('Read(.env.production)'), 'foreign deny entry should have migrated to settings.local.json');
    assert.ok(settingsLocal.permissions.ask.includes('Bash(rm:*)'), 'foreign ask entry should have migrated to settings.local.json');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('C regression: the migrated settings.local.json content survives a second scaffold run, and hooks are not duplicated', () => {
  const dir = freshTargetDir();
  try {
    mkdirSync(path.join(dir, '.claude'), { recursive: true });
    writeFileSync(
      path.join(dir, '.claude', 'settings.json'),
      JSON.stringify({ permissions: { deny: ['Read(.env.production)'], ask: [], allow: [] } }, null, 2)
    );

    let result = scaffold(dir, ['--template', 'gradle-kotlin']);
    assert.equal(result.status, 0, result.stderr);

    // Second run, no config change — the earlier draft of this design had
    // a bug where a foreign entry merged directly into settings.json on
    // run 1 was silently wiped by the unconditional full-regenerate on
    // run 2. Confirm that does NOT happen here, since migration goes to
    // settings.local.json instead, which is never regenerated.
    result = scaffold(dir);
    assert.equal(result.status, 0, result.stderr);

    const settingsLocal = JSON.parse(readFileSync(path.join(dir, '.claude', 'settings.local.json'), 'utf8'));
    assert.ok(settingsLocal.permissions.deny.includes('Read(.env.production)'), 'migrated entry must survive a second scaffold run');

    const settings = JSON.parse(readFileSync(path.join(dir, '.claude', 'settings.json'), 'utf8'));
    const postToolUseCommands = settings.hooks.PostToolUse.flatMap((g) => g.hooks.map((h) => h.command));
    const verifyLoopCount = postToolUseCommands.filter((c) => c.includes('verify-loop.sh')).length;
    assert.equal(verifyLoopCount, 1, 'our own hook group must not be duplicated across runs');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('C: a post-adoption project.config.yml edit still propagates into settings.json while settings.local.json is untouched', () => {
  const dir = freshTargetDir();
  try {
    mkdirSync(path.join(dir, '.claude'), { recursive: true });
    writeFileSync(path.join(dir, '.claude', 'settings.json'), JSON.stringify({ permissions: { deny: ['Read(.env.production)'], ask: [], allow: [] } }));

    let result = scaffold(dir, ['--template', 'gradle-kotlin']);
    assert.equal(result.status, 0, result.stderr);

    const configPath = path.join(dir, 'project.config.yml');
    const configText = readFileSync(configPath, 'utf8');
    const anchor = 'ask_write_paths:\n    - "**/AndroidManifest.xml"';
    writeFileSync(configPath, configText.replace(anchor, `${anchor}\n    - "**/AfterAdoption.xml"`));

    result = scaffold(dir);
    assert.equal(result.status, 0, result.stderr);

    const settings = JSON.parse(readFileSync(path.join(dir, '.claude', 'settings.json'), 'utf8'));
    assert.ok(settings.permissions.ask.some((r) => r.includes('AfterAdoption.xml')), 'new config entry should propagate after adoption');

    const settingsLocal = JSON.parse(readFileSync(path.join(dir, '.claude', 'settings.local.json'), 'utf8'));
    assert.deepEqual(settingsLocal.permissions.deny, ['Read(.env.production)'], 'settings.local.json should be untouched by later config edits');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- D: CLAUDE.md / REVIEW.md ---

test('D: a foreign CLAUDE.md is refused by default, left byte-for-byte untouched', () => {
  const dir = freshTargetDir();
  try {
    const original = "# My Team's Existing CLAUDE.md\n\nNothing to do with this framework.\n";
    writeFileSync(path.join(dir, 'CLAUDE.md'), original);

    const result = scaffold(dir, ['--template', 'gradle-kotlin']);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /no FROM_CONFIG markers/);
    assert.equal(readFileSync(path.join(dir, 'CLAUDE.md'), 'utf8'), original);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('D: --adopt-existing appends framework content below a delimiter, preserving the original above it', () => {
  const dir = freshTargetDir();
  try {
    const original = "# My Team's Existing CLAUDE.md\n\nNothing to do with this framework.\n";
    writeFileSync(path.join(dir, 'CLAUDE.md'), original);

    const result = scaffold(dir, ['--template', 'gradle-kotlin', '--adopt-existing']);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /framework content appended below your existing content/);

    const finalText = readFileSync(path.join(dir, 'CLAUDE.md'), 'utf8');
    assert.ok(finalText.startsWith(original.trimEnd()), 'original content must remain at the top, unchanged');
    assert.match(finalText, /FROM_CONFIG:team\.name:BEGIN/, 'framework content should be appended with its markers intact');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('D: re-scaffolding after --adopt-existing patches normally, without re-appending', () => {
  const dir = freshTargetDir();
  try {
    writeFileSync(path.join(dir, 'CLAUDE.md'), "# My Team's Existing CLAUDE.md\n");

    let result = scaffold(dir, ['--template', 'gradle-kotlin', '--adopt-existing']);
    assert.equal(result.status, 0, result.stderr);

    result = scaffold(dir);
    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch(result.stdout, /appended below/, 'a file that already has markers should patch normally, not append again');

    const finalText = readFileSync(path.join(dir, 'CLAUDE.md'), 'utf8');
    assert.equal((finalText.match(/My Team's Existing CLAUDE\.md/g) || []).length, 1, 'original heading must not be duplicated');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('D standing invariant: markers stripped post-adoption are caught even on an already-adopted repo', () => {
  const dir = freshTargetDir();
  try {
    let result = scaffold(dir, ['--template', 'node-pnpm']);
    assert.equal(result.status, 0, result.stderr);

    // Simulate a bad find/replace stripping every marker after adoption.
    const stripped = readFileSync(path.join(dir, 'CLAUDE.md'), 'utf8').replace(/<!--\s*FROM_CONFIG:[^>]*-->/g, '');
    writeFileSync(path.join(dir, 'CLAUDE.md'), stripped);

    result = scaffold(dir);
    assert.notEqual(result.status, 0, 'a repo with .ai-sdlc-version present must still be caught by the marker check, not just first-adoption repos');
    assert.match(result.stderr, /no FROM_CONFIG markers/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- --with-ci ---

test('--with-ci: absent by default, vendors both namespaced GitHub artifacts when passed', () => {
  const dir = freshTargetDir();
  try {
    let result = scaffold(dir, ['--template', 'node-pnpm']);
    assert.equal(result.status, 0, result.stderr);
    assert.ok(!existsSync(path.join(dir, '.github')), '.github should not be created without --with-ci');

    result = scaffold(dir, ['--with-ci']);
    assert.equal(result.status, 0, result.stderr);
    assert.ok(existsSync(path.join(dir, '.github', 'workflows', 'ai-sdlc-validate.yml')));
    assert.ok(existsSync(path.join(dir, '.github', 'PULL_REQUEST_TEMPLATE', 'ai-sdlc.md')));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
