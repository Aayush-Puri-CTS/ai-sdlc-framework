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
config missing the `pull_request` section entirely).

**Pass condition:** all five are rejected with an actionable message and
exit code 1. (Cases a–d were confirmed during Phase 1; case e was added
with the PR-label governance requirement and confirmed the same way.)

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
