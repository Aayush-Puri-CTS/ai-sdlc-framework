<!--
  templates/CHANGELOG.template.md

  Starter CHANGELOG.md for a consuming repo, written once by
  scripts/scaffold.mjs the first time CHANGELOG.md doesn't already exist
  at the target repo's root, then never touched by the scaffolder again —
  same non-destructive treatment as project.config.yml, since every line
  after this one is real per-repo history, not something a re-scaffold
  should ever regenerate or overwrite.

  Unlike CLAUDE.md/REVIEW.md, this file carries no FROM_CONFIG markers and
  is not derived from project.config.yml. Pending changes for the next
  release are NOT recorded directly in this file — they live as
  individual fragment files under changelog.d/ (one per unit of work, see
  that directory's own README) so that concurrent branches never conflict
  editing the same section of this file. scripts/cut-changelog-release.mjs
  consolidates those fragments into a new dated section here at release
  time.
-->

# Changelog

All notable changes to this repo are recorded here, one dated section per
release, consolidated from `changelog.d/` fragments by
`scripts/cut-changelog-release.mjs` at release time (automatically on a
version tag push, if this repo was scaffolded with `--with-release`).

Pending changes not yet released live in `changelog.d/`, not below this
line — see that directory's `README.md` for the fragment file convention.

This framework doesn't manage version numbering or release cadence; the
version label in each section below is whatever was passed to
`cut-changelog-release.mjs --version`, typically derived from the git tag
that triggered the release.
