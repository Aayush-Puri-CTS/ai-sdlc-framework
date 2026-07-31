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

## Acceptance Criteria

<<Bulleted list. Transcribed from the ticket (or the human's manual paste)
— do not invent criteria the source didn't state. If the source didn't
state any, that is a fallback-to-manual-adapter situation, not a
fill-in-the-gap situation.>>

## Scope Notes

<<Anything the Implementor needs that isn't captured above — files likely
touched, an existing pattern to follow, something explicitly OUT of
scope for this task.>>

## Tier C only: Required Reviewer

<<Name tiers.C_needs_reviewer from project.config.yml. Omit this section
entirely for tasks below Tier C.>>
