# Research: Multi-Developer Context Preservation and Token Optimization

Two questions raised about running this framework with multiple
collaborators in the same repo: how do developers share context without
colliding, and how do we keep token spend under control. Both are answered
against what this framework already builds (`docs/specs/`, `ADR/`,
`CLAUDE.md`/`REVIEW.md`, `lib/ticket-source/`, the Coordinator/Implementor/
Verifier split) rather than inventing a parallel system — most of the
collision risk below evaporates once existing mechanisms are used as
designed instead of alongside a new file that competes with them.

## 1. Preserving context across multiple collaborators

### 1.1 Don't reach for a single, shared, mutable `context.md`

A root-level `context.md` that every developer edits as they work is the
one design to avoid, for a structural reason rather than a style
preference: it has no natural way to partition writes. Two developers
active on two different tickets will both want to append to it in the
same session window, git will see it as one file with interleaved,
unrelated edits, and every merge becomes a manual reconciliation between
people who may not even know the other's change happened. It also
duplicates two systems that already exist and are already authoritative:
the ticket system (who's doing what) and git/GitHub (what's in flight,
what's merged). A shared context file drifts out of sync with both within
days and then nobody trusts it, which is worse than not having it.

The general principle: **shared context should be append-only and scoped
to a unit of work, never a single mutable file multiple people write to
concurrently.** Everything below follows from that.

### 1.2 What already solves this, if used as designed

This framework already has three context-carrying artifacts, each scoped
so two developers never touch the same one at the same time:

**`docs/specs/<task-name>.md`** (`lib/ticket-source/README.md`) — the
Coordinator writes one spec file per unit of work, named after that task,
on that task's own branch, before delegating. Two developers working two
tickets get two files. There is no collision because the branch model
already partitions the work — this is the framework's existing answer to
"in-flight task context," and it needs no new file to do the job.

**`ADR/*.md`** — for Tier D decisions (architecturally significant
changes), a numbered, append-only Architecture Decision Record is
required before code is written (`agents/coordinator.md`, tier table).
This is the right home for durable, cross-cutting context that should
outlive any one task — "why did we choose X" — and it's already
collision-free by construction: each ADR gets its own number and file,
never edited by a later decision, only superseded by a new one that
references it.

**`CLAUDE.md` / `REVIEW.md`** — the durable, slow-changing shared context
every session loads automatically. This is the correct place for
standing conventions, hard rules, and architecture notes that apply to
everyone, always — not a running log. It changes rarely, is PR-reviewed
like any other file, and `scripts/validate-config.mjs` plus the
`FROM_CONFIG` marker convention keep it from silently drifting out of
sync with `project.config.yml`.

None of these three is a good place for "what did I do in yesterday's
session" — that's what the next section is for.

### 1.3 If you want ephemeral per-session narrative context, log it — don't accumulate it

Sometimes a spec file and an ADR aren't enough: you want a running record
of what a session actually did, for the next session (yours or a
teammate's) to pick up cold. The fix that avoids the `context.md`
collision problem is the same one used for commit history — append-only,
one entry per session, never edited by anyone but its author:

```
docs/dev-log/<YYYY-MM-DD>-<dev-initials>-<task-slug>.md
```

One file per session, committed alongside the work it describes, PR-
reviewed like everything else. Two developers never write the same file
because the filename already encodes who and when. If you want a single
place to *read* the whole history, that's what `git log --all` and
`gh pr list --state all` already are — don't re-derive them into a
hand-maintained index that will fall out of date the first week someone
forgets to update it.

If this doesn't end up earning its keep in practice, it's fine to decide
against it — the spec + ADR + `CLAUDE.md` triad above already covers most
real needs, and a fourth artifact is only worth adding if something
concrete falls through the cracks of the other three.

### 1.4 Tracking progress without collision

Three mechanisms already exist and are already authoritative — the goal
is to lean on them rather than build a fourth:

- **Ticket status** in whatever `ticket_source` is configured
  (`project.config.yml`; a Zoho Sprints MCP connector is available in
  this environment) is the real answer to "who is working on what." It's
  already the system of record for assignment and status; a markdown file
  trying to track the same thing will always be one edit behind it.
- **Branches and open PRs** (`git branch -r`, `gh pr list`) show exactly
  what's in flight, by whom, right now — this is free, always current,
  and never needs a human to remember to update it.
- **The spec-file lifecycle itself is a progress signal**: a spec's
  existence means a task was classified and delegated; a Verifier PASS
  recorded in that spec (per the Coordinator's mandate) means it's ready
  to commit; a merged PR means it's done. That's a full audit trail
  without inventing a separate tracker.

Where two developers could still collide: both picking the same ticket,
or both touching the same file from unrelated tasks at the same time.
Neither is solved by a markdown file — the first is a ticket-assignment
problem (enforce it in the ticket system), the second is what branches
and normal PR review already exist to catch. Don't build a governance
layer in markdown for something git already governs.

### 1.5 Summary recommendation

Keep using `docs/specs/*.md` and `ADR/*.md` exactly as already designed —
they already give per-task, collision-free context. Treat `CLAUDE.md`/
`REVIEW.md` as durable and rarely-changed, not a log. Only add the
per-session `docs/dev-log/` convention if a concrete gap shows up in
practice. Never introduce a single shared `context.md` that multiple
developers edit concurrently — it re-implements what git and the ticket
system already do, worse.

## 2. Optimizing token usage

Ranked by expected impact, given this framework's actual architecture.

### 2.1 Model tier is the single biggest lever

The Coordinator runs on Opus (main thread); Implementor and Verifier run
as Sonnet subagents (`agents/*.md` frontmatter). This assignment already
puts the more expensive model only where judgment is genuinely needed
(tier classification, delegation, remediation decisions) and the cheaper
model where the work is mechanical (writing code to a spec, checking it
against acceptance criteria). The single most impactful thing to protect
is this split itself — resist ever having the Coordinator do Implementor-
or Verifier-shaped work directly (which the mandate already prohibits for
duty-separation reasons, and which also happens to be the expensive-model
doing cheap-model work).

### 2.2 Subagent isolation is a context firewall, not just a duty-separation mechanism

Because Implementor and Verifier run in their own ephemeral contexts, the
raw tool-execution noise from their work — file reads, intermediate diffs,
test output — never lands in the Coordinator's own (Opus, priced higher,
and the one thread that has to survive the whole session) context window.
This is already true by construction; the practical implication is to
resist the temptation to have the Coordinator read large files itself
"just to check" before delegating — let the Implementor do its own reads
inside its own disposable context instead.

### 2.3 The Coordinator's existing "Context Management" contract is the concrete policy — apply it literally

`agents/coordinator.md` already states what must survive compaction:
active spec contents, current tier classification, and the manifest of
files touched. Everything else — raw tool output, intermediate reasoning,
resolved sub-questions — doesn't need to be retained. Where this breaks
down in practice is when a Coordinator narrates tool results back into its
own thread instead of trusting the spec file as the record; the spec file
existing is the reason the narration isn't necessary.

### 2.4 Two-phase verification already avoids redundant expensive checks

`hooks/verify-loop.sh`'s split — fast, single-file `lint_cmd`/`test_cmd`
on every edit (PostToolUse) vs. broad `extra_validate_cmd` only at
Stop/SubagentStop — means a whole-project type-check or static-analysis
pass runs once per turn, not once per file edit. This is a real, already-
built cost control; a stack's `extra_validate_cmd` (e.g. `tsc --noEmit`,
`phpstan analyse`) should stay reserved for that broad checkpoint and
never get invoked ad hoc mid-turn.

### 2.5 Scoped globs keep hooks from running against irrelevant paths

`verify_hook.include_glob` and `skip_globs` in `project.config.yml`
already exclude `node_modules/`, `vendor/`, `dist/`, `storage/`, etc. —
every one of these is a hook invocation (and its output) that never
happens. When adding a new stack template (as with the recent
`php-laravel` addition), keeping these globs tight is a token-cost
decision, not just a correctness one.

### 2.6 Keep `CLAUDE.md`/`REVIEW.md` lean — they're a per-session fixed cost

Unlike a spec file (read once, for one task), `CLAUDE.md` loads at the
start of every single session. Anything bloating it — verbose rule
statements, restated architecture notes better left in an ADR, duplicated
content from `project.config.yml` (already disallowed by the Zero Command
Duplication check in `docs/CONFORMANCE.md`) — is a tax paid every session,
not just once. Prefer referencing a hard rule's `id` or an ADR number over
restating its full rationale inline.

### 2.7 Stability enables prompt caching

`CLAUDE.md`, `REVIEW.md`, and the `agents/*.md` role files are exactly the
kind of content that benefits from prompt caching when they don't change
turn-to-turn. Re-hydrating them (`scripts/scaffold.mjs`) only when
`project.config.yml` actually changes — not speculatively, not "just to be
sure" — keeps them stable within and across sessions, which is what makes
caching effective in the first place.

### 2.8 Delegate by file path, not by pasted content

Handing the Implementor a `docs/specs/<task>.md` path to read is cheaper
than pasting the same content into a delegation prompt — the spec is read
once, inside the Implementor's own context, rather than duplicated into
the Coordinator's context and then again into the delegation payload.
This is already the framework's designed handoff shape; the token cost of
deviating from it (e.g. summarizing a whole ticket inline instead of
pointing at the written spec) is easy to reintroduce by habit.

### 2.9 A known, deliberate tradeoff worth naming, not re-litigating

The one-file-per-commit discipline (`agents/coordinator.md` mandate step
6) means N changed files produce N commit messages and N human-approval
round trips instead of one. That's a real per-task token and interaction
cost, traded deliberately for a cleaner audit trail and finer-grained
revert capability. It's listed here so it isn't mistaken for an
optimization opportunity — it's an intentional governance decision already
made, not an oversight to fix.

### 2.10 Parallelize only genuinely independent delegated work

If a unit of work naturally splits into independent specs (no shared
files, no ordering dependency), delegating them concurrently avoids
serially re-establishing context for each one. This only helps when the
work is truly independent — forcing parallelism on tasks that touch the
same files just trades a token saving for a merge-conflict cost, which is
a worse trade.

## Net effect

Section 1's recommendation adds no new required file today — it's a
reminder to use `docs/specs/`, `ADR/`, and `CLAUDE.md`/`REVIEW.md` as
already designed, plus one optional convention (`docs/dev-log/`) to adopt
only if a real gap shows up. Section 2's items are largely already built
into the framework's architecture (model tiers, subagent isolation,
two-phase verification, scoped globs) — the actionable part is discipline
in using them as designed rather than working around them under time
pressure.
