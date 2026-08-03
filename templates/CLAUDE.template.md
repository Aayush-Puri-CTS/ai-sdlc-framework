<!--
  templates/CLAUDE.template.md

  Hydrated by scripts/scaffold.mjs into CLAUDE.md at the repo root.

  Two distinct kinds of placeholder appear below — do not confuse them:

    <<FROM_CONFIG:...>>   Filled in automatically from project.config.yml
                          by scaffold.mjs. Never hand-edit these sections
                          after scaffolding — edit project.config.yml and
                          re-run the scaffolder instead. This is what
                          "zero command duplication" (spec section 9,
                          criterion 3) actually means in practice: these
                          values have exactly one source of truth.

    <<TEAM_AUTHORED:...>> Free text only a human on this team can write —
                          the scaffolder leaves a stub prompt here.
                          Fill these in by hand before your first task.

  Every multi-line <<FROM_CONFIG:...>> block is wrapped in a pair of
  FROM_CONFIG:<key>:BEGIN / FROM_CONFIG:<key>:END HTML comment markers.
  The scaffolder is idempotent: re-running it after a project.config.yml
  edit replaces only
  the text BETWEEN a matching BEGIN/END pair, in an already-hydrated
  CLAUDE.md, leaving every <<TEAM_AUTHORED:...>> section (and anything
  else you've written) untouched. Do not remove or rename these markers.

  Nothing in this template may contain a literal command string, file
  glob, or path — those belong in project.config.yml, referenced here by
  name only (e.g. "see stack.lint_cmd"), never spelled out.
-->

# CLAUDE.md — <!-- FROM_CONFIG:team.name:BEGIN --><<FROM_CONFIG:team.name>><!-- FROM_CONFIG:team.name:END -->

This file is this repository's team-authored governance content — the
actual rule statements, conventions, and escalation contacts the
Coordinator, Implementor, and Verifier read before acting. The mechanics
that enforce it (hook contracts, tier ladder, rule taxonomy, schema) come
from the vendored framework core in `agents/*.md`, `hooks/*.sh`, and
`project.config.yml` — this file should never restate those mechanics,
only this team's specific content.

## Stack

- Package manager: <!-- FROM_CONFIG:stack.package_manager:BEGIN --><<FROM_CONFIG:stack.package_manager>><!-- FROM_CONFIG:stack.package_manager:END -->
- Build/lint/test commands: defined in `project.config.yml` under `stack.*`
  — do not copy them here; if you need to reference a command in prose,
  name the config key (e.g. "run `stack.test_cmd`"), not the literal
  string.

## Branching

Branch names are `<prefix><ticket-id>`, per ticket type. See
`agents/coordinator.md` for exactly how the Coordinator applies this —
this table is sourced from `project.config.yml`'s `team.branch_prefixes`,
not hand-maintained.

<!-- FROM_CONFIG:branch_prefixes_list:BEGIN -->

<<FROM_CONFIG:branch_prefixes_list>>

<!-- FROM_CONFIG:branch_prefixes_list:END -->

## Pull Request Labels

Every PR the Coordinator opens carries these labels (sourced from
`project.config.yml`'s `pull_request.required_labels`, not
hand-maintained). `ai-assisted` is mandatory org-wide and cannot be
dropped.

<!-- FROM_CONFIG:pull_request_labels_list:BEGIN -->

<<FROM_CONFIG:pull_request_labels_list>>

<!-- FROM_CONFIG:pull_request_labels_list:END -->

## Architecture Overview

<<TEAM_AUTHORED: Describe this repo's architecture in 1-3 paragraphs —
module boundaries, the pattern(s) it follows, and anything an AI agent
needs to know before placing new code. This is where domain-specific
architecture (e.g. a layering convention, a messaging pattern, a
multi-tenancy model) belongs — the framework core has no opinion on any
of it.>>

## Coding Conventions

<<TEAM_AUTHORED: Naming, formatting-beyond-what-the-linter-enforces,
preferred libraries, patterns to avoid, and anything else an Implementor
should follow that isn't already mechanically enforced by
stack.lint_cmd / stack.extra_validate_cmd.>>

## Hard Rules

Every row below is sourced from `project.config.yml`'s `hard_rules[]` and
regenerated verbatim by the scaffolder — edit the config, not this table.
`audit` says how a rule is checked; `review_gate` says whether a violation
blocks the pipeline or is merely advisory (AI-SDLC-FRAMEWORK-SPEC.md
section 7).

<!-- FROM_CONFIG:hard_rules_table:BEGIN -->

<<FROM_CONFIG:hard_rules_table>>

<!-- FROM_CONFIG:hard_rules_table:END -->

<!--
  Rendered by scaffold.mjs as a markdown table with columns:
  id | statement | audit | review_gate
  — one row per project.config.yml hard_rules[] entry, in file order.
-->

## Autonomy Tier Triggers

The A–E tier ladder itself is invariant framework structure (see
`agents/coordinator.md`); the triggers below are this team's own, sourced
from `project.config.yml`'s `tiers` block.

**Tier D triggers (hard stop — requires a pre-approved ADR under `/ADR/*.md`):**

<!-- FROM_CONFIG:tier_d_triggers_list:BEGIN -->

<<FROM_CONFIG:tier_d_triggers_list>>

<!-- FROM_CONFIG:tier_d_triggers_list:END -->

**Tier E triggers (absolute refusal — referred to a human team lead):**

<!-- FROM_CONFIG:tier_e_triggers_list:BEGIN -->

<<FROM_CONFIG:tier_e_triggers_list>>

<!-- FROM_CONFIG:tier_e_triggers_list:END -->

**Tier C required reviewer:** <!-- FROM_CONFIG:tiers.C_needs_reviewer:BEGIN --><<FROM_CONFIG:tiers.C_needs_reviewer>><!-- FROM_CONFIG:tiers.C_needs_reviewer:END -->

## Escalation Contacts

<<TEAM_AUTHORED: Who does the Coordinator notify for a Tier D/E stop? Who
is `tiers.C_needs_reviewer` in practice (a team, a specific person, a
Slack channel)? List them here so an agent halting on a hard stop can
actually say who to page.>>

## Architecture Decision Records

Tier D changes require a pre-approved ADR under `/ADR/*.md` before any
implementation begins. See `/ADR/0000-template.md` for the required
shape. <<TEAM_AUTHORED: note this team's ADR review/approval process if it
differs from "get it approved before work starts.">>
