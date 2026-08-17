---
name: repo-guide-draft
description: >-
  Drafts docs/AI-GUIDE-DRAFT.md — a standalone, developer-reviewed summary
  of this repo's stack, structure, conventions, test/check commands, and
  proposed deny/ask/allow permission rules, built from a repomix
  pack_codebase scan. Invoke when a human wants a first-draft starting
  point for filling in CLAUDE.md/REVIEW.md's TEAM_AUTHORED sections and
  project.config.yml's permissions block, or any time a fresh orientation
  draft of an unfamiliar repo is wanted.
---

# Repo AI Guide Draft

## What this produces

A single file, `docs/AI-GUIDE-DRAFT.md`, that a developer reads and
manually copies pieces of into `CLAUDE.md`, `REVIEW.md`, and
`project.config.yml`. This skill does not edit those files itself, does
not write to `.claude/settings.json`, and does not require
`project.config.yml` to already exist. It is a **standalone drafting
aid** — a one-time snapshot for a human to review and transcribe from,
not a living document this framework keeps in sync with anything. Once
its content has been transcribed, the developer should delete or archive
it; nothing here re-reads it later.

## Before you start: refuse if a draft already exists

Check whether `docs/AI-GUIDE-DRAFT.md` already exists. **If it does, stop
immediately** — do not read it, do not merge into it, do not overwrite
it. Tell the human:

```
docs/AI-GUIDE-DRAFT.md already exists. This skill never overwrites an
existing draft (it may contain review notes or edits you don't want
lost) — same treatment this framework gives project.config.yml and
CHANGELOG.md once they exist. If you want a fresh one, move the old
draft aside first, e.g.:
  mv docs/AI-GUIDE-DRAFT.md docs/AI-GUIDE-DRAFT.previous.md
then invoke this skill again.
```

Then stop — do not proceed to the steps below.

## Step 1 — Gather context with repomix

Use the `repomix` MCP server's `pack_codebase` tool to get a compressed
view of this repository (enable its compression option). Exclude, in
addition to whatever `.gitignore` already covers: `.env*`, `**/secrets/**`,
`**/*.pem`, `**/*.key`, `**/*.p12`, `**/*.keystore`, and anything else
that looks credential-shaped by name — don't rely on repomix's own
secret-redaction alone as the only safeguard. Use `grep_repomix_output`
for any targeted follow-up question (e.g. "where are HTTP routes
defined") rather than re-packing the whole repo again.

If the codebase is large enough that a full pack is impractical, pack a
representative subset (top-level source directories, config files,
package manifests) rather than skipping this step — a partial, honest
scan beats guessing.

## Step 2 — Analyze what you packed

Determine, from what you actually observed (not assumptions):

- **Stack & key technologies** — languages, frameworks, package manager,
  major dependencies.
- **Repository structure** — what each top-level (and notable nested)
  directory is for, in one line each.
- **Conventions** — naming patterns, file organization, testing style,
  anything consistently repeated across the codebase. Note these as
  *observed patterns to confirm*, not settled rules — a human should
  correct anything you inferred wrong.
- **Test & check commands** — from `package.json` scripts, `Makefile`
  targets, CI workflow files (`.github/workflows/*.yml` or equivalent),
  or an existing `project.config.yml` if one is already present.

## Step 3 — Draft proposed permissions (deny / ask / allow)

This is the highest-stakes section of the draft — wrong in one direction
is a real access-control gap, wrong in the other blocks legitimate work.
Propose, don't apply anything.

- If `project.config.yml` already exists in this repo, read its
  `permissions.*` block first and treat it as the existing baseline —
  only propose genuinely new findings, don't restate what's already
  there.
- Regardless of stack, check for and flag if present: `.env*` files,
  anything under a `secrets/`-named directory, `*.pem`/`*.key`/`*.p12`
  files, cloud credential files (`.aws/credentials`,
  `gcloud/credentials.json`-shaped paths), CI/CD config that embeds
  tokens, database migration directories (candidate for `ask`, not
  `deny` — legitimate work touches these), and any lockfile-adjacent
  publish commands for the detected package manager (`npm publish`,
  `composer` equivalents, etc. — candidates for `deny_cmd_patterns`).
- Layer on repo-specific findings a generic checklist wouldn't catch —
  an unusually named credentials file, a nonstandard internal-config
  directory, anything that looked like a secret even if redacted by
  repomix.
- Give each proposed entry a one-line rationale ("flagged: contains
  `DATABASE_URL`-shaped env vars" / "flagged: standard secrets
  directory") so the developer can judge it quickly instead of having to
  re-derive why it was suggested.

## Step 4 — Write `docs/AI-GUIDE-DRAFT.md`

Never quote raw file content verbatim anywhere in the draft — summarize
observations only ("uses PostgreSQL via an ORM," not a pasted connection
string or config snippet). The draft is a new, committed file; anything
sensitive echoed into it is now leaked twice, not once.

Use exactly this structure:

```markdown
# AI Guide Draft — <repo name>

**Generated:** <date>
**Status:** DRAFT — for developer review. Nothing in this file has been
applied anywhere. Transcribe what you approve into CLAUDE.md, REVIEW.md,
and project.config.yml, then delete or archive this file.

## Stack & Key Technologies
...

## Repository Structure
...

## Conventions (observed — confirm or correct)
...

## Test & Check Commands
...

## Proposed Permissions (review before using)
### Deny
- `<pattern>` — <one-line rationale>
### Ask
- `<pattern>` — <one-line rationale>
### Allow
- `<pattern>` — <one-line rationale>

## How to use this draft
- Stack/Structure/Conventions sections → CLAUDE.md's `<<TEAM_AUTHORED:...>>`
  stubs (see templates/CLAUDE.template.md if this repo has adopted this
  framework).
- Test & Check Commands → project.config.yml's `stack.lint_cmd`/
  `stack.test_cmd`/`stack.extra_validate_cmd`, and REVIEW.md's review
  checklist.
- Proposed Permissions → project.config.yml's `permissions.deny_read`/
  `deny_cmd_patterns`/`ask_write_paths`/`ask_cmd_patterns`/
  `allow_write_paths` — copy only what you've reviewed and agree with.
- Once transcribed, delete or archive this file — it is not read again
  by anything in this framework.
```

## Step 5 — Tell the human what you did

After writing the file, summarize in the conversation: what was scanned,
how many permission entries were proposed and why, and an explicit
reminder that nothing was applied — the draft is waiting for review.

## If this skill is invoked again

Re-run Step 0 (the existence check) every time. A second invocation with
`docs/AI-GUIDE-DRAFT.md` already present must refuse exactly as described
above — never diff, merge, or silently refresh it. If the repo has
changed enough to want an updated draft, that is the human's decision to
make explicitly (move the old one aside), not something this skill infers
on its own.
