// End-to-end tests for scripts/scaffold.mjs: all three stack templates
// scaffold cleanly, and — regression coverage for the settings.json
// re-hydration bug (C4) from the 2026-08-04 review-findings pass — a
// SECOND scaffold run after editing project.config.yml actually picks
// up the change, rather than silently keeping stale, already-expanded
// permission rules.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, symlinkSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FRAMEWORK_ROOT = path.join(__dirname, '..');
const SCAFFOLD_SCRIPT = path.join(FRAMEWORK_ROOT, 'scripts', 'scaffold.mjs');

// Symlinking the framework's own node_modules in (rather than running a
// real `npm install` per test) keeps this suite fast and network-free;
// --skip-install tells scaffold.mjs not to try installing itself, and its
// own dependency-presence check resolves through the symlink correctly.
function freshTargetDir() {
  const dir = mkdtempSync(path.join(tmpdir(), 'ai-sdlc-scaffold-test-'));
  symlinkSync(path.join(FRAMEWORK_ROOT, 'node_modules'), path.join(dir, 'node_modules'));
  return dir;
}

function scaffold(dir, extraArgs = []) {
  return spawnSync('node', [SCAFFOLD_SCRIPT, '--target', dir, '--skip-install', ...extraArgs], { encoding: 'utf8' });
}

for (const template of ['gradle-kotlin', 'xcode-swift', 'node-pnpm']) {
  test(`scaffolds cleanly from the ${template} template`, () => {
    const dir = freshTargetDir();
    try {
      const result = scaffold(dir, ['--template', template]);
      assert.equal(result.status, 0, result.stderr);

      for (const f of ['CLAUDE.md', 'REVIEW.md', '.claude/settings.json', 'project.config.yml', '.claude/.ai-sdlc-version', 'CHANGELOG.md', '.mcp.json']) {
        assert.ok(existsSync(path.join(dir, f)), `missing ${f}`);
      }

      const changelog = readFileSync(path.join(dir, 'CHANGELOG.md'), 'utf8');
      assert.match(changelog, /## \[Unreleased\]/, 'CHANGELOG.md missing the [Unreleased] section');

      const mcpConfig = JSON.parse(readFileSync(path.join(dir, '.mcp.json'), 'utf8'));
      assert.deepEqual(mcpConfig.mcpServers.repomix, { command: 'npx', args: ['-y', 'repomix', '--mcp'] });

      const claudeMd = readFileSync(path.join(dir, 'CLAUDE.md'), 'utf8');
      assert.doesNotMatch(claudeMd, /<<FROM_CONFIG:/, 'a bare FROM_CONFIG placeholder was left unhydrated in CLAUDE.md');
      const reviewMd = readFileSync(path.join(dir, 'REVIEW.md'), 'utf8');
      assert.doesNotMatch(reviewMd, /<<FROM_CONFIG:/, 'a bare FROM_CONFIG placeholder was left unhydrated in REVIEW.md');

      const version = readFileSync(path.join(dir, '.claude', '.ai-sdlc-version'), 'utf8').trim();
      assert.match(version, /^[0-9a-f]{40}$|^unknown$/, 'version file should be a 40-char git SHA or "unknown"');

      const settings = JSON.parse(readFileSync(path.join(dir, '.claude', 'settings.json'), 'utf8'));
      assert.ok(!('_comment' in settings), '_comment should be stripped from hydrated settings.json');
      assert.ok(!('PreToolUse' in settings.hooks), 'PreToolUse should not be wired by default (see CONFORMANCE.md item B.1)');
      assert.ok(settings.permissions.deny.includes('Edit(.claude/hooks/**)'), 'control-file deny protection missing');
      assert.ok(settings.permissions.ask.includes('Edit(project.config.yml)'), 'control-file ask protection missing');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}

test('re-scaffolding picks up a newly added ask_write_paths entry (C4 regression)', () => {
  const dir = freshTargetDir();
  try {
    let result = scaffold(dir, ['--template', 'gradle-kotlin']);
    assert.equal(result.status, 0, result.stderr);

    const configPath = path.join(dir, 'project.config.yml');
    const configText = readFileSync(configPath, 'utf8');
    const anchor = 'ask_write_paths:\n    - "**/AndroidManifest.xml"';
    assert.ok(configText.includes(anchor), 'expected ask_write_paths anchor text not found in starter config');
    writeFileSync(configPath, configText.replace(anchor, `${anchor}\n    - "**/NEWLY_ADDED_FOR_TEST.xml"`));

    result = scaffold(dir);
    assert.equal(result.status, 0, result.stderr);

    const settings = JSON.parse(readFileSync(path.join(dir, '.claude', 'settings.json'), 'utf8'));
    assert.ok(
      settings.permissions.ask.some((rule) => rule.includes('NEWLY_ADDED_FOR_TEST.xml')),
      'newly added ask_write_paths entry did not propagate on re-scaffold — the settings.json re-hydration bug has regressed'
    );
    assert.ok(
      settings.permissions.ask.some((rule) => rule.includes('AndroidManifest.xml')),
      'the pre-existing ask_write_paths entry was lost on re-scaffold'
    );
    assert.ok(
      settings.permissions.deny.includes('Edit(.claude/hooks/**)'),
      'hardcoded control-file protection was lost on re-scaffold'
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('project.config.yml is never overwritten by a second scaffold run', () => {
  const dir = freshTargetDir();
  try {
    let result = scaffold(dir, ['--template', 'node-pnpm']);
    assert.equal(result.status, 0, result.stderr);

    const configPath = path.join(dir, 'project.config.yml');
    const configText = readFileSync(configPath, 'utf8');
    writeFileSync(configPath, configText.replace('CHANGE_ME-engineering', 'a-real-team-name'));

    result = scaffold(dir);
    assert.equal(result.status, 0, result.stderr);

    const afterSecondRun = readFileSync(configPath, 'utf8');
    assert.ok(afterSecondRun.includes('a-real-team-name'), 'project.config.yml was clobbered by a second scaffold run');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('CHANGELOG.md is never overwritten by a second scaffold run', () => {
  const dir = freshTargetDir();
  try {
    let result = scaffold(dir, ['--template', 'node-pnpm']);
    assert.equal(result.status, 0, result.stderr);

    const changelogPath = path.join(dir, 'CHANGELOG.md');
    writeFileSync(changelogPath, readFileSync(changelogPath, 'utf8') + '- (PROJ-1): a real entry\n');

    result = scaffold(dir);
    assert.equal(result.status, 0, result.stderr);

    const afterSecondRun = readFileSync(changelogPath, 'utf8');
    assert.ok(afterSecondRun.includes('a real entry'), 'CHANGELOG.md was clobbered by a second scaffold run');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('.mcp.json preserves a foreign server and does not duplicate the repomix entry on re-scaffold', () => {
  const dir = freshTargetDir();
  try {
    let result = scaffold(dir, ['--template', 'node-pnpm']);
    assert.equal(result.status, 0, result.stderr);

    const mcpPath = path.join(dir, '.mcp.json');
    const mcpConfig = JSON.parse(readFileSync(mcpPath, 'utf8'));
    mcpConfig.mcpServers['other-tool'] = { command: 'foo' };
    mcpConfig.mcpServers.repomix.args = ['--custom-flag'];
    writeFileSync(mcpPath, JSON.stringify(mcpConfig, null, 2) + '\n');

    result = scaffold(dir);
    assert.equal(result.status, 0, result.stderr);

    const afterSecondRun = JSON.parse(readFileSync(mcpPath, 'utf8'));
    assert.deepEqual(afterSecondRun.mcpServers['other-tool'], { command: 'foo' }, 'foreign MCP server entry was lost on re-scaffold');
    assert.deepEqual(afterSecondRun.mcpServers.repomix.args, ['--custom-flag'], "a team's own customized repomix entry was overwritten on re-scaffold");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
