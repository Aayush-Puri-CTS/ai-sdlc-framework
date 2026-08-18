---
name: session-handoff
description: >-
  Writes/refreshes .claude/hooks/.state/HANDOFF.md — a living, single-file
  snapshot of the current task's state (active spec, tier, status, files
  touched, open questions not yet written into a spec or ADR) for a fresh
  session to pick up from automatically. Invoke when you notice context
  usage climbing (e.g. via /context) and want a deliberate handoff
  instead of relying on auto-compaction, or at any natural stopping point
  mid-task.
---

# Session Handoff

## What this produces

A single file, `.claude/hooks/.state/HANDOFF.md`, always overwritten on
each invocation — this is a **living snapshot of current state**, not a
point-in-time artifact to preserve (contrast with the `repo-guide-draft`
skill, which refuses to overwrite for the opposite reason: that one is a
one-shot review artifact, this one is meant to always reflect "right
now"). It's local-only: `.claude/hooks/.state/` is already gitignored by
this framework, so a handoff note never needs to worry about colliding
with another developer's — it exists purely to carry your own next
session forward, not to be a shared or durable project record.

## When to invoke this

Any time you notice — most concretely via `/context` — that the current
session is approaching its limit and you'd rather hand off deliberately
than let auto-compaction summarize lossily. Also reasonable at any
natural stopping point mid-task (end of day, switching to something
else) even without a context-limit signal.

## What to write

Read the current state of the task — active `docs/specs/*.md`, the
current git branch and its committed/uncommitted changes, the tier
classification if one's been made, and anything discussed or decided in
this session that **is not yet captured** in a spec, an ADR, or a commit
message. That last category is the entire point of this file: specs and
git history are already durable and don't need duplicating here — only
capture what would genuinely be lost otherwise.

Write `.claude/hooks/.state/HANDOFF.md` (creating the `.state/` directory
first if it doesn't exist) with this structure:

```markdown
# Session Handoff

**Generated:** <date/time>
**Branch:** <current git branch>
**Last commit:** <short SHA, or "none yet on this branch">

## Active spec
<Pointer only, e.g. "docs/specs/add-rate-limiting.md" — do not copy its
content here. Omit this section if no spec has been written yet.>

## Tier
<A-E, if classified. Omit if not yet classified.>

## Status
- Done: <short bullets — what's actually complete and verified>
- Pending: <short bullets — what's left>

## Files touched so far
<The manifest this framework's Context Management mandate already asks
you to track — a flat list is enough.>

## Open questions / not yet written anywhere durable
<Anything decided or discovered in this session that isn't in the spec,
an ADR, or a commit yet. If there's nothing in this category, say so
explicitly rather than omitting the section — "nothing outstanding" is
useful information too, distinct from "forgot to check.">
```

Never quote large blocks of source code here — reference file paths and
line numbers instead. This file is meant to be short enough to read in
under a minute.

## Re-invocation

Always overwrite. Unlike `repo-guide-draft`, there's no "existing draft
with review notes to protect" concern — the previous handoff's job was to
get you to this point, and once you're past it, the old content is just
noise. If nothing has actually changed since the last invocation, it's
fine for the new file to be nearly identical to it.

## What happens next

A `SessionStart` hook (`hooks/session-start-handoff.mjs`, vendored to
`.claude/hooks/`) automatically surfaces this file's content into a
fresh session if one exists — nobody needs to manually paste it in. That
hook does not delete the file after surfacing it (`SessionStart` also
fires on `/clear` and `/compact`, not only a genuinely new session, so
auto-deleting on any `SessionStart` risks losing a note before a real
fresh session ever sees it). Once a session has read a surfaced handoff
note and either continued the task or confirmed it's already done, that
session should delete `.claude/hooks/.state/HANDOFF.md` itself — don't
leave a consumed note for a future session to trip over.
