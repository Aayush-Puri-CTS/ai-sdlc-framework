<!--
  Vendored by scripts/scaffold.mjs (--with-ci) into
  .github/PULL_REQUEST_TEMPLATE/ai-sdlc.md — a NAMED template, not the
  repo's default (.github/PULL_REQUEST_TEMPLATE.md), so it never collides
  with or replaces whatever default template this repo already has.
  Select it explicitly when opening a PR through the GitHub UI
  (?template=ai-sdlc.md), or reference it directly for a PR the
  Coordinator opens via `gh pr create` — see agents/coordinator.md,
  mandate step 7, for what the Coordinator itself is required to check
  before opening a PR (this template mirrors that checklist for a human
  reviewer or a human-opened PR, it isn't a substitute for it).
-->

## What changed

<!-- One or two sentences. Link the task spec(s) under docs/specs/ this PR closes. -->

## AI-SDLC checklist

- [ ] This PR is labeled per `pull_request.required_labels` in `project.config.yml` (always includes `ai-assisted`)
- [ ] Every blocking item in `REVIEW.md` is checked
- [ ] For a Tier C task: `tiers.C_needs_reviewer` has been requested as a reviewer
- [ ] For a Tier D task: a corresponding, approved ADR exists under `/ADR/*.md`
