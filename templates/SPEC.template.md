<!--
  templates/SPEC.template.md

  The invariant shape for docs/specs/<feature>.md, regardless of which
  ticket-source adapter produced it (see lib/ticket-source/README.md).
  This is not hydrated by scripts/scaffold.mjs — the Coordinator writes
  one of these per task, filling in every <<...>> field itself as part of
  the "Resolve ticket -> Read requirements -> Author spec" step.

  This is the ONLY artifact the Implementor and Verifier read to learn
  what to build and check — keep it self-contained. Neither of them
  re-fetches the original ticket.
-->

# <<FEATURE_NAME>>

**Source:** <<e.g. "Zoho Sprints item PROJ-123" | "Jira PROJ-123" | "manual paste, 2026-07-31">>
**Autonomy tier:** <<A|B|C|D|E>> — <<one line on why this tier, referencing the specific tiers.D_triggers / tiers.E_triggers / hard rule that applies, if any>>
**Hard rules in scope:** <<list the hard_rules[] ids from CLAUDE.md that specifically apply to this change; "none beyond the repo-wide defaults" is a valid answer>>

## Change

<<What is being built or fixed, in concrete terms — not a restatement of
the ticket title, but specific enough that the Implementor doesn't need
to re-derive scope.>>

## Rationale

<<Why this change is being made — the underlying problem or goal driving
it. Distinct from "Change" above: that section is the what, this is the
why. If the ticket doesn't state a rationale, say so rather than
inventing one.>>

## Execution Flow

<<How this change fits into the running system — entry point(s), the
sequence of steps or module boundaries a request/invocation crosses, and
where in that sequence this change's behavior actually takes effect.
Enough for the Implementor to place the change correctly without
re-deriving the surrounding flow from scratch.>>

## Function Calls

<<The specific functions/methods/endpoints being added, modified, or
removed, and what calls them or what they call — concrete enough that the
Implementor doesn't need to re-derive the call graph. A short list is
fine; this isn't a full call-graph dump.>>

## Acceptance Criteria

<<Bulleted list. Transcribed from the ticket (or the human's manual paste)
— do not invent criteria the source didn't state. If the source didn't
state any, that is a fallback-to-manual-adapter situation, not a
fill-in-the-gap situation.>>

## Impact Radius

<<Concise — a short bulleted list of what else this change could affect:
other callers/consumers of the touched functions, downstream modules,
config or schema consumers, backward-compatibility concerns. Keep this
tight; it's a blast-radius check, not a restatement of Scope Notes.>>

## Scope Notes

<<Anything the Implementor needs that isn't captured above — files likely
touched, an existing pattern to follow, something explicitly OUT of
scope for this task.>>

## Tier C only: Required Reviewer

<<Name tiers.C_needs_reviewer from project.config.yml. Omit this section
entirely for tasks below Tier C.>>
