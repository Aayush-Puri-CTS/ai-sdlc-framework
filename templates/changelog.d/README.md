# Changelog Fragments

One file per unit of work, named `<ticket-id>.<category>.md`, where
`<category>` is one of Keep a Changelog's own buckets: `added`,
`changed`, `deprecated`, `removed`, `fixed`, `security`. Content is a
single line describing the change from a user's perspective — the same
one-line summary that would otherwise go straight into `CHANGELOG.md`.

Written here instead of directly into `CHANGELOG.md` specifically so that
two branches in flight at the same time never touch the same file:
`changelog.d/PROJ-123.added.md` and `changelog.d/PROJ-456.fixed.md` can
merge in either order without a conflict, which editing a shared "current
release" section in one file cannot guarantee — see `docs/CONFORMANCE.md`
in the ai-sdlc-framework repo this was vendored from.

Written by the Coordinator as part of finishing a unit of work
(`agents/coordinator.md` mandate step 7) — one fragment per completed
unit of work, committed on its own, same as any other changed file. Never
edited by hand once its unit of work has merged; a slow-to-merge branch's
fragment simply rolls into whichever release cut happens after it lands,
with no manual reconciliation needed.

At release time, `scripts/cut-changelog-release.mjs` (run automatically
on a version tag push if this repo was scaffolded with `--with-release`,
or by hand otherwise) reads every fragment here, groups them by category,
writes a new dated section into `CHANGELOG.md`, and deletes the fragments
it consumed.
