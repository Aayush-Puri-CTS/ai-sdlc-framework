<!--
  templates/REVIEW.template.md

  Hydrated by scripts/scaffold.mjs into REVIEW.md at the repo root. This
  is the checklist a human reviewer (and the Verifier, for audit: verifier
  rules) works through before a PR merges. Like CLAUDE.template.md, every
  <<FROM_CONFIG:...>> block is regenerated from project.config.yml by the
  scaffolder — never hand-edit those sections directly; edit the config
  and re-run the scaffolder. <<TEAM_AUTHORED:...>> blocks are filled in by
  hand once, after scaffolding. Each FROM_CONFIG block is wrapped in a
  pair of FROM_CONFIG:<key>:BEGIN / FROM_CONFIG:<key>:END HTML comment
  markers so re-scaffolding patches only that span in an already-hydrated
  REVIEW.md — do not remove them.
-->

# REVIEW.md — <!-- FROM_CONFIG:team.name:BEGIN --><<FROM_CONFIG:team.name>><!-- FROM_CONFIG:team.name:END -->

Generated review checklist. A PR may only merge once every **blocking**
item below is checked; **advisory** items are surfaced for the human
reviewer's judgment and do not by themselves block a merge.

## Blocking Gates

Every hard rule below has `review_gate: blocking` in `project.config.yml`.
A single unchecked box here means the Verifier must return FAIL.

<!-- FROM_CONFIG:blocking_rules_checklist:BEGIN -->
<<FROM_CONFIG:blocking_rules_checklist>>
<!-- FROM_CONFIG:blocking_rules_checklist:END -->

<!--
  Rendered by scaffold.mjs as one checklist item per hard_rules[] entry
  where review_gate == "blocking":
  - [ ] **<id>** (audit: <static|verifier>) — <statement>
-->

## Advisory Notes

Every hard rule below has `review_gate: advisory`. A violation is noted
for the human reviewer but does not block the merge on its own.

<!-- FROM_CONFIG:advisory_rules_checklist:BEGIN -->
<<FROM_CONFIG:advisory_rules_checklist>>
<!-- FROM_CONFIG:advisory_rules_checklist:END -->

<!--
  Rendered by scaffold.mjs the same way, for review_gate == "advisory".
-->

## Tier D / E Trigger Checklist

Before approving, confirm this change does **not** match any of the
following — if it does, it should never have reached PR review as a
normal task (AI-SDLC-FRAMEWORK-SPEC.md section 6):

**Tier D (requires a pre-approved ADR under `/ADR/*.md`):**

<!-- FROM_CONFIG:tier_d_triggers_checklist:BEGIN -->
<<FROM_CONFIG:tier_d_triggers_checklist>>
<!-- FROM_CONFIG:tier_d_triggers_checklist:END -->

**Tier E (must not have been actioned by an agent at all):**

<!-- FROM_CONFIG:tier_e_triggers_checklist:BEGIN -->
<<FROM_CONFIG:tier_e_triggers_checklist>>
<!-- FROM_CONFIG:tier_e_triggers_checklist:END -->

## Verification Record

- [ ] `stack.lint_cmd` passed (see `project.config.yml`)
- [ ] `stack.test_cmd` passed
- [ ] `stack.extra_validate_cmd` passed (required for Tier C; advisory otherwise)
- [ ] Verifier returned PASS for every task spec in this PR
- [ ] For Tier C tasks: `tiers.C_needs_reviewer` has reviewed and approved

## Reviewer Notes

<<TEAM_AUTHORED: Anything this team wants a human reviewer to specifically
look for that isn't already captured as a hard rule above — e.g. a
standing concern, a migration in progress, a pattern currently being
phased out.>>
