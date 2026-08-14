<!--
  templates/CHANGELOG.template.md

  Starter CHANGELOG.md for a consuming repo, written once by
  scripts/scaffold.mjs the first time CHANGELOG.md doesn't already exist
  at the target repo's root, then never touched by the scaffolder again —
  same non-destructive treatment as project.config.yml, since every line
  after this one is real per-repo history, not something a re-scaffold
  should ever regenerate or overwrite.

  Unlike CLAUDE.md/REVIEW.md, this file carries no FROM_CONFIG markers and
  is not derived from project.config.yml — entries are freeform prose the
  Coordinator writes by hand, one per completed unit of work, per
  agents/coordinator.md's mandate. Format matches this framework's commit
  message convention for consistency: "(<ticket-id>): <what changed>".

  This framework doesn't manage release cadence or versioning — if this
  team cuts dated releases, moving entries out of [Unreleased] into a
  dated section is a manual step owned by the team, not something any
  hook or script here does for you.
-->

# Changelog

All notable changes to this repo are recorded here, one entry per
completed unit of work, added by the Coordinator right before opening
that unit of work's PR (see `agents/coordinator.md`).

## [Unreleased]
