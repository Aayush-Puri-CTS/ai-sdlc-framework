#!/usr/bin/env node
// Vendors the AI-SDLC framework core into a consuming repo and hydrates
// its team-authored/team-supplied layers from project.config.yml
// (AI-SDLC-FRAMEWORK-SPEC.md section 9, "Automation Scaffolder").
//
// Usage:
//   node scripts/scaffold.mjs --target <path> [--template <stack>] [--skip-install]
//
// --template selects a starter project.config.yml from templates/stacks/
// (gradle-kotlin | xcode-swift | node-pnpm) and is only used the FIRST
// time — if <target>/project.config.yml already exists, it is never
// overwritten; the scaffolder re-hydrates CLAUDE.md/REVIEW.md/settings.json
// from whatever is already there instead. Re-running this script after
// editing project.config.yml is the supported way to refresh generated
// content — see the FROM_CONFIG marker convention in
// templates/CLAUDE.template.md and templates/REVIEW.template.md.

import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync, chmodSync, cpSync } from 'node:fs';
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
  const args = { target: null, template: null, skipInstall: false };
  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case '--target': args.target = argv[++i]; break;
      case '--template': args.template = argv[++i]; break;
      case '--skip-install': args.skipInstall = true; break;
      default: die(`unrecognized argument "${argv[i]}". Usage: scaffold.mjs --target <path> [--template <stack>] [--skip-install]`);
    }
  }
  if (!args.target) die('missing required --target <path-to-consuming-repo>.');
  return args;
}

function copyTree(src, dest) {
  mkdirSync(dest, { recursive: true });
  cpSync(src, dest, { recursive: true });
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

function hydrateMarkdown(templatePath, outPath, values) {
  const templateText = readFileSync(templatePath, 'utf8');
  assertNoUnknownMarkers(templateText, values, templatePath);
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

function hydrateSettings(basePath, outPath, config) {
  const source = existsSync(outPath) ? outPath : basePath;
  const settings = JSON.parse(readFileSync(source, 'utf8'));
  // Same reasoning as stripLeadingTemplateComment: settings.base.json's
  // "_comment" is documentation for whoever edits the TEMPLATE, not
  // something a team needs staring back at them in their real
  // .claude/settings.json forever. JSON has no real comment syntax, so
  // this was the least-bad way to document the template itself — but it
  // shouldn't survive into the hydrated output.
  delete settings._comment;
  for (const key of ['deny', 'ask', 'allow']) {
    const list = settings.permissions?.[key];
    if (!Array.isArray(list)) continue;
    settings.permissions[key] = list.flatMap((entry) => {
      const expand = PERMISSION_EXPANDERS[entry];
      return expand ? expand(config) : [entry];
    });
  }
  mkdirSync(path.dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(settings, null, 2) + '\n');
}

function ensurePackageJson(targetDir) {
  const pkgPath = path.join(targetDir, 'package.json');
  const requiredDeps = { 'js-yaml': '^4.1.0', ajv: '^8.20.0' };
  if (!existsSync(pkgPath)) {
    const pkg = {
      name: path.basename(targetDir),
      private: true,
      type: 'module',
      dependencies: requiredDeps,
    };
    writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
    return true;
  }
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  pkg.dependencies = pkg.dependencies || {};
  let changed = false;
  for (const [dep, version] of Object.entries(requiredDeps)) {
    if (!pkg.dependencies[dep]) {
      pkg.dependencies[dep] = version;
      changed = true;
    }
  }
  if (changed) writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
  return changed;
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

function main() {
  const args = parseArgs(process.argv.slice(2));
  const targetDir = path.resolve(args.target);
  mkdirSync(targetDir, { recursive: true });

  console.log(`scaffold: vendoring framework core into ${targetDir}`);

  // 1. Vendor the invariant core — always safe to overwrite; none of it
  // is team-authored content.
  copyTree(path.join(FRAMEWORK_ROOT, 'agents'), path.join(targetDir, '.claude', 'agents'));
  copyTree(path.join(FRAMEWORK_ROOT, 'hooks'), path.join(targetDir, '.claude', 'hooks'));
  chmodExecutablesRecursive(path.join(targetDir, '.claude', 'hooks'));
  copyTree(path.join(FRAMEWORK_ROOT, 'lib', 'ticket-source'), path.join(targetDir, '.claude', 'ticket-source'));
  mkdirSync(path.join(targetDir, '.claude', 'templates'), { recursive: true });
  cpSync(
    path.join(FRAMEWORK_ROOT, 'templates', 'SPEC.template.md'),
    path.join(targetDir, '.claude', 'templates', 'SPEC.template.md')
  );
  mkdirSync(path.join(targetDir, 'ADR'), { recursive: true });
  cpSync(path.join(FRAMEWORK_ROOT, 'ADR', '0000-template.md'), path.join(targetDir, 'ADR', '0000-template.md'));
  mkdirSync(path.join(targetDir, 'scripts'), { recursive: true });
  cpSync(path.join(FRAMEWORK_ROOT, 'scripts', 'validate-config.mjs'), path.join(targetDir, 'scripts', 'validate-config.mjs'));
  cpSync(path.join(FRAMEWORK_ROOT, 'project.config.schema.json'), path.join(targetDir, 'project.config.schema.json'));
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
      die('no project.config.yml exists at --target and no --template was given. Pass --template <gradle-kotlin|xcode-swift|node-pnpm>, or hand-write project.config.yml first.');
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

  // 3. Node tooling dependencies (needed by validate-config.mjs and every
  // hooks/lib/*.mjs helper, regardless of the team's own stack).
  const pkgChanged = ensurePackageJson(targetDir);
  ensureGitignore(targetDir);
  if (pkgChanged && !args.skipInstall) {
    console.log('scaffold: running npm install for js-yaml/ajv...');
    const result = spawnSync('npm', ['install'], { cwd: targetDir, stdio: 'inherit' });
    if (result.status !== 0) {
      die('npm install failed — fix that before continuing (or re-run with --skip-install if you will install manually).');
    }
  } else if (pkgChanged) {
    console.log('scaffold: --skip-install set — run `npm install` in the target repo before using validate-config.mjs or the hooks.');
  }

  // 4. Validate BEFORE hydrating — hydration output is only meaningful
  // against a config that already passes schema/semantic validation
  // (this also satisfies spec section 9's "executes validate-config.mjs
  // to confirm schema integrity" as a hard gate, not an afterthought).
  //
  // Check the dependency is actually resolvable first: with
  // --skip-install (or an npm install that failed silently upstream),
  // validate-config.mjs would otherwise crash on `import yaml from
  // 'js-yaml'` with a raw ERR_MODULE_NOT_FOUND, and the generic
  // non-zero-exit handling below would misreport that as "the config is
  // invalid" — actively wrong, and pointed at the wrong fix.
  if (!existsSync(path.join(targetDir, 'node_modules', 'js-yaml')) || !existsSync(path.join(targetDir, 'node_modules', 'ajv'))) {
    die(`js-yaml/ajv are not installed in ${targetDir} — run \`npm install\` there before validate-config.mjs or the hooks can run (this is expected after --skip-install).`);
  }
  const validation = spawnSync('node', [path.join(targetDir, 'scripts', 'validate-config.mjs'), '--config', configPath], {
    stdio: 'inherit',
  });
  if (validation.status !== 0) {
    die('project.config.yml failed validation — fix it and re-run the scaffolder before CLAUDE.md/REVIEW.md/settings.json will be (re)generated.');
  }

  // 5. Hydrate CLAUDE.md, REVIEW.md, settings.json from the now-valid config.
  const config = yaml.load(readFileSync(configPath, 'utf8'));
  const values = buildFromConfigValues(config);
  hydrateMarkdown(path.join(FRAMEWORK_ROOT, 'templates', 'CLAUDE.template.md'), path.join(targetDir, 'CLAUDE.md'), values);
  hydrateMarkdown(path.join(FRAMEWORK_ROOT, 'templates', 'REVIEW.template.md'), path.join(targetDir, 'REVIEW.md'), values);
  hydrateSettings(
    path.join(FRAMEWORK_ROOT, 'settings.base.json'),
    path.join(targetDir, '.claude', 'settings.json'),
    config
  );

  console.log('scaffold: CLAUDE.md, REVIEW.md, and .claude/settings.json are hydrated.');

  // 6. Surface what still needs a human, rather than letting it hide
  // silently until someone stumbles on a stub during a real task.
  const stubs = [
    ...findTeamAuthoredStubs(path.join(targetDir, 'CLAUDE.md')),
    ...findTeamAuthoredStubs(path.join(targetDir, 'REVIEW.md')),
  ];
  if (stubs.length > 0) {
    console.log('\nscaffold: TEAM_AUTHORED sections still need to be filled in by hand:');
    console.log(stubs.join('\n'));
  }

  console.log('\nscaffold: done.');
}

main();
