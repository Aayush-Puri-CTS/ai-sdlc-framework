# Platform Conformance Checklist

A checklist a platform team can run against **any** repo that has
vendored this framework, to confirm it still upholds the framework's
guarantees. Section A is the eight criteria from
`AI-SDLC-FRAMEWORK-SPEC.md` section 9, made concretely checkable. Section
B covers limitations this build surfaced that the spec doesn't fully
resolve — check these too; a repo can satisfy every item in Section A and
still be relying on a documented, known gap from Section B.

## A. The Eight Spec Criteria

### 1. Config Binding

**Check:** In a scratch clone of the target repo, delete
`CLAUDE.md`/`REVIEW.md`/`.claude/settings.json` (but keep
`project.config.yml`), then run `node scripts/scaffold.mjs --target .`
from the framework repo. It should regenerate all three without you
editing anything but `project.config.yml`.

**Pass condition:** scaffold completes, `validate-config.mjs` passes, and
the only remaining manual work is `<<TEAM_AUTHORED:...>>` prose — never a
hook, script, or schema edit.

### 2. Domain Isolation

**Check:** `grep -riE "gradle|pnpm|jest|xcodebuild|swiftlint|npm run" agents/ hooks/ templates/*.md settings.base.json` in the framework repo itself (not a consuming repo, and not `templates/stacks/*.config.yml`, which are example starters, not core).

**Pass condition:** zero matches. Stack-specific strings may exist only
inside a team's own `project.config.yml` or `templates/stacks/*.config.yml` starters.

**Known false positive:** `hooks/verify-loop.sh`'s own header comment
names `jest`/`pnpm` as examples of what this script must *never*
hardcode — the grep will flag that line. Read it before concluding it's a
violation; it's the instruction working as intended, not a leak.

### 3. Zero Command Duplication

**Check:** In a hydrated consuming repo, `grep` `CLAUDE.md` for any
literal command string that also appears in `project.config.yml`'s
`stack.*` fields.

**Pass condition:** zero matches — `CLAUDE.md` should only ever reference
a command by its config key name (e.g. "`stack.test_cmd`"), never spell
the command out.

### 4. Fail-Safe Execution

**Check:** temporarily rename `project.config.yml` and trigger a
PostToolUse event (edit a matching file) and a Stop event in the same
session; also try with Node removed from `PATH`.

**Pass condition:** both hooks exit 2 with a clear stderr message in
every case — never exit 0, never exit silently. (This exact matrix was
run against this framework's own hooks during Phase 2 — see the
conversation history for the specific commands and outputs, or re-run
them yourself; nothing here should be taken on faith.)

### 5. Separation of Duties

**Check (state-changing git/PR requires a human):** confirm
`project.config.yml`'s `permissions.ask_cmd_patterns` includes
`"git commit"`, `"git push"`, and `"gh pr create"`, and that the hydrated
`.claude/settings.json` `ask` list contains the corresponding
`Bash(... :*)` rules. Then, as any agent, attempt `git commit` — it must
stop for a human approval prompt, not run silently.
**Check (Verifier):** confirm `agents/verifier.md`'s frontmatter `tools:`
list has no `Write` or `Edit` — this is enforced natively by Claude Code's
subagent tool restriction, so confirming the frontmatter is the actual
check.

**Pass condition:** both hold. Note this guarantee rests on the
human-approval `ask` gate, not on the git-guard hook — see Section B item
1 for why, and for the one deployment model where the hard-block hook is
additionally available.

### 6. Schema Enforcement

**Check:** run `node scripts/validate-config.mjs` against a config with
(a) a hard rule missing `audit`/`review_gate`, (b) an empty
`tiers.D_triggers`, (c) a `ticket_source.read_tools` entry containing
`Create`/`Update`/`Delete`, (d) `loop_budget: 0` or `loop_budget: 6`,
(e) a `pull_request.required_labels` that omits `ai-assisted` (or a
config missing the `pull_request` section entirely), (f)
`permissions.ask_cmd_patterns` missing any of `git commit`/`git push`/
`gh pr create`.

**Pass condition:** all six are rejected with an actionable message and
exit code 1. (Cases a–d were confirmed during Phase 1; case e was added
with the PR-label governance requirement; case f was added in the
2026-08-04 review-findings pass — see Section C.)

**Separately, run with `--strict`** against (g) a config with a
`CHANGE_ME`-prefixed string anywhere in it, (h) a config whose
`verify_hook.include_glob` matches zero files in the target repo. Both
must be rejected under `--strict`; **without** `--strict`, both must only
warn (exit 0) — this is deliberate, not a gap: `validate-config.mjs` runs
on every `SessionStart`, and a freshly scaffolded repo legitimately has
`CHANGE_ME` values and no source tree yet. Use `--strict` in CI, not in
the vendored `SessionStart` hook.

### 7. Two-Phase Verification

**Check:** confirm `hooks/verify-loop.sh` only runs `stack.lint_cmd` /
`stack.test_cmd` on PostToolUse (scoped to the single edited file) and
only runs `stack.extra_validate_cmd` on Stop/SubagentStop (whole-project).

**Pass condition:** a single file edit never triggers the broad
`extra_validate_cmd`; only ending a turn does.

### 8. End-to-End Verification

**Check:** the mobile-team worked example in `docs/ONBOARDING.md`
(`gradle-kotlin` and `xcode-swift` templates) and a backend example
(`node-pnpm`) each scaffold and validate successfully without editing
anything under this framework repo's `agents/`, `hooks/`, `templates/`,
or `scripts/`.

**Pass condition:** confirmed for all three templates during Phase 5 (see
conversation history for the actual scaffold runs and their output).

## B. Standing Decisions (Read Before Relying On This Framework)

These are points the spec left open that this build surfaced while
implementing it. Each has since been decided by the platform team — this
section records what was decided and why, so a future reader doesn't
re-litigate a settled question or mistake a deliberate trade-off for an
oversight. "Resolved" means mechanically closed; "Accepted" means a known
cost was consciously kept rather than engineered away; "Out of scope"
means deliberately not built.

### 1. How separation of duties is enforced — RESOLVED (human-approval gate, not the git-guard hook)

A PreToolUse hook cannot mechanically distinguish the Coordinator's Bash
calls from the Implementor's/Verifier's when all three share one Claude
Code settings scope (see `hooks/implementor-git-guard.sh`'s own header
comment for the two approaches that were tried and rejected: an env var,
which doesn't survive across separate Bash tool calls, and a state file,
which the same agent it's meant to restrict could just overwrite).

**Decision:** this framework's standing model launches Implementor and
Verifier as in-process Task-tool subagents sharing the Coordinator's own
session settings (not separate headless `claude -p` invocations). Since no
in-band signal can tell the roles apart in that model, the framework does
not try to — it puts every state-changing git/PR operation (`git commit`,
`git push`, `gh pr create`) in `permissions.ask_cmd_patterns`, so *each
one requires an explicit human approval click regardless of which agent
initiates it*. A human in the loop for every state change is the actual
guarantee.

Because that human-approval gate already covers every meaningful state
change, the `hooks/implementor-git-guard.sh` PreToolUse hard-block was
judged redundant in this model and is **no longer wired into
`.claude/settings.json`** (`settings.base.json` ships no `PreToolUse`
entry). The hook file is still vendored and remains useful for teams on
the **separate-process deployment model** — where Implementor/Verifier run
as their own `claude -p` invocations with their own settings scope, the
guard *can* be scoped to just those contexts and provides a true hard
block that the shared-session model can't. Such a team would add the
`PreToolUse` wiring back to the Implementor/Verifier settings scope only.

**Check:** confirm `ask_cmd_patterns` includes `"git commit"`,
`"git push"`, and `"gh pr create"` in any repo scaffolded from this
framework, and that they appear as `Bash(...:*)` rules in the hydrated
`.claude/settings.json` `ask` list; if any is missing, that repo's
human-in-the-loop guarantee for that operation is not actually closed.

### 2. `ticket_source.read_tools` least privilege — RESOLVED (enforced at the MCP authorization layer)

`scripts/validate-config.mjs` rejects a write-verbed tool name from the
*declared* `read_tools` list (spec rule 7), but that alone can't stop an
agent from calling some *other* tool a connected MCP server happens to
expose — that's a runtime behavior, not a config shape.

**Decision:** this org's MCP connectors are provisioned so that the
credentials an agent authenticates with are scoped read-only at the
platform/IT-admin level — a developer's MCP session isn't authorized for
write operations regardless of which tools are nominally exposed to the
agent. The config-time check in `validate-config.mjs` remains a useful
early/local signal (catches an obviously-wrong `read_tools` list before a
task even starts), but the actual security boundary is enforced upstream
of this framework, in connector provisioning — not something
`project.config.yml`'s schema needs to capture. **Check:** if you're
auditing a new MCP connector, confirm ITS credentials are read-only
scoped before assuming `read_tools` validation alone is protecting
anything.

### 3. Node as a tooling dependency in every consuming repo — ACCEPTED

`hooks/lib/*.mjs` and `scripts/validate-config.mjs` use `js-yaml`/`ajv`
for reliable YAML/JSON parsing — there's no portable, dependency-free
parser for either in POSIX shell. That means a pure Gradle/Kotlin or
Xcode/Swift repo now carries a `package.json`/`node_modules` purely for
framework tooling.

**Decision:** accepted as a reasonable cost. The alternative (a hand-
rolled, vendored, dependency-free YAML/JSON reader in `hooks/lib/vendor/`)
was considered and rejected — it would trade one `npm install` for
ongoing maintenance of a hand-rolled parser, which is the worse trade.
Not revisiting this without a concrete reason to.

### 4. `UserPromptSubmit` policy enforcement — OUT OF SCOPE

The spec's hook event matrix (section 4) lists `UserPromptSubmit` —
"Evaluates incoming input for policy compliance and blocks bypass
attempts" — but no such hook was requested or built; only
`verify-loop.sh` and `implementor-git-guard.sh` exist.

**Decision:** deliberately not building this. Treat as a permanent scope
exclusion, not a backlog item, unless a future concrete need reopens it.

### 5. Framework drift across consuming repos — RESOLVED (version stamping)

Two repos scaffolded from the same framework two days apart had already
diverged 30–280 lines per vendored file, with nothing recording which
framework revision either was on — the only way to discover this was a
manual file-by-file diff (which is how it was actually found).

**Decision:** `scripts/scaffold.mjs` writes `.claude/.ai-sdlc-version`
(this framework repo's `git rev-parse HEAD` at the time of the scaffold
run, or `"unknown"` if that's not determinable) on every run, first or
subsequent. This does not attempt a *live* diff against the framework's
current state — a consuming repo's session has no reliable way to reach
this framework repo. **Check:** to see how far behind a given consuming
repo is, from a checkout of this framework repo: `git log --oneline
$(cat <consuming-repo>/.claude/.ai-sdlc-version)..HEAD`. A repo predating
this fix has no `.claude/.ai-sdlc-version` file at all — treat that
absence itself as "unknown drift risk, re-scaffold to find out."

**Correction (see Section D):** `.claude/.ai-sdlc-version` absence is
*not*, on its own, "this repo has never adopted this framework" — a repo
predating this fix (including this framework's own two real pilot repos)
is in exactly that state despite being fully, legitimately adopted.
`scripts/scaffold.mjs` corroborates it with `project.config.yml`'s
presence before treating a target directory as brand new to the
framework; see Section D item 1.

### 6. Vendored hook groups in `.claude/settings.json` are permanently append-only — ACCEPTED

`hydrateSettings()` merges our own hook groups (from `settings.base.json`)
into whatever `hooks.<EventName>` array already exists, matching identity
by which script's basename a group's command targets (`verify-loop.sh`,
`validate-config.mjs`), not the exact command string — so a future flag
change to one of our own scripts still correctly replaces the stale group
rather than looking "not present" and duplicating it.

**Decision:** the practical consequence is that a team manually deleting
one of our shipped hook groups does not stay deleted — it's re-appended
on the very next scaffold run. This is the same trade-off this framework
already applies to `permissions.*` (Section C from the prior pass), not a
new kind of risk, but it has no `settings.local.json`-style escape hatch
of its own: nothing in this codebase merges hooks in from
`settings.local.json`, only permissions. **Check:** if a hook group looks
like it's "not sticking," this is why — there is currently no supported
way to permanently disable one of our shipped hooks short of forking
`settings.base.json` itself.

### 7. Pre-existing, foreign `permissions.*` content survives via `settings.local.json`, never `settings.json` — RESOLVED

An earlier design considered merging a pre-existing, non-framework
`settings.json`'s foreign `deny`/`ask`/`allow` entries directly into the
newly-hydrated `settings.json`. An adversarial design review caught the
bug before it shipped: `permissions.*` is always fully regenerated from
`settings.base.json` + `project.config.yml` on *every* run (needed so a
config entry that's later removed actually disappears) — so anything
merged straight into `settings.json` on a first "adopt this foreign file"
run would have been silently wiped by that same regeneration on the very
next run, one step later than the bug the merge was meant to fix.

**Decision:** on first encountering a `settings.json` that lacks this
framework's `$ai_sdlc_framework_managed` signature key, any of its
`permissions.*` entries we would not generate ourselves are migrated into
`.claude/settings.local.json` instead — the one file this scaffolder
never regenerates, so content routed there survives every future run
unconditionally. This is the same escape hatch already documented for a
team's own post-adoption additions; it's now also where pre-adoption
content goes. **Check:** after adopting into a repo with a pre-existing
`settings.json`, confirm any of its custom permission rules landed in
`.claude/settings.local.json`, not `.claude/settings.json`, and re-run
the scaffolder once more to confirm they're still there afterward (this
is the exact scenario the caught bug would have broken).

### 8. `--adopt-existing` produces a two-part `CLAUDE.md`/`REVIEW.md` requiring manual review — ACCEPTED

A pre-existing `CLAUDE.md`/`REVIEW.md` with no `FROM_CONFIG` markers is
refused by default (prose can't be safely auto-merged) — `--adopt-existing`
appends the framework's required sections below a delimiter instead of
refusing, so nothing existing is lost, but the two halves are not
reconciled with each other.

**Decision:** this is offered as the fast-but-messier alternative to the
recommended default (rename the existing file aside, re-run, and manually
repopulate the `<<TEAM_AUTHORED:...>>` stubs from the renamed copy into
one coherent file) — not a substitute for it. A team using
`--adopt-existing` should expect, and is told explicitly in the run's
output, to reconcile duplicate or contradictory section headings (e.g.
two `## Coding Conventions` sections) by hand. **Check:** after
`--adopt-existing`, read the resulting file once, deliberately, before
the first task — this framework won't do it for you.

### 9. Spec shape includes execution flow, function calls, rationale, and impact radius — RESOLVED

`templates/SPEC.template.md` requires four sections beyond the original
change/acceptance-criteria/scope shape: **Rationale** (the why, distinct
from "Change"'s what), **Execution Flow** (where in the running system
this change takes effect), **Function Calls** (the concrete call surface
touched), and **Impact Radius** (a concise blast-radius note — other
callers, downstream modules, backward-compatibility concerns).

**Decision:** added so the Implementor and Verifier — who, per
`lib/ticket-source/README.md`, never go back to the original ticket —
have enough structural context in the spec itself to place a change
correctly and judge its blast radius, without re-deriving either from the
codebase. Not mechanically validated (nothing schema-checks spec prose
the way `validate-config.mjs` checks `project.config.yml`); it's a
Coordinator behavioral contract, same enforcement class as the rest of
`agents/coordinator.md`. **Check:** a `docs/specs/*.md` file is missing
one of these four headings.

### 10. `CHANGELOG.md` and `.mcp.json` are vendored additively, unconditionally, every run — RESOLVED

Unlike the invariant-core paths in Section B item 6 or `project.config.yml`,
these two are not gated on `isFirstAdoption` at all — the checks that make
each one safe are already unconditional:

- **`CHANGELOG.md`** — written from `templates/CHANGELOG.template.md` only
  if the file doesn't exist yet at the target's root; if it exists (from
  any prior run, this framework's or not), it is never touched again. Same
  reasoning as `project.config.yml`: everything past the first write is
  real history, not something to regenerate.
- **`.mcp.json`** — `mcpServers.repomix` is added only if that exact key
  isn't already present; every other key, including any other MCP server
  or a team's own hand-edited `repomix` entry, is preserved untouched. No
  merge-then-regenerate step exists here the way it does for
  `settings.json`'s `permissions.*` (Section B item 7) — there is nothing
  to regenerate, since nothing here is derived from `project.config.yml`.

**Decision:** both are one-shot, additive writes with no ongoing
reconciliation logic, deliberately simpler than the `settings.json`/
`CLAUDE.md` machinery — neither file's content is generated from
`project.config.yml`, so there is no "does this match what we'd currently
generate" question to answer on re-scaffold, only "does this key already
exist." **Check:** hand-edit both files in a scaffolded repo, re-run the
scaffolder, and confirm neither edit is lost
(`test/scaffold.test.mjs`: "CHANGELOG.md is never overwritten..." and
"`.mcp.json` preserves a foreign server...").

## C. Fixes applied 2026-08-04 (`framework-reviews/FRAMEWORK-REVIEW.md`)

A review cross-checked against two real consuming repos found several
guarantees this framework documents as mechanically enforced were not, in
production. Fixed on branch `fix/framework-review-2026-08-04`, in
severity order:

- **Command injection (critical).** `hooks/verify-loop.sh`'s `{file}`/
  `{base}` substitution reached `eval` with no shell-quoting — an
  agent-controlled filename containing `;`, `$(...)`, or backticks
  executed as shell code. Fixed with a `shell_quote()` helper (mirroring
  `hooks/lib/config-reader.mjs`'s `shQuote()`) applied only to the
  `eval`-bound substitution path, not the glob/filesystem-check path
  (quoting that one would have broken co-located-test detection for every
  real config, since no real `test_pattern` uses wildcards).
- **Glob engine replacement (critical).** POSIX `case` patterns don't
  support brace alternation at all and don't implement minimatch's
  globstar semantics — verified as a total, silent Phase-1 outage in a
  real repo whose `include_glob` used `{ts,tsx}`. Replaced with
  `hooks/lib/glob-match.mjs` (the `minimatch` package, `dot: true` to
  preserve prior matching behavior for dotfiles), collapsed into one
  `node` subprocess call per edited file. `scripts/validate-config.mjs`
  now also smoke-tests `include_glob` against the real repo tree (warn by
  default, `--strict` to hard-fail — see Section A item 6).
- **Framework control files unprotected (critical).** Nothing stopped an
  Implementor from editing `.claude/hooks/**`, `.claude/settings.json`,
  or `.claude/agents/**` directly, silently disabling every other
  guarantee. `settings.base.json` now hard-`deny`s all three, and `ask`s
  (human approval, not hard-deny — teams legitimately edit these during
  onboarding) `project.config.yml`/`project.config.schema.json`.
- **`gh pr create` triad + `CHANGE_ME` placeholders (high).** See Section
  A item 6 cases (f)–(h). Both real repos were missing `gh pr create`
  from `ask_cmd_patterns` with no validator check to catch it; one
  shipped unreplaced `CHANGE_ME` values to a committed config.
- **`settings.json` re-hydration bug (high).** `hydrateSettings()` read
  from the already-hydrated output file if one existed — but the
  `<<FROM_CONFIG:...>>` sentinels are consumed on first hydration, so a
  second scaffold run could never pick up a newly-added
  `ask_write_paths`/etc. entry. Fixed to always regenerate from
  `settings.base.json`; anything a team needs outside
  `project.config.yml`'s schema belongs in `.claude/settings.local.json`
  instead.
- **Version stamping (high).** See Section B item 5.
- **Windows `spawnSync` failures (medium).** Both real pilot repos were
  scaffolded on Windows; `spawnSync('npm', ...)` without `shell: true`
  fails there (`npm.cmd` isn't resolved without a shell). Fixed on every
  `spawnSync` call in `scripts/scaffold.mjs`.
- **Minimal test suite (partial, ongoing).** `test/` (Node's built-in
  `node:test`) covers the config validator's rules and the exact
  brace-glob / zero-depth-`**` cases from the review, so these specific
  regressions can't reappear silently.

Explicitly **not** addressed in this pass (see the review doc and the
approved plan for the full reasoning): Phase-2 per-turn budget, binding
`audit: static` rules to an actual check command, `docs/reviews/` usage,
mechanical (vs. prompt-only) Tier D/E enforcement, and a full CI/
CHANGELOG/CONTRIBUTING/LICENSE setup for this repo. The two real
consuming repos (`registration-backend`, `registration-frontend`) were
**not** edited directly — not reachable from the environment this fix was
authored in; each needs `git commit`/`gh pr create` added to
`ask_cmd_patterns` (verify with `--strict` after re-scaffolding), and
`registration-frontend` additionally needs its `CHANGE_ME` values
replaced. Re-scaffolding either (`node scripts/scaffold.mjs --target
<path>`, no `--template` needed) picks up every fix above and gets a
version stamp for the first time.

## D. Fixes applied — safe adoption into pre-existing content

Before this pass, `scripts/scaffold.mjs` assumed every path it wrote to
was either empty or already framework-owned — three ways that broke,
roughly in order of how bad the failure was:

- **`.claude/agents/**`, `.claude/hooks/**`, `.claude/ticket-source/**`,
  `.claude/templates/**`, `ADR/0000-template.md`,
  `project.config.schema.json`, `scripts/validate-config.mjs`** were
  vendored via `cpSync(..., {recursive: true})`, whose default
  `force: true` silently overwrites anything already at that path.
- **`.claude/settings.json`** was always fully regenerated from
  `settings.base.json` with zero awareness of whether a pre-existing file
  was ours or a team's own, unrelated Claude Code config.
- **`CLAUDE.md`/`REVIEW.md`**: a pre-existing file with no `FROM_CONFIG`
  markers silently received no framework content at all while the run
  still reported success.

Fixed:

1. **First-adoption detection** — `isFirstAdoption` requires BOTH
  `.claude/.ai-sdlc-version` AND `project.config.yml` to be absent (see
  Section B item 5's correction above); this specifically avoids
  misclassifying an already-adopted repo that predates version-stamping.
2. **Invariant-core paths** — on first adoption only, a pre-existing file
  at one of these paths is compared byte-for-byte against what would be
  vendored; if identical, overwritten silently (not a conflict); if
  different, moved aside to `<name>.pre-ai-sdlc-framework.<ext>` (never
  deleted) before vendoring ours in its place. On every later run,
  unconditional overwrite, exactly as before this fix — this safety net
  protects whatever existed the moment *before* adoption, not a team's
  later hand-edits to a vendored file.
3. **`.claude/settings.json` merge** — see Section B items 6–7.
4. **`CLAUDE.md`/`REVIEW.md`** — see Section B item 8. The marker-presence
  check is a standing invariant (runs every scaffold, not just on first
  adoption), since the underlying bug (markers absent -> silent no-op) can
  happen post-adoption too.
5. **`--with-ci` (new, opt-in, default off)** — vendors
  `.github/workflows/ai-sdlc-validate.yml` (runs
  `validate-config.mjs --strict` on push/PR — the CI posture is strict,
  the local `SessionStart` posture is warn-only, deliberately) and
  `.github/PULL_REQUEST_TEMPLATE/ai-sdlc.md` (a *named* template, so it
  never replaces or collides with a repo's own default PR template). Off
  by default because CI wiring is more consequential than the rest of
  scaffolding — an explicit choice, not a silent addition.

**Check:** `test/adopt-existing.test.mjs` exercises every scenario above,
including the exact false-positive (item 1) and the exact silent-wipe bug
(item 3, Section B item 7) an adversarial design review caught before
either shipped — read that file's test names for the full list rather
than re-deriving the scenarios by hand.
