#!/usr/bin/env node
// Vendors the AI-SDLC framework core into a consuming repo and hydrates
// its team-authored/team-supplied layers from project.config.yml
// (AI-SDLC-FRAMEWORK-SPEC.md section 9, "Automation Scaffolder").
//
// Usage:
//   node scripts/scaffold.mjs --target <path> [--template <stack>] [--skip-install] [--adopt-existing] [--with-ci] [--with-release]
//
// --template selects a starter project.config.yml from templates/stacks/
// (gradle-kotlin | xcode-swift | node-pnpm | php-laravel) and is only used the FIRST
// time — if <target>/project.config.yml already exists, it is never
// overwritten; the scaffolder re-hydrates CLAUDE.md/REVIEW.md/settings.json
// from whatever is already there instead. Re-running this script after
// editing project.config.yml is the supported way to refresh generated
// content — see the FROM_CONFIG marker convention in
// templates/CLAUDE.template.md and templates/REVIEW.template.md.
//
// Safe to run against a repo that already has its own, unrelated Claude
// Code setup: pre-existing invariant-core files (agents/hooks/etc.) are
// moved aside rather than overwritten if they differ; a pre-existing
// .claude/settings.json is merged, not replaced (foreign permission rules
// land in .claude/settings.local.json, foreign hooks are left alone); a
// pre-existing CLAUDE.md/REVIEW.md with no framework markers is refused
// by default (--adopt-existing appends instead of refusing). See
// docs/CONFORMANCE.md for the full behavior and its documented limits.
//
// --with-ci additionally vendors a GitHub Actions workflow
// (.github/workflows/ai-sdlc-validate.yml) and a named PR template
// (.github/PULL_REQUEST_TEMPLATE/ai-sdlc.md) — off by default, since CI
// wiring is a more consequential change than the rest of scaffolding.
//
// Every run also (a) writes a starter CHANGELOG.md if one doesn't already
// exist at the target's root — never touched again after that, same
// treatment as project.config.yml, since every later line in it is real
// per-repo history — (b) vendors changelog.d/README.md, the fragment-file
// convention that feeds CHANGELOG.md at release time (see
// scripts/cut-changelog-release.mjs; changelog.d/ entries are written per
// unit of work by the Coordinator, never CHANGELOG.md directly, so
// concurrent branches never conflict on the same file), and (c) adds a
// "repomix" entry to .mcp.json's mcpServers (creating the file if
// absent), only if that key isn't already there — never overwrites a
// team's own repomix configuration or touches any other server already
// listed.
//
// --with-release additionally vendors a GitHub Actions workflow
// (.github/workflows/ai-sdlc-release.yml) that runs
// scripts/cut-changelog-release.mjs on a version tag push and opens a PR
// with the result — off by default, same reasoning as --with-ci.
//
// Also vendors the repo-guide-draft skill (.claude/skills/repo-guide-draft/
// SKILL.md) and the session-handoff skill (.claude/skills/session-handoff/
// SKILL.md) unconditionally, like agents/hooks — both are inert until a
// human explicitly invokes them, so neither carries the automation/CI
// blast radius that gates --with-ci/--with-release behind a flag.
// session-handoff pairs with hooks/session-start-handoff.mjs (vendored as
// part of hooks/ and wired into settings.base.json's SessionStart group):
// the skill writes .claude/hooks/.state/HANDOFF.md, the hook surfaces it
// into a fresh session automatically.

import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync, chmodSync, cpSync, renameSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import yaml from 'js-yaml';

const FRAMEWORK_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function die(msg) {
  console.error(`scaffold: ${msg}`);
  process.exit(1);
}

function parseArgs(argv) {
  const args = { target: null, template: null, skipInstall: false, adoptExisting: false, withCi: false, withRelease: false };
  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case '--target': args.target = argv[++i]; break;
      case '--template': args.template = argv[++i]; break;
      case '--skip-install': args.skipInstall = true; break;
      case '--adopt-existing': args.adoptExisting = true; break;
      case '--with-ci': args.withCi = true; break;
      case '--with-release': args.withRelease = true; break;
      default: die(`unrecognized argument "${argv[i]}". Usage: scaffold.mjs --target <path> [--template <stack>] [--skip-install] [--adopt-existing] [--with-ci] [--with-release]`);
    }
  }
  if (!args.target) die('missing required --target <path-to-consuming-repo>.');
  return args;
}

function filesAreIdentical(a, b) {
  try {
    return readFileSync(a).equals(readFileSync(b));
  } catch {
    return false;
  }
}

// <name>.<ext> -> <name>.pre-ai-sdlc-framework.<ext> (or just appends the
// suffix if there's no extension to preserve).
function renameAsidePath(destFile) {
  const ext = path.extname(destFile);
  const base = ext ? destFile.slice(0, -ext.length) : destFile;
  return `${base}.pre-ai-sdlc-framework${ext}`;
}

// Vendors one file. Only when `isFirstAdoption` is true does this check
// for a conflict at all: if something already exists at destFile AND
// differs from what we're about to write, it's moved aside (never
// deleted) before we overwrite — this is the one moment a repo might have
// unrelated content sitting at a path this framework now owns. On every
// later run (isFirstAdoption false), this overwrites unconditionally,
// exactly like before this check existed — vendored files aren't meant to
// be permanently hand-edited, and protecting a team's post-adoption edits
// to them was never the guarantee here, only protecting whatever existed
// the moment BEFORE adoption.
function vendorFile(srcFile, destFile, { isFirstAdoption, notices, targetDir }) {
  mkdirSync(path.dirname(destFile), { recursive: true });
  if (isFirstAdoption && existsSync(destFile) && !filesAreIdentical(srcFile, destFile)) {
    const asideName = renameAsidePath(destFile);
    renameSync(destFile, asideName);
    notices.push(
      `moved aside pre-existing ${path.relative(targetDir, destFile)} -> ${path.basename(asideName)} (this framework now owns this path; your original content is preserved under that name)`
    );
  }
  cpSync(srcFile, destFile);
}

function vendorTree(srcDir, destDir, opts) {
  mkdirSync(destDir, { recursive: true });
  for (const entry of readdirSync(srcDir, { withFileTypes: true })) {
    const s = path.join(srcDir, entry.name);
    const d = path.join(destDir, entry.name);
    if (entry.isDirectory()) {
      vendorTree(s, d, opts);
    } else {
      vendorFile(s, d, opts);
    }
  }
}

// Every .sh file needs +x regardless of the source repo's own file mode
// bits (git doesn't always preserve them across clone/checkout methods).
function chmodExecutablesRecursive(dir) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      chmodExecutablesRecursive(full);
    } else if (full.endsWith('.sh')) {
      chmodSync(full, 0o755);
    }
  }
}

function renderHardRulesTable(hardRules) {
  const header = '| id | statement | audit | review_gate |\n| --- | --- | --- | --- |';
  const rows = hardRules.map((r) => `| \`${r.id}\` | ${r.statement} | \`${r.audit}\` | \`${r.review_gate}\` |`);
  return [header, ...rows].join('\n');
}

function renderTriggerList(triggers) {
  return triggers.map((t) => `- ${t}`).join('\n');
}

function renderTriggerChecklist(triggers) {
  return triggers.map((t) => `- [ ] ${t}`).join('\n');
}

function renderRuleChecklist(hardRules, gate) {
  const filtered = hardRules.filter((r) => r.review_gate === gate);
  if (filtered.length === 0) return `_(no ${gate} hard rules defined in project.config.yml)_`;
  return filtered.map((r) => `- [ ] **${r.id}** (audit: \`${r.audit}\`) — ${r.statement}`).join('\n');
}

function renderBranchPrefixesList(branchPrefixes) {
  return Object.entries(branchPrefixes)
    .map(([type, prefix]) => `- **${type}** → \`${prefix}<ticket-id>\``)
    .join('\n');
}

function renderPullRequestLabelsList(requiredLabels) {
  return requiredLabels.map((label) => `- \`${label}\``).join('\n');
}

function buildFromConfigValues(config) {
  return {
    'team.name': config.team.name,
    'stack.package_manager': config.stack.package_manager,
    'tiers.C_needs_reviewer': config.tiers.C_needs_reviewer,
    hard_rules_table: renderHardRulesTable(config.hard_rules),
    tier_d_triggers_list: renderTriggerList(config.tiers.D_triggers),
    tier_e_triggers_list: renderTriggerList(config.tiers.E_triggers),
    blocking_rules_checklist: renderRuleChecklist(config.hard_rules, 'blocking'),
    advisory_rules_checklist: renderRuleChecklist(config.hard_rules, 'advisory'),
    tier_d_triggers_checklist: renderTriggerChecklist(config.tiers.D_triggers),
    tier_e_triggers_checklist: renderTriggerChecklist(config.tiers.E_triggers),
    branch_prefixes_list: renderBranchPrefixesList(config.team.branch_prefixes),
    pull_request_labels_list: renderPullRequestLabelsList(config.pull_request.required_labels),
  };
}

// Replaces the text BETWEEN each "<!-- FROM_CONFIG:<key>:BEGIN -->" /
// "...:END -->" marker pair with the rendered value for that key, leaving
// everything else in `text` untouched. Works identically whether `text`
// came from the raw template (first run) or an already-hydrated file
// (re-run) — in both cases the markers are already present, only the
// span between them changes. TEAM_AUTHORED sections and any other prose
// a human added outside a marker pair survive by construction, since
// this never touches text outside a matched span.
//
// `values` is one shared map covering keys used across BOTH
// CLAUDE.template.md and REVIEW.template.md — any given file only
// contains markers for the subset it actually references (e.g.
// blocking_rules_checklist is REVIEW-only), so a key with no matching
// marker in THIS text is expected, not a drift error; only report drift
// via the caller's own marker-coverage check (see hydrateMarkdown).
function patchFromConfigSpans(text, values) {
  let result = text;
  for (const [key, value] of Object.entries(values)) {
    const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(
      `(<!--\\s*FROM_CONFIG:${escapedKey}:BEGIN\\s*-->)([\\s\\S]*?)(<!--\\s*FROM_CONFIG:${escapedKey}:END\\s*-->)`
    );
    if (!re.test(result)) continue;
    // Use a replacer FUNCTION, not a replacement string — `value` can be
    // an arbitrary rule statement, and a literal "$1"/"$&" inside it
    // would otherwise be reinterpreted as a backreference by
    // String.replace's special replacement-pattern syntax.
    result = result.replace(re, (_full, begin, inner, end) => {
      // Preserve whichever style the span was originally authored in:
      // inline values (team.name embedded mid-heading) had no newline
      // between their markers; block values (a table, a bullet list)
      // did. Re-hydrating an already-hydrated file must reproduce
      // whatever style it already has, not force every value onto its
      // own line.
      const wasBlock = inner.includes('\n');
      return wasBlock ? `${begin}\n${value}\n${end}` : `${begin}${value}${end}`;
    });
  }
  return result;
}

// Catches genuine drift (a template references a FROM_CONFIG key the
// scaffolder doesn't know how to render) that patchFromConfigSpans alone
// would silently ignore, since it treats "no marker for this key" as
// fine — which is only true in the OTHER direction (extra keys unused by
// this file), not this one (a marker with no corresponding value).
function assertNoUnknownMarkers(templateText, values, templatePath) {
  const found = [...templateText.matchAll(/<!--\s*FROM_CONFIG:([\w.]+):BEGIN\s*-->/g)].map((m) => m[1]);
  const unknown = found.filter((key) => !(key in values));
  if (unknown.length > 0) {
    die(`${templatePath} references FROM_CONFIG key(s) [${unknown.join(', ')}] the scaffolder doesn't render — template and scaffolder have drifted.`);
  }
}

// Every *.template.md opens with an HTML comment explaining the
// FROM_CONFIG/TEAM_AUTHORED convention to whoever edits the TEMPLATE.
// That explanation has no reason to live on forever in every team's real
// CLAUDE.md/REVIEW.md — HTML comments only render invisibly in a
// markdown *viewer*; opened in an editor or `cat`, that whole paragraph
// shows up as literal clutter. Strip only the leading comment (the one
// starting at the very top of the file, before any real content) — the
// per-field "<!-- FROM_CONFIG:key:BEGIN/END -->" markers further down
// are NOT touched by this, since they're the load-bearing anchors
// idempotent re-hydration depends on. Safe to call on already-hydrated
// output too: there's no leading comment left to strip the second time.
function stripLeadingTemplateComment(text, templatePath) {
  // Non-greedy: stops at the FIRST "-->". That's correct as long as the
  // comment's own explanatory text never contains a literal "-->" — HTML
  // comments can't be nested, so if the source template's prose
  // describes the marker syntax by writing it out literally (e.g. "wrapped
  // in <!-- FROM_CONFIG:key:BEGIN -->"), that inner "-->" closes the
  // comment early and everything after leaks into the real output. This
  // happened once already (see git history) — the assertion below turns
  // a repeat of that mistake into a loud failure instead of a silent leak.
  const match = text.match(/^\s*<!--[\s\S]*?-->\s*\n?/);
  const stripped = match ? text.slice(match[0].length) : text;
  if (!/^#\s/.test(stripped)) {
    die(`${templatePath}: after stripping the leading comment, the result doesn't start with a markdown heading — the comment likely contains a literal "-->" that closed it early. Rewrite the comment to describe marker syntax in words, not by embedding it literally.`);
  }
  return stripped;
}

function hasAnyFromConfigMarker(text) {
  return /<!--\s*FROM_CONFIG:[\w.]+:BEGIN\s*-->/.test(text);
}

// Standing invariant, checked EVERY run, not just on first adoption: if
// outPath already exists, it must carry at least one FROM_CONFIG marker,
// or patchFromConfigSpans would silently match nothing and write back the
// unchanged file while the caller reports success — exactly the bug this
// exists to prevent. This can happen post-adoption too (a bad merge
// conflict, a teammate hand-editing CLAUDE.md, a future template rename
// stripping a marker pair), so it is not gated by an isFirstAdoption flag.
function hydrateMarkdown(templatePath, outPath, values, adoptExisting, notices) {
  const templateText = readFileSync(templatePath, 'utf8');
  assertNoUnknownMarkers(templateText, values, templatePath);
  const fileName = path.basename(outPath);

  if (existsSync(outPath)) {
    const existingText = readFileSync(outPath, 'utf8');
    if (!hasAnyFromConfigMarker(existingText)) {
      if (!adoptExisting) {
        die(
          `${fileName} already exists with no FROM_CONFIG markers — it doesn't look like framework-generated output (or its markers were stripped). Refusing to modify it silently.\n` +
            `  Recommended: rename it aside (e.g. \`mv ${fileName} ${fileName.replace(/\.md$/, '')}.pre-ai-sdlc-framework.md\`) and re-run — you'll get one coherent, canonical file to repopulate by hand from the renamed copy.\n` +
            `  Faster but messier: re-run with --adopt-existing to append the framework's required sections below your existing content in the SAME file — you will need to reconcile duplicate/contradictory sections yourself.`
        );
      }
      const delimiter =
        '\n\n<!-- ai-sdlc-framework: content below this line is scaffolder-managed (see project.config.yml) — do not hand-edit past this line; review above it for now-duplicate sections. -->\n\n';
      const appended = existingText.replace(/\n+$/, '') + delimiter + stripLeadingTemplateComment(templateText, templatePath);
      const hydrated = patchFromConfigSpans(appended, values);
      mkdirSync(path.dirname(outPath), { recursive: true });
      writeFileSync(outPath, hydrated);
      notices.push(`${fileName}: framework content appended below your existing content (--adopt-existing) — review for duplicate/contradictory sections before your first task.`);
      return;
    }
  }

  const base = existsSync(outPath) ? readFileSync(outPath, 'utf8') : stripLeadingTemplateComment(templateText, templatePath);
  const hydrated = patchFromConfigSpans(base, values);
  mkdirSync(path.dirname(outPath), { recursive: true });
  writeFileSync(outPath, hydrated);
}

// permissions.* entries are plain path/command strings in project.config.yml;
// this maps them onto Claude Code's `Tool(pattern)` permission-rule syntax.
const PERMISSION_EXPANDERS = {
  '<<FROM_CONFIG:permissions.deny_read AS Read() RULES>>': (config) =>
    config.permissions.deny_read.map((p) => `Read(${p})`),
  '<<FROM_CONFIG:permissions.deny_cmd_patterns AS Bash() RULES>>': (config) =>
    config.permissions.deny_cmd_patterns.map((p) => `Bash(${p}:*)`),
  '<<FROM_CONFIG:permissions.ask_cmd_patterns AS Bash() RULES>>': (config) =>
    config.permissions.ask_cmd_patterns.map((p) => `Bash(${p}:*)`),
  '<<FROM_CONFIG:permissions.ask_write_paths AS Edit()+Write() RULES>>': (config) =>
    config.permissions.ask_write_paths.flatMap((p) => [`Edit(${p})`, `Write(${p})`]),
  '<<FROM_CONFIG:permissions.allow_write_paths AS Edit()+Write() RULES>>': (config) =>
    config.permissions.allow_write_paths.flatMap((p) => [`Edit(${p})`, `Write(${p})`]),
};

// Persisted at the top level of every settings.json this scaffolder
// writes — the one reliable, content-based signal for "did THIS framework
// generate this file already" that doesn't depend on any external state
// (unlike .claude/.ai-sdlc-version, which lives one directory up and could
// in principle go missing independently of this file).
const FRAMEWORK_SIGNATURE_KEY = '$ai_sdlc_framework_managed';

function expandPermissionsFromTemplate(templateSettings, config) {
  const result = {};
  for (const key of ['deny', 'ask', 'allow']) {
    const list = templateSettings.permissions?.[key];
    result[key] = Array.isArray(list)
      ? list.flatMap((entry) => {
          const expand = PERMISSION_EXPANDERS[entry];
          return expand ? expand(config) : [entry];
        })
      : [];
  }
  return result;
}

// Extracts the basename of whatever script a hook `command` string
// targets (e.g. '"$CLAUDE_PROJECT_DIR/.claude/hooks/verify-loop.sh"' ->
// "verify-loop.sh"), so hook-group identity can be matched on "which
// script does this run" rather than the exact command string — a future
// flag/arg change to the same script must not look like "not present"
// and produce a duplicate, stale-alongside-new hook group.
function scriptBasenameFromCommand(command) {
  if (typeof command !== 'string') return null;
  const match = command.match(/([^\s"']+\.(?:sh|mjs|js))/);
  return match ? path.basename(match[1]) : null;
}

// Merges our own hook groups (from the template) into whatever hook
// groups already exist for each event, every run (not just on first
// adoption): any existing group that targets one of OUR script basenames
// is dropped (it's a stale copy of something we own — this is how a
// future command/flag change actually propagates on re-scaffold, exactly
// like today's unconditional-overwrite behavior for a repo with no
// foreign content), then our current template groups for that event are
// appended. Any group that does NOT target one of our basenames (a
// team's own, unrelated hook) is left completely untouched. Consequence,
// stated plainly rather than left to be discovered: if a team manually
// deletes one of our shipped hook groups, it comes back on the next
// scaffold run — the same accepted trade-off this framework already
// applies to permissions.* (see docs/CONFORMANCE.md).
function mergeHooksTree(existingHooks, templateHooks) {
  const result = {};
  const allEvents = new Set([...Object.keys(existingHooks || {}), ...Object.keys(templateHooks || {})]);
  for (const event of allEvents) {
    const existingGroups = Array.isArray(existingHooks?.[event]) ? existingHooks[event] : [];
    const ourGroups = Array.isArray(templateHooks?.[event]) ? templateHooks[event] : [];
    const ourBasenames = new Set(
      ourGroups.flatMap((g) => (g.hooks || []).map((h) => scriptBasenameFromCommand(h.command)).filter(Boolean))
    );
    const foreignGroups = existingGroups.filter(
      (g) => !(g.hooks || []).some((h) => ourBasenames.has(scriptBasenameFromCommand(h.command)))
    );
    result[event] = [...foreignGroups, ...ourGroups];
  }
  return result;
}

// Anything in `entriesByKey` (permissions.deny/ask/allow entries a
// foreign settings.json had that we would NOT generate ourselves) is
// migrated into .claude/settings.local.json rather than settings.json —
// the one file this scaffolder never regenerates, so content routed here
// survives every future run unconditionally. This is the fix for a real
// bug an earlier draft of this design had: merging foreign entries
// directly into settings.json would have survived exactly one run, since
// the very next hydration fully regenerates permissions.* from
// settings.base.json + config (needed so a REMOVED config entry actually
// disappears) with no awareness of what was merged in before.
function migrateForeignPermissionsToLocalSettings(settingsLocalPath, entriesByKey, notices) {
  const hasAnything = Object.values(entriesByKey).some((arr) => arr.length > 0);
  if (!hasAnything) return;
  const existing = existsSync(settingsLocalPath) ? JSON.parse(readFileSync(settingsLocalPath, 'utf8')) : {};
  existing.permissions = existing.permissions || {};
  for (const [key, entries] of Object.entries(entriesByKey)) {
    if (entries.length === 0) continue;
    const current = Array.isArray(existing.permissions[key]) ? existing.permissions[key] : [];
    existing.permissions[key] = [...new Set([...current, ...entries])];
  }
  mkdirSync(path.dirname(settingsLocalPath), { recursive: true });
  writeFileSync(settingsLocalPath, JSON.stringify(existing, null, 2) + '\n');
  notices.push(
    `migrated pre-existing permission rule(s) that project.config.yml doesn't express into .claude/settings.local.json (never touched by this scaffolder again) — review it once.`
  );
}

// permissions.deny/ask/allow are always fully regenerated from
// settings.base.json + config, every run, foreign settings.json or not —
// reading from outPath was a real bug fixed previously (the
// <<FROM_CONFIG:...>> sentinels are consumed on first hydration, so a
// later run had nothing left to re-expand). What's NEW here is handling a
// pre-existing settings.json that ISN'T ours: detected via the absence of
// FRAMEWORK_SIGNATURE_KEY (a signal that doesn't depend on any state
// outside this one file), in which case foreign permission entries are
// migrated to settings.local.json (see above) rather than silently
// destroyed, unknown top-level keys are carried forward, and an explicit
// pre-existing `agent` choice is respected rather than overridden.
function hydrateSettings(basePath, outPath, config, notices) {
  const template = JSON.parse(readFileSync(basePath, 'utf8'));
  delete template._comment;
  const ourPermissions = expandPermissionsFromTemplate(template, config);

  let existing = null;
  if (existsSync(outPath)) {
    try {
      existing = JSON.parse(readFileSync(outPath, 'utf8'));
    } catch (err) {
      die(`.claude/settings.json exists but is not valid JSON (${err.message}) — fix or remove it by hand before scaffolding.`);
    }
  }
  const isForeign = existing !== null && !existing[FRAMEWORK_SIGNATURE_KEY];

  const result = { ...template };
  delete result._comment;

  if (isForeign) {
    const foreignToMigrate = {};
    for (const key of ['deny', 'ask', 'allow']) {
      const existingList = Array.isArray(existing.permissions?.[key]) ? existing.permissions[key] : [];
      foreignToMigrate[key] = existingList.filter((entry) => !ourPermissions[key].includes(entry));
    }
    migrateForeignPermissionsToLocalSettings(path.join(path.dirname(outPath), 'settings.local.json'), foreignToMigrate, notices);
  }

  if (existing) {
    // Safety net for anything a team added that we don't manage
    // ourselves — foreign (pre-adoption) or their own later edit
    // (post-adoption) outside what this scaffolder understands.
    const OUR_KEYS = new Set(['$schema', 'permissions', 'hooks', 'agent', FRAMEWORK_SIGNATURE_KEY]);
    for (const [key, value] of Object.entries(existing)) {
      if (!OUR_KEYS.has(key)) result[key] = value;
    }
    if (existing.agent && existing.agent !== result.agent) {
      notices.push(
        `.claude/settings.json already set "agent": "${existing.agent}" — keeping it (this framework's default is "${result.agent}"; the Coordinator-first workflow described in agents/coordinator.md may not engage automatically unless you change this yourself).`
      );
      result.agent = existing.agent;
    }
  }

  result.permissions = result.permissions || {};
  result.permissions.deny = ourPermissions.deny;
  result.permissions.ask = ourPermissions.ask;
  result.permissions.allow = ourPermissions.allow;
  result.hooks = mergeHooksTree(existing?.hooks, template.hooks);
  result[FRAMEWORK_SIGNATURE_KEY] = true;

  mkdirSync(path.dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(result, null, 2) + '\n');
}

// Single source of truth for what the vendored tooling needs at runtime
// (scripts/validate-config.mjs + every hooks/lib/*.mjs helper) — used both
// to write/patch the target's package.json AND to verify those deps are
// actually resolvable before trying to run anything that imports them.
// A stale copy of this list (previously duplicated at the node_modules
// existence check below) is exactly how minimatch got added as an import
// without scaffold.mjs learning it needed to be installed — keeping one
// list closes that class of bug, not just this one instance of it.
const REQUIRED_TOOLING_DEPS = { 'js-yaml': '^4.1.0', ajv: '^8.20.0', minimatch: '^10.0.0' };

function ensurePackageJson(targetDir) {
  const pkgPath = path.join(targetDir, 'package.json');
  if (!existsSync(pkgPath)) {
    const pkg = {
      name: path.basename(targetDir),
      private: true,
      type: 'module',
      dependencies: REQUIRED_TOOLING_DEPS,
    };
    writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
    return true;
  }
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  pkg.dependencies = pkg.dependencies || {};
  let changed = false;
  for (const [dep, version] of Object.entries(REQUIRED_TOOLING_DEPS)) {
    if (!pkg.dependencies[dep]) {
      pkg.dependencies[dep] = version;
      changed = true;
    }
  }
  if (changed) writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
  return changed;
}

function ensureChangelog(targetDir) {
  const changelogPath = path.join(targetDir, 'CHANGELOG.md');
  if (existsSync(changelogPath)) return;
  const templatePath = path.join(FRAMEWORK_ROOT, 'templates', 'CHANGELOG.template.md');
  const templateText = readFileSync(templatePath, 'utf8');
  writeFileSync(changelogPath, stripLeadingTemplateComment(templateText, templatePath));
}

// The `--mcp` flag runs Repomix as an MCP server exposing pack_codebase/
// pack_remote_repository/read_repomix_output/grep_repomix_output — useful
// for the Coordinator to pull AI-friendly context from this or another
// repo on demand (e.g. during initial adoption of a large, unfamiliar
// codebase) without a separate CLI step. `npx -y` avoids requiring a
// project-local install.
const REPOMIX_MCP_SERVER = { command: 'npx', args: ['-y', 'repomix', '--mcp'] };

// Additive only: creates .mcp.json if absent, adds the "repomix" server if
// that key isn't already present, and never touches any other server or
// top-level key a team already has there. Returns whether it wrote
// anything, so the caller can decide whether to log it.
function hydrateMcpConfig(targetDir) {
  const mcpPath = path.join(targetDir, '.mcp.json');
  let existing = {};
  if (existsSync(mcpPath)) {
    try {
      existing = JSON.parse(readFileSync(mcpPath, 'utf8'));
    } catch (err) {
      die(`.mcp.json exists but is not valid JSON (${err.message}) — fix or remove it by hand before scaffolding.`);
    }
  }
  existing.mcpServers = existing.mcpServers || {};
  if (existing.mcpServers.repomix) return false;
  existing.mcpServers.repomix = REPOMIX_MCP_SERVER;
  writeFileSync(mcpPath, JSON.stringify(existing, null, 2) + '\n');
  return true;
}

function ensureGitignore(targetDir) {
  const gitignorePath = path.join(targetDir, '.gitignore');
  const required = ['node_modules/', '.claude/hooks/.state/'];
  const existing = existsSync(gitignorePath) ? readFileSync(gitignorePath, 'utf8') : '';
  const missing = required.filter((line) => !existing.includes(line));
  if (missing.length > 0) {
    writeFileSync(gitignorePath, existing + (existing.endsWith('\n') || existing === '' ? '' : '\n') + missing.join('\n') + '\n');
  }
}

function findTeamAuthoredStubs(filePath) {
  if (!existsSync(filePath)) return [];
  const lines = readFileSync(filePath, 'utf8').split('\n');
  const hits = [];
  lines.forEach((line, i) => {
    if (line.includes('<<TEAM_AUTHORED')) hits.push(`  ${path.basename(filePath)}:${i + 1}`);
  });
  return hits;
}

// The framework repo's own current commit SHA, or "unknown" if that can't
// be determined (not a git checkout, git missing, etc. — never fatal,
// this is a diagnostic aid, not something to block scaffolding over).
function getFrameworkVersion() {
  const result = spawnSync('git', ['-C', FRAMEWORK_ROOT, 'rev-parse', 'HEAD'], {
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
  if (result.status === 0 && typeof result.stdout === 'string' && result.stdout.trim()) {
    return result.stdout.trim();
  }
  return 'unknown';
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const targetDir = path.resolve(args.target);
  mkdirSync(targetDir, { recursive: true });

  // Computed BEFORE any writes, from the pre-scaffold state only. Both
  // signals absent means this repo has never been configured for this
  // framework before — the one moment pre-existing, unrelated content
  // might be sitting at a path we're about to vendor into. project.config.yml
  // corroborates .claude/.ai-sdlc-version (rather than relying on it alone)
  // because a repo that predates version-stamping — including both of
  // this framework's own real pilot repos — would otherwise be
  // misclassified as "foreign" and have its own real files renamed aside.
  const isFirstAdoption =
    !existsSync(path.join(targetDir, '.claude', '.ai-sdlc-version')) && !existsSync(path.join(targetDir, 'project.config.yml'));
  const notices = [];
  const vendorOpts = { isFirstAdoption, notices, targetDir };

  console.log(`scaffold: vendoring framework core into ${targetDir}`);

  // 1. Vendor the invariant core — safe to overwrite once ownership is
  // established; vendorFile/vendorTree only pause to check for a conflict
  // on first adoption (see the isFirstAdoption comment above).
  vendorTree(path.join(FRAMEWORK_ROOT, 'agents'), path.join(targetDir, '.claude', 'agents'), vendorOpts);
  vendorTree(path.join(FRAMEWORK_ROOT, 'hooks'), path.join(targetDir, '.claude', 'hooks'), vendorOpts);
  chmodExecutablesRecursive(path.join(targetDir, '.claude', 'hooks'));
  vendorTree(path.join(FRAMEWORK_ROOT, 'lib', 'ticket-source'), path.join(targetDir, '.claude', 'ticket-source'), vendorOpts);
  vendorTree(
    path.join(FRAMEWORK_ROOT, 'templates', 'skills', 'repo-guide-draft'),
    path.join(targetDir, '.claude', 'skills', 'repo-guide-draft'),
    vendorOpts
  );
  vendorTree(
    path.join(FRAMEWORK_ROOT, 'templates', 'skills', 'session-handoff'),
    path.join(targetDir, '.claude', 'skills', 'session-handoff'),
    vendorOpts
  );
  vendorFile(
    path.join(FRAMEWORK_ROOT, 'templates', 'SPEC.template.md'),
    path.join(targetDir, '.claude', 'templates', 'SPEC.template.md'),
    vendorOpts
  );
  vendorFile(path.join(FRAMEWORK_ROOT, 'ADR', '0000-template.md'), path.join(targetDir, 'ADR', '0000-template.md'), vendorOpts);
  vendorFile(
    path.join(FRAMEWORK_ROOT, 'templates', 'changelog.d', 'README.md'),
    path.join(targetDir, 'changelog.d', 'README.md'),
    vendorOpts
  );
  vendorFile(
    path.join(FRAMEWORK_ROOT, 'scripts', 'validate-config.mjs'),
    path.join(targetDir, 'scripts', 'validate-config.mjs'),
    vendorOpts
  );
  vendorFile(
    path.join(FRAMEWORK_ROOT, 'scripts', 'cut-changelog-release.mjs'),
    path.join(targetDir, 'scripts', 'cut-changelog-release.mjs'),
    vendorOpts
  );
  vendorFile(
    path.join(FRAMEWORK_ROOT, 'project.config.schema.json'),
    path.join(targetDir, 'project.config.schema.json'),
    vendorOpts
  );
  if (args.withCi) {
    vendorFile(
      path.join(FRAMEWORK_ROOT, 'templates', 'github', 'ai-sdlc-validate.yml'),
      path.join(targetDir, '.github', 'workflows', 'ai-sdlc-validate.yml'),
      vendorOpts
    );
    vendorFile(
      path.join(FRAMEWORK_ROOT, 'templates', 'github', 'PULL_REQUEST_TEMPLATE.ai-sdlc.md'),
      path.join(targetDir, '.github', 'PULL_REQUEST_TEMPLATE', 'ai-sdlc.md'),
      vendorOpts
    );
  }
  if (args.withRelease) {
    vendorFile(
      path.join(FRAMEWORK_ROOT, 'templates', 'github', 'ai-sdlc-release.yml'),
      path.join(targetDir, '.github', 'workflows', 'ai-sdlc-release.yml'),
      vendorOpts
    );
  }
  // Version marker, refreshed on every run: with no version stamp
  // anywhere, two repos scaffolded from the same framework two days apart
  // silently diverged (~30-280 lines per vendored file) with no way to
  // tell without a manual file-by-file diff. A platform team compares
  // this SHA against the framework repo's own history
  // (`git -C <framework-checkout> log --oneline <this-sha>..HEAD`) to see
  // exactly how far behind a given consuming repo is — see
  // docs/CONFORMANCE.md. Not a "vendored" file subject to the
  // diff/rename-aside check above — it's our own bookkeeping, always
  // safe to overwrite outright.
  writeFileSync(path.join(targetDir, '.claude', '.ai-sdlc-version'), getFrameworkVersion() + '\n');
  mkdirSync(path.join(targetDir, 'docs', 'specs'), { recursive: true });
  mkdirSync(path.join(targetDir, 'docs', 'reviews'), { recursive: true });
  for (const dir of ['docs/specs', 'docs/reviews']) {
    const keep = path.join(targetDir, dir, '.gitkeep');
    if (!existsSync(keep)) writeFileSync(keep, '');
  }

  // 2. project.config.yml — never overwritten if it already exists.
  const configPath = path.join(targetDir, 'project.config.yml');
  if (!existsSync(configPath)) {
    if (!args.template) {
      die('no project.config.yml exists at --target and no --template was given. Pass --template <gradle-kotlin|xcode-swift|node-pnpm|php-laravel>, or hand-write project.config.yml first.');
    }
    const starterPath = path.join(FRAMEWORK_ROOT, 'templates', 'stacks', `${args.template}.config.yml`);
    if (!existsSync(starterPath)) {
      die(`no starter config for --template "${args.template}". Available: ${readdirSync(path.join(FRAMEWORK_ROOT, 'templates', 'stacks')).map((f) => f.replace('.config.yml', '')).join(', ')}`);
    }
    cpSync(starterPath, configPath);
    console.log(`scaffold: wrote starter project.config.yml from template "${args.template}" — edit CHANGE_ME values before your first task.`);
  } else {
    console.log('scaffold: project.config.yml already exists — leaving it as-is.');
  }

  // 3. CHANGELOG.md — same never-overwritten-once-present treatment as
  // project.config.yml (see ensureChangelog).
  ensureChangelog(targetDir);

  // 4. .mcp.json — additive only; see hydrateMcpConfig.
  if (hydrateMcpConfig(targetDir)) {
    console.log('scaffold: added the "repomix" MCP server to .mcp.json (npx -y repomix --mcp) — lets the Coordinator pack this or another repo into AI-friendly context on demand; edit or remove the entry if this team doesn\'t want it.');
  }

  // 5. Node tooling dependencies (needed by validate-config.mjs and every
  // hooks/lib/*.mjs helper, regardless of the team's own stack).
  const pkgChanged = ensurePackageJson(targetDir);
  ensureGitignore(targetDir);
  if (pkgChanged && !args.skipInstall) {
    console.log('scaffold: running npm install for js-yaml/ajv/minimatch...');
    // shell: true on Windows — without it, spawnSync('npm', ...) fails
    // with ENOENT there, since npm ships as npm.cmd and Node's spawn
    // doesn't resolve .cmd shims without a shell. Both real pilot repos
    // for this framework were scaffolded on Windows, where this was a
    // hard failure with no workaround short of --skip-install.
    const result = spawnSync('npm', ['install'], { cwd: targetDir, stdio: 'inherit', shell: process.platform === 'win32' });
    if (result.status !== 0) {
      die('npm install failed — fix that before continuing (or re-run with --skip-install if you will install manually).');
    }
  } else if (pkgChanged) {
    console.log('scaffold: --skip-install set — run `npm install` in the target repo before using validate-config.mjs or the hooks.');
  }

  // 6. Validate BEFORE hydrating — hydration output is only meaningful
  // against a config that already passes schema/semantic validation
  // (this also satisfies spec section 9's "executes validate-config.mjs
  // to confirm schema integrity" as a hard gate, not an afterthought).
  //
  // Check every dependency in REQUIRED_TOOLING_DEPS is actually
  // resolvable first: with --skip-install (or an npm install that failed
  // silently upstream), validate-config.mjs would otherwise crash on one
  // of its `import`s with a raw ERR_MODULE_NOT_FOUND, and the generic
  // non-zero-exit handling below would misreport that as "the config is
  // invalid" — actively wrong, and pointed at the wrong fix.
  const missingDeps = Object.keys(REQUIRED_TOOLING_DEPS).filter(
    (dep) => !existsSync(path.join(targetDir, 'node_modules', dep))
  );
  if (missingDeps.length > 0) {
    die(`${missingDeps.join('/')} ${missingDeps.length === 1 ? 'is' : 'are'} not installed in ${targetDir} — run \`npm install\` there before validate-config.mjs or the hooks can run (this is expected after --skip-install).`);
  }
  const validation = spawnSync('node', [path.join(targetDir, 'scripts', 'validate-config.mjs'), '--config', configPath], {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (validation.status !== 0) {
    die('project.config.yml failed validation — fix it and re-run the scaffolder before CLAUDE.md/REVIEW.md/settings.json will be (re)generated.');
  }

  // 7. Hydrate CLAUDE.md, REVIEW.md, settings.json from the now-valid config.
  const config = yaml.load(readFileSync(configPath, 'utf8'));
  const values = buildFromConfigValues(config);
  hydrateMarkdown(path.join(FRAMEWORK_ROOT, 'templates', 'CLAUDE.template.md'), path.join(targetDir, 'CLAUDE.md'), values, args.adoptExisting, notices);
  hydrateMarkdown(path.join(FRAMEWORK_ROOT, 'templates', 'REVIEW.template.md'), path.join(targetDir, 'REVIEW.md'), values, args.adoptExisting, notices);
  hydrateSettings(
    path.join(FRAMEWORK_ROOT, 'settings.base.json'),
    path.join(targetDir, '.claude', 'settings.json'),
    config,
    notices
  );

  console.log('scaffold: CLAUDE.md, REVIEW.md, and .claude/settings.json are hydrated.');

  // 8. Surface what still needs a human, rather than letting it hide
  // silently until someone stumbles on a stub during a real task.
  const stubs = [
    ...findTeamAuthoredStubs(path.join(targetDir, 'CLAUDE.md')),
    ...findTeamAuthoredStubs(path.join(targetDir, 'REVIEW.md')),
  ];
  if (stubs.length > 0) {
    console.log('\nscaffold: TEAM_AUTHORED sections still need to be filled in by hand:');
    console.log(stubs.join('\n'));
  }

  // 9. Anything moved aside, migrated, or appended rather than cleanly
  // written needs a human to actually look at it — surfaced distinctly
  // from the routine success line above, not buried inside it.
  if (notices.length > 0) {
    console.log('\nscaffold: heads up — this run adopted pre-existing content rather than starting clean:');
    console.log(notices.map((n) => `  - ${n}`).join('\n'));
  }

  console.log('\nscaffold: done.');
}

main();
