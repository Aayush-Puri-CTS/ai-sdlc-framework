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

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import yaml from 'js-yaml';
// The schema declares itself as draft 2020-12; the base ajv export only
// understands draft-07, so it must be the dedicated 2020-12 build.
import Ajv2020 from 'ajv/dist/2020.js';

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
  const args = { config: 'project.config.yml' };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--config' || argv[i] === '-c') {
      args.config = argv[i + 1];
      i++;
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

// Checks the JSON Schema cannot express cleanly: cross-field/cross-item
// rules. Runs defensively — every access is guarded so a config missing
// or mis-shaping a field never throws here (the schema pass already
// reports missing/mis-shaped fields; this only adds checks schema can't).
function semanticChecks(config) {
  const errors = [];

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

function main() {
  const { config: configPath } = parseArgs(process.argv.slice(2));
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

  if (errors.length > 0) {
    fail(errors);
  }

  console.log(`✓ ${resolvedConfigPath} is valid.`);
  process.exit(0);
}

main();
