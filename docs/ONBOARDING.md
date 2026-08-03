# Onboarding a New Team

This is the "adopt this in a day" guide. It walks through onboarding a
mobile team end-to-end — both the Android/Gradle side and the iOS/Xcode
side, since "mobile team" usually means both — but every step generalizes
to any stack. If you're onboarding a web or backend team, use
`--template node-pnpm` instead and skip the platform-specific asides.

## Distribution Model

This framework is distributed as a **vendored scaffolder**, not an npm
package: teams clone/checkout `ai-sdlc-framework` itself and run
`node scripts/scaffold.mjs --target <their-repo>` from inside it. There
is no `npm install ai-sdlc-framework` step, and a consuming repo never
takes this framework repo on as a runtime dependency — the scaffolder
only ever *copies* files out of it. Keep that model in mind if you're
scripting adoption across many teams (e.g. a CI job that checks out this
repo fresh and scaffolds N target repos in a loop) rather than trying to
publish this as a package.

## Prerequisites

- Node.js (any recent LTS) — required for `scripts/validate-config.mjs`
  and every `hooks/lib/*.mjs` helper, **even if your repo is otherwise
  pure Gradle/Kotlin or Xcode/Swift with no other Node dependency**. This
  is a real, known adoption cost for non-Node stacks — see
  `docs/CONFORMANCE.md` for why it exists and what the alternative would
  cost.
- A checkout of this framework repo (`ai-sdlc-framework`) somewhere on
  your machine — the scaffolder is run FROM it, targeting your repo.
- Your repo initialized as a git repo (the scaffolder doesn't require
  this, but the framework's separation-of-duties guarantees assume normal
  git usage downstream).
- The GitHub CLI (`gh`), authenticated (`gh auth login`) — the
  Coordinator opens the single per-unit-of-work PR (mandate step 7 in
  `agents/coordinator.md`) via `gh`. Without it, the pipeline runs right
  up to the PR step and then stalls there. `gh pr create` is a remote
  operation, so like `git push`/`git commit` it lands under
  `permissions.ask_cmd_patterns` — expect a human approval click when the
  Coordinator opens the PR. Every PR is labeled with each entry in
  `pull_request.required_labels` (the org-wide `ai-assisted` marker is
  mandatory and enforced by `validate-config.mjs`). Create these labels in
  the GitHub repo once during setup — `gh label create ai-assisted
  --description "Opened via the AI-SDLC framework" --color 5319E7` — so the
  first PR doesn't stall on a missing label (the Coordinator will also
  create a missing label on the fly, but pre-creating it keeps the color/
  description consistent across the repo).

## Step 1 — Run the scaffolder

From the framework repo, targeting your repo:

```sh
node scripts/scaffold.mjs --target /path/to/your-mobile-android-repo --template gradle-kotlin
node scripts/scaffold.mjs --target /path/to/your-mobile-ios-repo --template xcode-swift
```

(Run once per repo — if Android and iOS are separate repos, as is
typical, scaffold each independently. If they're one monorepo, pick
whichever template matches more of the repo and hand-adjust the other
half's globs afterward.)

This:
1. Vendors `agents/`, `hooks/`, `lib/ticket-source/`, and the spec/ADR
   templates into `.claude/` and `ADR/` in your repo.
2. Writes a starter `project.config.yml` (only if one doesn't already
   exist — it will never overwrite yours on a second run).
3. Installs `js-yaml`/`ajv` (`npm install`) so the tooling actually runs.
4. Validates the config and hydrates `CLAUDE.md`, `REVIEW.md`, and
   `.claude/settings.json` from it.
5. Prints every `<<TEAM_AUTHORED:...>>` stub still waiting on a human.

## Step 2 — Edit `project.config.yml`

The starter config has `CHANGE_ME` placeholders — replace all of them.
For the Android repo, that's things like:

```yaml
team:
  name: "mobile-android-engineering"
  git_remote: "git@github.com:enterprise/mobile-android.git"
tiers:
  C_needs_reviewer: "mobile-android-architecture-team"
```

Two things the starter template already gets right, worth pointing out
explicitly since they're easy to accidentally weaken:

- **Secrets stay denied by default.** `permissions.deny_read` already
  includes `**/*.keystore`, `**/*.p12`, `**/secrets/**`, `.env*` for
  Android (and `**/*.p12`, `**/*.mobileprovision` for iOS). Don't narrow
  this list without a specific reason, and if you add a new secret file
  type this repo uses, add it here.
- **A public API contract change is already a Tier D trigger.** Both
  starter templates ship `"public API contract change"` in
  `tiers.D_triggers` — meaning an agent hits a hard stop and requires an
  approved ADR before touching a public API shape, on day one, without
  you having to remember to add it.

Re-run the scaffolder after editing the config — it's idempotent (see
`templates/CLAUDE.template.md`'s marker convention) and will refresh
`CLAUDE.md`/`REVIEW.md`/`settings.json` without touching anything you've
since written by hand:

```sh
node scripts/scaffold.mjs --target /path/to/your-mobile-android-repo
```

(No `--template` needed once `project.config.yml` exists.)

## Step 3 — Fill in `CLAUDE.md`'s `TEAM_AUTHORED` sections

The scaffolder's final output lists exactly which lines still need a
human. At minimum, write:

- **Architecture Overview** — for Android, this is where you'd note e.g.
  "single-module app, MVVM, Hilt for DI." For iOS, "SwiftUI + Composable
  Architecture" or whatever actually applies. The framework has no
  opinion here on purpose.
- **Escalation Contacts** — who gets paged on a Tier D/E stop. Don't
  leave this blank; an agent halting on Tier D needs to know who to tell.

## Step 4 — Know how git/PR operations are gated

This framework's standing deployment model launches Implementor and
Verifier as **in-process Task-tool subagents sharing the Coordinator's
own session settings** — not as separate headless `claude -p`
invocations. That's a deliberate choice, not a per-team decision to make;
don't try to run a repo in the separate-process model instead.

The consequence: no hook or permission rule can tell "the Coordinator's
Bash call" apart from "the Implementor's Bash call" when all three share
one settings scope. So the framework doesn't try to — instead, every
state-changing git/PR operation (`git commit`, `git push`, `gh pr create`)
is in `permissions.ask_cmd_patterns`, meaning **each one stops for a human
approval click regardless of which agent initiates it**. A human in the
loop for every state change is the separation-of-duties guarantee here.
Don't remove any of those three from `ask_cmd_patterns` thinking they're
redundant — they *are* the mechanism.

(The framework also vendors `hooks/implementor-git-guard.sh`, a
PreToolUse hard-block git-guard, but it is **not wired into
`.claude/settings.json`** by default — the human-approval gate above makes
it redundant in the shared-session model. It stays available for teams who
run the separate-process model and want a true hard block scoped to the
Implementor/Verifier contexts; see `docs/CONFORMANCE.md` item B.1.)

## Step 5 — Wire (or defer) the ticket source

`project.config.yml`'s `ticket_source.type` defaults to `"manual"` in
every starter template — the Coordinator asks a human to paste ticket
text, every time, until you configure otherwise. This is a safe, fully
functional default; wiring an MCP connector is an optimization you can
do later, not a blocker to starting.

To wire one: see `lib/ticket-source/adapters/mcp.md` for the generic
contract, or `lib/ticket-source/adapters/zoho.md` for a concrete worked
example if your team uses Zoho Sprints. Update `ticket_source` in
`project.config.yml` accordingly and re-run the scaffolder.

## Step 6 — Run a first task

1. Give the Coordinator a ticket reference (or paste one, if using the
   manual adapter).
2. It should write `docs/specs/<feature>.md` (check it against
   `templates/SPEC.template.md`'s shape) and classify a tier.
3. It delegates to the Implementor, which writes code +
   `verify_hook.include_glob`-matching tests; `hooks/verify-loop.sh`
   should fire automatically after each edit.
4. It delegates to the Verifier, which re-runs `stack.lint_cmd` /
   `stack.test_cmd` and returns PASS/FAIL.
5. On PASS, the Coordinator commits. On FAIL, it re-delegates with the
   Verifier's report.

If step 3's hook never seems to fire, revisit Step 4 above before assuming
something else is broken. On step 5, expect a human-approval prompt on the
commit (and again on `git push` / `gh pr create`) — that prompt is the
gate working as designed, not an error.

## Common Early Friction

- **"Why does my pure-Gradle repo need `package.json`/`node_modules`?"**
  See the Prerequisites note above and `docs/CONFORMANCE.md`.
- **A file gets blocked repeatedly by `verify-loop.sh`.** After
  `verify_hook.loop_budget` consecutive failures (default 3), blocking
  stops and the file is logged to
  `.claude/hooks/.state/needs-human-review.log` instead — check there.
- **A commit / push / PR keeps prompting for approval.** That's the
  separation-of-duties gate (Step 4): `git commit`, `git push`, and
  `gh pr create` are in `permissions.ask_cmd_patterns` and require a human
  click every time, by design. If you want a *harder* block that also
  stops the Implementor from even attempting other git writes, that's the
  optional `hooks/implementor-git-guard.sh` hard-block hook — not wired by
  default; see `docs/CONFORMANCE.md` item B.1 for when to enable it.
