#!/usr/bin/env node
// Validates a team's project.config.yml against the invariant schema
// (project.config.schema.json) plus the semantic rules from
// AI-SDLC-FRAMEWORK-SPEC.md section 3 that JSON Schema cannot express
// cleanly. Used by scripts/scaffold.mjs during onboarding and by CI on
// every push, per spec section 9 "Schema Enforcement".
//
// Fail-safe contract: any problem (missing file, bad YAML, schema
// violation) exits non-zero with actionable messages. This script never
// exits 0 on a config it could not fully parse and check.

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import yaml from 'js-yaml';
// The schema declares itself as draft 2020-12; the base ajv export only
// understands draft-07, so it must be the dedicated 2020-12 build.
import Ajv2020 from 'ajv/dist/2020.js';
import { minimatch } from 'minimatch';

// Resolve the schema next to THIS file, not relative to the caller's cwd,
// so the script keeps working whether it runs inside this framework repo
// or as a copy vendored into a consuming repo (see docs/ONBOARDING.md).
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = path.join(__dirname, '..', 'project.config.schema.json');

// spec section 3, rule 7: read_tools must be read-only verbs only.
const READ_VERBS = ['Get', 'List', 'Read'];
const WRITE_VERBS = [
  'Create', 'Update', 'Delete', 'Write', 'Post', 'Put', 'Patch',
  'Remove', 'Add', 'Set', 'Modify', 'Edit', 'Push', 'Insert', 'Upsert',
];

function parseArgs(argv) {
  const args = { config: 'project.config.yml', strict: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--config' || argv[i] === '-c') {
      args.config = argv[i + 1];
      i++;
    } else if (argv[i] === '--strict') {
      args.strict = true;
    }
  }
  return args;
}

function fail(messages) {
  console.error(`\n✗ Config validation failed (${messages.length} issue${messages.length === 1 ? '' : 's'}):\n`);
  for (const m of messages) console.error(`  - ${m}`);
  console.error('\nFix the issues above and re-run: node scripts/validate-config.mjs --config <path-to-project.config.yml>\n');
  process.exit(1);
}

// Yields [dottedPath, value] for every STRING leaf anywhere in `obj`
// (arrays included, indexed numerically in the path) — used to scan the
// whole config for stray CHANGE_ME placeholders without hardcoding which
// fields might carry one.
function* walkStrings(obj, prefix = '') {
  if (typeof obj === 'string') {
    yield [prefix, obj];
    return;
  }
  if (obj === null || typeof obj !== 'object') return;
  const entries = Array.isArray(obj) ? obj.map((v, i) => [i, v]) : Object.entries(obj);
  for (const [key, value] of entries) {
    yield* walkStrings(value, prefix ? `${prefix}.${key}` : String(key));
  }
}

// Checks the JSON Schema cannot express cleanly: cross-field/cross-item
// rules. Runs defensively — every access is guarded so a config missing
// or mis-shaping a field never throws here (the schema pass already
// reports missing/mis-shaped fields; this only adds checks schema can't).
// The org-wide governance label every PR must carry so AI-assisted work is
// uniformly identifiable across every consuming repo. A team may add more
// labels, but this one is not theirs to drop — hence a hard check here
// rather than leaving it to the schema (which can't require a specific
// array member).
const REQUIRED_PR_LABEL = 'ai-assisted';

// The full triad docs/CONFORMANCE.md calls load-bearing for "no unreviewed
// commit reaches the remote" under this framework's standard shared-session
// deployment (see agents/coordinator.md's Invocation section): each of
// these must require human approval before it runs, or that guarantee has
// a hole. Found missing from two real consuming repos' configs (only
// `gh pr create` in one case) with no validator check to catch it — this
// closes that gap so it can't regress silently again.
const REQUIRED_ASK_CMD_PATTERNS = ['git commit', 'git push', 'gh pr create'];

function semanticChecks(config) {
  const errors = [];

  // Every repo must require the org-wide "ai-assisted" PR label. Checked
  // here because JSON Schema can't cleanly assert "this array must contain
  // this specific value".
  if (config?.pull_request && Array.isArray(config.pull_request.required_labels)) {
    if (!config.pull_request.required_labels.includes(REQUIRED_PR_LABEL)) {
      errors.push(
        `pull_request.required_labels must include "${REQUIRED_PR_LABEL}" — every PR the Coordinator opens must carry the org-wide AI-assisted marker. Add it (you may keep your other labels too).`
      );
    }
  }

  // Every repo must gate the full commit/push/PR triad behind human
  // approval — this is the actual mechanism closing the "no unreviewed
  // state change reaches the remote" guarantee under this framework's
  // shared-session deployment model, not any hook (see
  // agents/coordinator.md).
  if (config?.permissions && Array.isArray(config.permissions.ask_cmd_patterns)) {
    const missing = REQUIRED_ASK_CMD_PATTERNS.filter((p) => !config.permissions.ask_cmd_patterns.includes(p));
    if (missing.length > 0) {
      errors.push(
        `permissions.ask_cmd_patterns is missing ${missing.map((p) => `"${p}"`).join(', ')} — every one of ${REQUIRED_ASK_CMD_PATTERNS.map((p) => `"${p}"`).join(', ')} must require human approval, or a state change can reach the remote without review.`
      );
    }
  }

  // Duplicate hard_rules ids break traceability between REVIEW.md gates
  // and the rule that produced them.
  if (Array.isArray(config?.hard_rules)) {
    const seen = new Map();
    for (const [i, rule] of config.hard_rules.entries()) {
      const id = rule?.id;
      if (typeof id !== 'string') continue;
      if (seen.has(id)) {
        errors.push(
          `hard_rules[${i}].id ("${id}") duplicates hard_rules[${seen.get(id)}].id — every rule id must be unique.`
        );
      } else {
        seen.set(id, i);
      }
    }
  }

  // Two ticket types sharing one branch prefix defeats the point of
  // having per-type prefixes (a "bug/" branch that's indistinguishable
  // from a "feature/" one because both were configured as "feat/").
  if (config?.team?.branch_prefixes && typeof config.team.branch_prefixes === 'object') {
    const seenPrefixes = new Map();
    for (const [type, prefix] of Object.entries(config.team.branch_prefixes)) {
      if (typeof prefix !== 'string') continue;
      if (seenPrefixes.has(prefix)) {
        errors.push(
          `team.branch_prefixes.${type} ("${prefix}") duplicates team.branch_prefixes.${seenPrefixes.get(prefix)} — each ticket type needs a distinct prefix.`
        );
      } else {
        seenPrefixes.set(prefix, type);
      }
    }
  }

  // spec rule 6: if ticket_source.type == "mcp", mcp_connector and
  // read_tools must be non-empty. Enforced here (not in the JSON Schema)
  // because Ajv strict mode rejects an if/then branch requiring a
  // property not locally redeclared in that branch's own "properties".
  if (config?.ticket_source?.type === 'mcp') {
    const { mcp_connector, read_tools } = config.ticket_source;
    if (typeof mcp_connector !== 'string' || mcp_connector.length === 0) {
      errors.push('ticket_source.mcp_connector is required and must be a non-empty string when ticket_source.type is "mcp".');
    }
    if (!Array.isArray(read_tools) || read_tools.length === 0) {
      errors.push('ticket_source.read_tools must be a non-empty array when ticket_source.type is "mcp".');
    }
  }

  // read_tools must be strictly read-only verbs (spec rule 7). Checked as
  // a reject-list (any write verb substring is disqualifying) plus an
  // allow-list (must contain at least one read verb substring), because a
  // pure allow-prefix regex can't reliably cover every connector's naming
  // convention (verb can appear after a service prefix, e.g. "Jira_GetIssue").
  if (config?.ticket_source?.type === 'mcp' && Array.isArray(config.ticket_source.read_tools)) {
    for (const [i, tool] of config.ticket_source.read_tools.entries()) {
      if (typeof tool !== 'string') continue;
      const hasWriteVerb = WRITE_VERBS.some((v) => tool.includes(v));
      const hasReadVerb = READ_VERBS.some((v) => tool.includes(v));
      if (hasWriteVerb) {
        errors.push(
          `ticket_source.read_tools[${i}] ("${tool}") looks write-capable — it must not contain any of: ${WRITE_VERBS.join(', ')}.`
        );
      } else if (!hasReadVerb) {
        errors.push(
          `ticket_source.read_tools[${i}] ("${tool}") does not look read-only — it must contain one of: ${READ_VERBS.join(', ')}.`
        );
      }
    }
  }

  return errors;
}

// Skipped entirely, not just excluded from the match: no config, however
// unusual, has a legitimate reason to want these walked, and node_modules
// on a real repo can be enormous.
const SMOKE_TEST_SKIP_DIR_NAMES = new Set(['.git', 'node_modules', 'dist', 'build']);
const SMOKE_TEST_MAX_FILES = 20000;
const MINIMATCH_OPTS = { dot: true }; // must match hooks/lib/glob-match.mjs's options exactly, or this test's prediction and the hook's real behavior can disagree.

function walkFiles(dir, relBase, results) {
  if (results.length >= SMOKE_TEST_MAX_FILES) return;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return; // unreadable dir — not this check's job to report that
  }
  for (const entry of entries) {
    if (results.length >= SMOKE_TEST_MAX_FILES) return;
    if (entry.isDirectory() && SMOKE_TEST_SKIP_DIR_NAMES.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    const rel = relBase ? `${relBase}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      walkFiles(full, rel, results);
    } else if (entry.isFile()) {
      results.push(rel);
    }
  }
}

// Does verify_hook.include_glob (minus skip_globs) match ANY real file in
// this repo? A glob that matches nothing means Phase 1 lint/test silently
// never runs — exactly the bug that motivated this check (see
// AI-SDLC-FRAMEWORK-SPEC.md's CONFORMANCE notes on a brace-alternation
// glob that never matched anything under the framework's prior POSIX
// `case`-based matcher). Returns a WARNING by default (validate-config.mjs
// runs on SessionStart — hard-failing a freshly scaffolded, still-empty
// repo would block starting a session at all) and only escalates to a
// hard error under --strict, intended for a CI-specific
// invocation where a populated-but-wrong-glob repo is a much stronger
// signal than "this repo has no files yet."
function checkIncludeGlobSmokeTest(config, repoRoot, strict) {
  const includeGlob = config?.verify_hook?.include_glob;
  if (typeof includeGlob !== 'string') return { warning: null, error: null };
  const skipGlobs = Array.isArray(config?.verify_hook?.skip_globs) ? config.verify_hook.skip_globs : [];

  const files = [];
  walkFiles(repoRoot, '', files);

  if (files.length === 0) {
    // Fresh/empty repo — nothing to warn about yet, and warning here would
    // be a false positive on every brand-new scaffold.
    return { warning: null, error: null };
  }

  const matchesHookLogic = (file) =>
    minimatch(file, includeGlob, MINIMATCH_OPTS) && !skipGlobs.some((s) => minimatch(file, s, MINIMATCH_OPTS));

  if (files.some(matchesHookLogic)) return { warning: null, error: null };

  const message = `verify_hook.include_glob ("${includeGlob}") matches ZERO of the ${files.length} files scanned under ${repoRoot} (after skip_globs) — Phase 1 lint/test would never run for this repo as configured. Check the glob against the actual source tree.`;
  return strict ? { warning: null, error: message } : { warning: message, error: null };
}

// Starter templates (templates/stacks/*.config.yml) ship CHANGE_ME
// placeholders a team is expected to replace before their first task —
// and scaffold.mjs validates the config immediately after writing a
// FRESH starter, before anyone has had a chance to edit it. A hard fail
// here would break that documented first-run flow. So: WARNING by default
// (visible on every scaffold run and SessionStart until fixed — not
// silent), escalating to a hard error only under --strict, for a
// CI-specific invocation where "this got committed with placeholders
// still in it" is the real signal, not "this was scaffolded five seconds
// ago." Found live, unreplaced, and passing validation in a real
// consuming repo's committed config (team.name, tiers.C_needs_reviewer) —
// walks the WHOLE config, not just those two fields, since any string
// field could carry one.
function checkChangeMePlaceholders(config, strict) {
  const hits = [...walkStrings(config)].filter(([, value]) => /^CHANGE_ME/.test(value));
  if (hits.length === 0) return { warning: null, error: null };

  const message = hits
    .map(([dottedPath, value]) => `${dottedPath} is still a placeholder value ("${value}")`)
    .join('; ');
  return strict
    ? { warning: null, error: `${message} — replace before this can pass under --strict.` }
    : { warning: `${message} — replace with this team's real value(s) before scaffolding further.`, error: null };
}

function main() {
  const { config: configPath, strict } = parseArgs(process.argv.slice(2));
  const resolvedConfigPath = path.resolve(process.cwd(), configPath);

  if (!existsSync(resolvedConfigPath)) {
    fail([
      `Config file not found at ${resolvedConfigPath}.`,
      'Every consuming repo must have a project.config.yml at its root (or pass --config <path>).',
    ]);
  }

  let raw;
  try {
    raw = readFileSync(resolvedConfigPath, 'utf8');
  } catch (err) {
    fail([`Could not read ${resolvedConfigPath}: ${err.message}`]);
  }

  let config;
  try {
    config = yaml.load(raw);
  } catch (err) {
    fail([`${resolvedConfigPath} is not valid YAML: ${err.message}`]);
  }

  if (config === null || typeof config !== 'object' || Array.isArray(config)) {
    fail([
      `${resolvedConfigPath} did not parse to a YAML mapping (got ${config === null ? 'an empty document' : typeof config}).`,
    ]);
  }

  if (!existsSync(SCHEMA_PATH)) {
    fail([
      `Schema file not found at ${SCHEMA_PATH}.`,
      'validate-config.mjs must ship alongside project.config.schema.json — do not copy one without the other.',
    ]);
  }

  let schema;
  try {
    schema = JSON.parse(readFileSync(SCHEMA_PATH, 'utf8'));
  } catch (err) {
    fail([`Schema file at ${SCHEMA_PATH} is not valid JSON: ${err.message}`]);
  }

  const ajv = new Ajv2020({ allErrors: true, strict: true });
  const validate = ajv.compile(schema);
  const structurallyValid = validate(config);

  const errors = [];
  if (!structurallyValid) {
    for (const e of validate.errors) {
      const loc = e.instancePath || '(root)';
      const extra = e.params && Object.keys(e.params).length ? ` ${JSON.stringify(e.params)}` : '';
      errors.push(`${loc} ${e.message}${extra}`);
    }
  }

  errors.push(...semanticChecks(config));

  // Repo root is wherever project.config.yml itself lives — that's the
  // convention every other path in this framework assumes too.
  const repoRoot = path.dirname(resolvedConfigPath);
  for (const check of [checkIncludeGlobSmokeTest(config, repoRoot, strict), checkChangeMePlaceholders(config, strict)]) {
    if (check.error) errors.push(check.error);
    if (check.warning) console.warn(`\n⚠ ${check.warning}\n`);
  }

  if (errors.length > 0) {
    fail(errors);
  }

  console.log(`✓ ${resolvedConfigPath} is valid.`);
  process.exit(0);
}

main();
