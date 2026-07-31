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

**Check (Implementor):** as the Implementor, attempt `git commit`,
`git push`, and a chained `<build cmd> && git commit`. All three must be
blocked by `hooks/implementor-git-guard.sh`.
**Check (Verifier):** confirm `agents/verifier.md`'s frontmatter `tools:`
list has no `Write` or `Edit` — this is enforced natively by Claude Code's
subagent tool restriction, not by a hook, so confirming the frontmatter is
the actual check.

**Pass condition:** both hold, and `project.config.yml`'s
`permissions.ask_cmd_patterns` includes `"git commit"` — see Section B
item 1 for why that entry, specifically, is load-bearing for this
guarantee under this framework's standing deployment model.

### 6. Schema Enforcement

**Check:** run `node scripts/validate-config.mjs` against a config with
(a) a hard rule missing `audit`/`review_gate`, (b) an empty
`tiers.D_triggers`, (c) a `ticket_source.read_tools` entry containing
`Create`/`Update`/`Delete`, (d) `loop_budget: 0` or `loop_budget: 6`.

**Pass condition:** all four are rejected with an actionable message and
exit code 1. (Run against this exact matrix during Phase 1 — all four
confirmed rejected.)

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

### 1. `implementor-git-guard.sh`'s scope — RESOLVED (shared-session model)

The hook cannot mechanically distinguish the Coordinator's Bash calls
from the Implementor's/Verifier's when all three share one Claude Code
settings scope (see the hook's own header comment for the two approaches
that were tried and rejected: an env var, which doesn't survive across
separate Bash tool calls, and a state file, which the same agent it's
meant to restrict could just overwrite).

**Decision:** this framework's standing model launches Implementor and
Verifier as in-process Task-tool subagents sharing the Coordinator's own
session settings (not separate headless `claude -p` invocations). The
guard therefore applies to the Coordinator too, and every starter
template ships `"git commit"` in `permissions.ask_cmd_patterns` alongside
`"git push"` — every commit requires a human's approval click, via Claude
Code's own permission engine, which is mechanically airtight regardless
of which role is asking. **Check:** confirm `ask_cmd_patterns` includes
`"git commit"` in any repo scaffolded from this framework; if it's
missing, that repo's autonomous-commit guarantee is not actually closed.

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
