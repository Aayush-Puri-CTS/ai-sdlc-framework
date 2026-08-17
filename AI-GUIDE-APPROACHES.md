# Approaches for a Per-Repository AI Guide

Research pass before implementing the ticket: "create a per-repository AI
guide that gives AI agents the project context and rules they need before
making changes." No changes made yet — this is the options analysis the
ticket asked for first.

## What the ticket actually needs, restated as mechanisms

The six acceptance criteria split into two different kinds of problem,
and that split matters for picking a mechanism:

1. **Informational** (stack, directory purposes, conventions, test/check
   commands) — needs to reach the agent's context before it starts
   working. A documentation problem.
2. **Restrictive** (files/directories the AI must not modify) — needs to
   actually stop a write, not just describe one. A prose sentence saying
   "don't touch `.env`" is advice an agent can still violate by mistake;
   only a permission rule or a blocking hook can make it true regardless
   of whether the agent read or remembered the sentence.

Every approach below is evaluated against both halves separately, because
a mechanism that's good at one is often weak at the other.

## Approaches considered

### 1. A root-level convention file (`CLAUDE.md`, or the tool-agnostic `AGENTS.md`)

Claude Code natively auto-loads `CLAUDE.md` from the repo root at the
start of every session — no invocation, no configuration, nothing an
agent has to remember to do. `AGENTS.md` is the emerging cross-tool
equivalent (Cursor, Codex CLI, Aider, and others are converging on it) —
worth using instead of, or alongside, `CLAUDE.md` if this guide needs to
serve more than one AI tool.

- **Informational fit:** strong. This is exactly what static, prose-first
  project context is for, and it's the one mechanism here that's *always
  present* without the agent (or a human) having to trigger anything.
- **Restrictive fit:** weak on its own. An agent that reads "don't modify
  `infra/`" can still edit `infra/` if it misreads scope, forgets mid-session,
  or the instruction scrolls out of an already-long context. Needs pairing
  with #3 below for anything that actually matters.
- **Cost:** lowest of every option here — one file, plain markdown, reviewed
  in PRs like any other doc, no runtime component to break.
- **Failure mode:** goes stale if nobody maintains it as the repo evolves.
  Mitigated by generating the parts that change often (commands, paths)
  from a single config file instead of hand-editing prose in place — see
  "How this framework already builds this" below.

### 2. A Skill

A Claude Code Skill (`.claude/skills/*/SKILL.md`) is discovered by
description-matching or invoked explicitly (`/skill-name`) — it is
**not** loaded automatically at session start the way `CLAUDE.md` is.

- **Informational fit:** weak as the *primary* delivery mechanism — it
  directly fails the "AI can access the guide before working" criterion
  unless something else guarantees the skill actually gets invoked first.
- **Restrictive fit:** not applicable; skills don't gate tool calls.
- **Where it's actually useful:** as a *generator/maintainer* for the
  guide, not the guide itself — e.g. a `/update-repo-guide` skill that
  re-scans the repo and refreshes `CLAUDE.md`'s directory-purpose section,
  keeping the informational half from drifting without a human manually
  re-auditing it every quarter.

### 3. A Hook

Hooks are event-triggered scripts (`SessionStart`, `PreToolUse`,
`PostToolUse`, `Stop`, etc.) — built for enforcement and side effects, not
for carrying large blocks of static prose.

- **Informational fit:** technically possible — a `SessionStart` hook can
  inject additional context — but this adds a runtime dependency (a
  broken hook script means broken context injection) to solve a problem
  a plain file already solves for free. Only worth it if the context
  needs to be *dynamic* (e.g., "here's what CI last failed on," "here are
  the open Tier-D ADRs") rather than static project facts.
- **Restrictive fit:** strong, and this is the piece #1 can't do alone. A
  `PreToolUse` hook (or, more simply, a `permissions.deny`/`ask` rule in
  `.claude/settings.json`) can mechanically block or gate a write to a
  restricted path regardless of what the agent remembers reading. This is
  the correct mechanism for "files/directories the AI must not modify" —
  not more prose in the guide.
- **Cost/fragility:** higher than #1 — shell scripts, config parsing,
  more surface area for a silent failure. Reserve it for the restrictive
  half, not the informational half.

### 4. An MCP server / resource

Expose repo context as a queryable MCP tool instead of a static file.

- **Informational fit:** strong for scale (many repos, a central
  knowledge base, context too large to inline), weak for a single repo's
  guide — it's infrastructure to build and operate for a problem a
  markdown file already solves. Worth it only if this guide is meant to
  span an entire org's repos from one source, not one repo's own root.
- **Restrictive fit:** not applicable.

### 5. Extending the existing `README.md`

Tempting because it already exists, but `README.md` has no special status
to any AI tool — it's read only if the agent happens to read it, which
isn't guaranteed "before working" the way a recognized convention path
(`CLAUDE.md`/`AGENTS.md`) is. Also tends to accumulate human-audience
content (badges, install steps) that dilutes agent-directed instructions.
Fine as a place to *link to* the real guide; insufficient as the guide
itself.

## Mapping each acceptance criterion to a mechanism

| Criterion | Mechanism |
| --- | --- |
| Document stack and key technologies | `CLAUDE.md`/`AGENTS.md` prose |
| Explain purpose of major directories/files | `CLAUDE.md`/`AGENTS.md` prose |
| Define coding/project conventions | `CLAUDE.md`/`AGENTS.md` prose |
| Identify files/directories AI must not modify | `permissions.deny`/`ask` rules (settings/hook), **not prose alone** |
| Document test/check commands | `CLAUDE.md`/`AGENTS.md` prose, ideally also wired into an actual verification hook so they're run, not just described |
| Guide is consistently accessible before work starts | A root-level file at a convention path Claude Code auto-loads (`CLAUDE.md`) — not a skill, not a hook, nothing requiring invocation |

## Recommendation

Layer three things, not one:

1. **`CLAUDE.md` at the repo root** as the primary, always-loaded guide —
   stack, directory purposes, conventions, and a pointer to the actual
   test/check commands. This alone satisfies four of the six criteria and
   is the only mechanism here that satisfies "consistently accessible"
   without relying on the agent to do anything first.
2. **Permission rules for restricted paths** (`.claude/settings.json`'s
   `deny`/`ask` lists, or a `PreToolUse` hook if something more custom is
   needed) — the mechanical backstop for the one criterion prose can't
   guarantee by itself.
3. **A verification hook** that actually runs the documented test/check
   commands (at minimum on ending a turn) rather than only describing
   them — the difference between "the guide says to run tests" and tests
   actually running.
4. *Optional:* a maintenance Skill that periodically re-derives the
   directory-purpose section from the current repo tree, so the guide
   doesn't silently drift out of date the way hand-maintained docs tend to.
5. *If this needs to work across more than Claude Code:* mirror the guide
   into `AGENTS.md` too (or make `CLAUDE.md` a thin pointer to it), since
   `AGENTS.md` is the tool-agnostic convention other AI coding tools are
   converging on.

## How this framework already builds exactly this

If the target repo is meant to adopt full AI-SDLC governance (autonomy
tiers, Coordinator/Implementor/Verifier separation, mechanical hooks) and
not just a standalone context file, this repo's own scaffolder already
implements the recommendation above end to end:

- `CLAUDE.md`/`REVIEW.md` — generated from `templates/*.template.md`,
  hydrated from `project.config.yml` (`scripts/scaffold.mjs`) — covers
  the informational half, kept in sync with config rather than
  hand-maintained prose that drifts.
- `permissions.deny_read`/`deny_cmd_patterns`/`ask_write_paths` in
  `project.config.yml`, hydrated into `.claude/settings.json` — the
  mechanical restriction half.
- `hooks/verify-loop.sh` — actually runs `stack.lint_cmd`/`test_cmd`/
  `extra_validate_cmd`, not just documents them.
- Vendored via `node scripts/scaffold.mjs --target <repo> --template <stack>`
  — see `docs/ONBOARDING.md` for the full walkthrough.

If the ticket wants the lighter-weight version — a guide only, no tier
ladder or Coordinator/Implementor/Verifier model — a standalone
`CLAUDE.md`/`AGENTS.md` authored directly, without adopting the rest of
this framework, is the right-sized answer; the full scaffolder is more
than the ticket asked for unless the surrounding governance is also
wanted.
