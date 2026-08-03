# AI-SDLC Framework

An opinionated, reusable framework for AI-assisted software delivery,
built around a Coordinator/Implementor/Verifier split with mechanically
enforced separation of duties, config-driven governance hooks, and an
autonomy-tier ladder. See `AI-SDLC-FRAMEWORK-SPEC.md` for the full,
authoritative specification — everything in this repo implements it.

Distributed as a **vendored scaffolder**, not an npm package: teams
clone this repo and run `scripts/scaffold.mjs` against their own repo,
which copies the framework core in and generates their team-specific
config and rulebooks. There is no runtime dependency on this repo from a
consuming repo after scaffolding.

## Three layers

| Layer | What it is | Lives in |
| --- | --- | --- |
| **Invariant core** | Hook contracts, permission shape, tier ladder, rule taxonomy, schema validators — identical across every team | `agents/`, `hooks/`, `templates/`, `settings.base.json`, `scripts/` (this repo) |
| **Team-authored content** | The actual hard-rule statements, architecture notes, conventions | `CLAUDE.md` / `REVIEW.md` in a consuming repo (generated from `templates/*.template.md`) |
| **Team-supplied bindings** | Real commands, globs, paths, ticket connector | `project.config.yml` in a consuming repo — the single source of truth every hook and template reads from |

## Quick start

```sh
node scripts/scaffold.mjs --target /path/to/consuming-repo --template gradle-kotlin
```

`--template` is one of `gradle-kotlin`, `xcode-swift`, or `node-pnpm`
(`templates/stacks/*.config.yml`) — only used the first time; a repo that
already has `project.config.yml` is never overwritten, only re-hydrated.

Full walkthrough, including what to edit and in what order: see
**`docs/ONBOARDING.md`**.

## Repo layout

```
agents/                  Coordinator/Implementor/Verifier role contracts
hooks/                    verify-loop.sh, implementor-git-guard.sh (+ lib/)
lib/ticket-source/        Ticket-intake adapter boundary (MCP + manual)
templates/                CLAUDE.md / REVIEW.md / SPEC.md templates + stack starters
scripts/                  validate-config.mjs, scaffold.mjs
settings.base.json        Claude Code permission/hook shape
project.config.yml        Reference example (mirrors the spec's schema section)
project.config.schema.json  JSON Schema for project.config.yml
ADR/0000-template.md     Architecture Decision Record template
docs/ONBOARDING.md        Adoption walkthrough with a mobile-team worked example
docs/CONFORMANCE.md       Platform audit checklist + standing decisions log
```

## Key docs

- **`AI-SDLC-FRAMEWORK-SPEC.md`** — the spec. Read this first.
- **`docs/ONBOARDING.md`** — how a new team adopts this.
- **`docs/CONFORMANCE.md`** — how a platform team audits an already-adopted repo, plus a log of decisions made where the spec left something open (deployment model, ticket-source privilege enforcement, the Node dependency, etc.).
- **`lib/ticket-source/README.md`** — the ticket-intake adapter boundary.

## Guarantees this framework enforces mechanically (not by prompt)

- Every state-changing git/PR operation (`git commit`, `git push`, `gh pr create`) requires an explicit human approval click — no agent can commit, push, or open a PR silently. This is the separation-of-duties gate under the standard shared-session deployment; the vendored `hooks/implementor-git-guard.sh` hard-block hook is available but *not wired by default* (see `docs/CONFORMANCE.md` item B.1).
- The Verifier cannot edit files (no `Write`/`Edit` in `agents/verifier.md`'s tool list — enforced natively by Claude Code's subagent tool allowlist).
- A missing or malformed `project.config.yml` blocks every hook (exit 2) — never a silent no-op.
- Every hard rule is tagged `audit: static|verifier` and `review_gate: blocking|advisory`, enforced by `scripts/validate-config.mjs`.
- Tier D/E changes hard-stop an agent regardless of team config — only the trigger *conditions* are team-supplied.
