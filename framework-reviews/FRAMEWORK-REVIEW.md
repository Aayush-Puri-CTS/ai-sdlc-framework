# AI-SDLC Framework — Gap & Improvement Review

**Reviewed:** 2026-08-04 · commit `1bbd422` · reviewer: Claude Code
**Scope:** the framework repo itself, cross-checked against its two real consumers:
`D:\Work\CloudTech_main\Regestration\registration-backend` and `registration-frontend`.

---

## Why this update

The first pass (2026-08-03, commit `4e0bed1`) reviewed the framework in isolation. Since then
two real teams vendored it. That's the best evidence available — not "could this go wrong" but
"did it". **One of the two consuming repos currently has phase-1 verification completely dead**,
and both have gaps the framework's own validator does not catch. This revision keeps the original
findings (re-verified against current HEAD, several still open, a couple newly introduced), and
adds a new top section for what real usage exposed.

---

## Verdict up front

The design is still good, and the two pilot repos prove the vendoring model basically works:
both scaffolded cleanly, both have real CI, CODEOWNERS, ADRs, branch/commit governance, and a
CLAUDE.md that correctly explains the agentic loop. That's a genuine win over the "spec-and-scaffold"
state of the last review.

But the gap between **what the docs promise** and **what mechanically holds** is now visible in
production, not just in theory:

| # | Guarantee as documented | Actual status, verified against real repos |
|---|---|---|
| N1 | `verify_hook.include_glob` gates Phase-1 lint/test on every edit | **Dead on arrival for registration-frontend** — the glob never matches any file |
| N2 | CONFORMANCE B.1 calls `git commit`/`git push`/`gh pr create` "the actual mechanism" closing the commit guarantee | **Both real repos are missing `gh pr create`** from `ask_cmd_patterns` |
| N3 | Scaffolder validates config against schema before hydrating | **The schema now requires `pull_request`; the frontend repo's own config doesn't have it** — re-running the current scaffolder against that repo would hard-fail today |
| N4 | Config values are schema-validated before use | **`CHANGE_ME-architecture-team` and `CHANGE_ME-engineering` ship live** in the frontend repo's config and pass validation |
| N5 | "Re-run the scaffolder... vendored core is always safe to overwrite" | **Two repos, scaffolded 2 days apart from the same framework, already carry framework files that differ by 30-280 lines each** — no version marker anywhere records which framework revision either one is on |

Plus the original C1–C5 / H1–H8 findings from the prior review — re-verified below, most still open.

**My overall read:** the framework is doing its job of getting two teams shipping fast, but the
things it was built to mechanically guarantee are, in practice, silently not happening for one of
the two teams, and neither team's local drift would be caught by anything short of a manual diff.
The fixes are still cheap — most of this section is under a day of work — but it needs to happen
before a third team onboards, because the failure mode is silent, not loud.

---

## How I reviewed this

- Re-read the framework repo at current HEAD (`1bbd422`) and diffed it against the prior review's
  findings to see what moved.
- Read both consuming repos' `.claude/`, `project.config.yml`, `CLAUDE.md`, CI workflows, ADRs,
  and vendored hook/agent files in full.
- **Executed** the real `include_glob` values from both repos' configs against real file paths
  from those repos' actual `src/` trees, using the same POSIX `case` matching the hooks use.
- **Executed** `scripts/validate-config.mjs` (current framework version) against both repos'
  committed `project.config.yml` files.
- Diffed each repo's vendored `.claude/agents/*.md` and `.claude/hooks/*.sh` against the
  framework's current versions, line-for-line.
- Grepped both repos' CI workflows and `ask_cmd_patterns` for the `gh pr create` gate the docs
  call load-bearing.

Every claim below is reproducible with the commands in the [Appendix](#appendix-reproduction-commands-2026-08-04).

---

## NEW — findings from real-world usage

### N1. `verify_hook.include_glob` never matches a single file in registration-frontend · **verified, currently live**

The frontend's config sets:

```yaml
verify_hook:
  include_glob: 'src/**/*.{ts,tsx}'
```

`hooks/verify-loop.sh:104-107` matches this against `$REL_PATH` with a plain POSIX `case`
statement (comment at `:100-103` explicitly defends this as "the standard, safe way"). POSIX
`case` patterns support `*`, `?`, and `[...]` — they do **not** support brace alternation
(`{ts,tsx}`). Brace expansion is a separate shell feature that does not apply inside a `case`
pattern, in either `sh` or `bash`:

```
$ case "src/App.tsx" in src/**/*.{ts,tsx}) echo MATCH ;; *) echo NOMATCH ;; esac
NOMATCH          # reproduced identically under both sh and bash
```

I ran this against three real files from the frontend's actual `src/` tree (`App.tsx`,
`main.tsx`, `components/Foo.tsx`-style paths) — all three, and every other `.ts`/`.tsx` file in
the repo, take the `*) exit 0` branch at `hooks/verify-loop.sh:107`. **Phase 1 lint/test has never
run once for this repo**, since the day it was scaffolded — not for one file, not intermittently.
It exits 0 silently, so nothing in the transcript or in CI would show this; it looks identical to
"nothing needed checking."

This is a more severe instance of the previous review's C3 finding (POSIX `case` vs. minimatch
`**`) — that one degraded coverage at directory boundaries; this one is a total outage, because
`{a,b}` alternation is common in any multi-extension frontend glob and the config schema doesn't
warn that it's unsupported.

The backend's simpler `src/**/*.ts` glob (no braces) partially works — it matches nested files
like `src/core/domain/user.ts` — but still silently skips anything directly under `src/`, e.g.
the real file `src/app.module.ts` (reproducing the original C3 finding against a live file, not
a hypothetical one).

**Fix:** this is the same underlying defect as the previous review's C3, now with proof it's not
theoretical. Replace the POSIX `case` glob engine with real minimatch semantics (Node's
`picomatch` or `fs.glob`), and add a scaffold-time or validate-time smoke test: glob-match every
file currently in the repo's tracked tree against `include_glob` and warn if the match count is
zero — that alone would have caught this the day the frontend was scaffolded.

### N2. Neither real repo gates `gh pr create` · **verified**

`docs/CONFORMANCE.md:63,134,151` all describe the triad **`git commit` + `git push` + `gh pr create`**
in `ask_cmd_patterns` as the mechanism that makes "no unreviewed commit reaches the remote" hold.
All three starter templates (`templates/stacks/*.config.yml`) include all three. But both real
repos' committed `project.config.yml` have only:

```yaml
ask_cmd_patterns:
  - 'git commit'
  - 'git push'
```

`gh pr create` is missing from both. Since `permissions.ask` only grants an `ask` gate for
patterns actually listed, PR creation in both real repos currently proceeds without the
human-approval prompt the framework's own documentation calls essential. `validate-config.mjs`
has no semantic check requiring it (it only checks the `ai-assisted` PR label, `scripts/validate-config.mjs:60-65`).

**Fix:** add a `semanticChecks` rule requiring `git commit`, `git push`, and `gh pr create` all be
present in `ask_cmd_patterns` — the same treatment the previous review recommended for H2's
`git commit` gap, extended to the full triad CONFORMANCE calls load-bearing. This is a five-line
validator change that closes a currently-open hole in two production repos today.

### N3. Schema/validator drift means the frontend repo would fail its own next scaffold run · **verified**

The framework's schema (`project.config.schema.json`) now requires a top-level `pull_request`
block (`required_labels`, enforced by a recent commit adding governance PR labels). Running the
**current** framework's validator against the frontend's **committed** config:

```
node scripts/validate-config.mjs --config .../registration-frontend/project.config.yml
✗ Config validation failed (1 issue):
  - (root) must have required property 'pull_request' {"missingProperty":"pull_request"}
```

The backend's config does have a `pull_request` block (it was scaffolded/edited more recently),
so it happens to pass. But both repos' **vendored copies** of `project.config.schema.json` and
`scripts/validate-config.mjs` are the *old* pre-`pull_request` versions — so today, in both repos,
the locally-run `validate-config.mjs` (the one CI and `SessionStart` actually invoke) reports
success on both, while the framework's own current version would reject the frontend's config
outright. Nobody would notice until someone re-runs the scaffolder to pick up an unrelated fix,
at which point the frontend repo hard-fails with no warning it was coming.

**Fix:** this is M4 from the prior review (no version stamping) causing a concrete, dated
incident-in-waiting rather than a hypothetical one. Minimum fix: write `.claude/.ai-sdlc-version`
(framework commit SHA) on every scaffold run, and have `SessionStart` diff it against the
framework's current SHA (if reachable) or at least log it so "which revision is this repo on" is
answerable without a file-by-file diff.

### N4. Config placeholders ship to a live repo and pass validation · **verified**

The frontend's `project.config.yml` has, right now:

```yaml
team:
  name: 'CHANGE_ME-engineering'
tiers:
  C_needs_reviewer: 'CHANGE_ME-architecture-team'
```

`scaffold.mjs`'s own `findTeamAuthoredStubs` mechanism (used for `CLAUDE.md`/`REVIEW.md`) detects
`<<TEAM_AUTHORED` markers and warns at scaffold time — but `project.config.yml`'s `CHANGE_ME`
convention isn't the same sentinel and `validate-config.mjs` never checks for it (confirmed: zero
matches for `CHANGE_ME` in the validator). So a Tier C task in this repo today would name
`CHANGE_ME-architecture-team` as the required reviewer in the PR body — a name that resolves to
nobody.

**Fix:** add a `semanticChecks` rule: reject (or at minimum warn) any string value in the config
matching `/^CHANGE_ME/`, with a message naming the offending field. Cheap, and it turns a silent
placeholder-in-prod into a loud scaffold/CI failure.

### N5. Vendored copies have already diverged, 5 files deep, after 2 days · **verified**

Both repos vendor the same five core framework files (`agents/coordinator.md`,
`implementor.md`, `verifier.md`, `hooks/verify-loop.sh`, `hooks/implementor-git-guard.sh`).
Line-count diff against the framework's current versions:

| File | Backend Δ | Frontend Δ | Framework current |
|---|---|---|---|
| `agents/coordinator.md` | 282 lines different | 282 lines different | 154 lines |
| `agents/implementor.md` | 178 lines different | 178 lines different | 90 lines |
| `agents/verifier.md` | 173 lines different | 173 lines different | 87 lines |
| `hooks/verify-loop.sh` | 446 lines different | 446 lines different | 223 lines |
| `hooks/implementor-git-guard.sh` | 252 lines different | 252 lines different | 131 lines |

Both repos are on the *same*, older vendored snapshot as each other (their own diffs against
each other are 0), but that snapshot predates a large batch of framework commits (the coordinator
rewrite, the PR-label feature, the `implementor-git-guard.sh` "not wired by default" pivot,
comment updates explaining *why* the guard isn't hooked up by default). Neither repo's `CLAUDE.md`
or agent contracts mention any of this — a developer in either repo reading `agents/verifier.md`
today is reading a materially different contract than what's in the framework repo, with no
signal that anything has moved.

**Fix:** same root cause as N3/M4 — ship version stamping, and make "framework SHA in the
consuming repo is N commits behind" a visible, actionable warning rather than something you can
only discover by diffing files by hand (which is what this review had to do).

---

## Original findings — re-verified at current HEAD

Re-checked against framework commit `1bbd422`. Status column reflects what changed since the
2026-08-03 review; unlabeled items are unchanged.

| # | Finding | Status |
|---|---|---|
| C1 | Git guard bypassable | **Reframed, not fixed.** `hooks/implementor-git-guard.sh` now carries an explicit header (added `59ca286`) stating it's **intentionally not wired by default** — the framework pivoted to relying on human-approval `ask_cmd_patterns` gates instead, and documents this rationale in `CONFORMANCE.md` item B.1. That's an honest, defensible design change, but it means the *hook* findings below (bypass vectors) are moot only because the hook is unused; the human-approval gate it was replaced by is exactly what N2 found broken in production. |
| C2 | `eval`-based command injection via filename | **Still open.** `escape_sed_repl`/`eval` pattern unchanged in `hooks/verify-loop.sh:51-206`. |
| C3 | POSIX `case` glob vs. minimatch `**` | **Still open, and now proven live** — see N1 above. |
| C4 | Scaffolder never re-hydrates `settings.json` on rerun | **Still open.** `hydrateSettings` (`scripts/scaffold.mjs:216`) still reads from `outPath` when it already exists, and the `<<FROM_CONFIG:...>>` sentinels are consumed on first run — a second scaffold still cannot pick up newly-added `ask_write_paths`/etc. |
| C5 | Nothing protects the framework's own control files | **Still open.** `settings.base.json`'s `deny` list is still only the two `<<FROM_CONFIG:...>>` sentinels — no hardcoded protection for `.claude/**`, `project.config.yml`, etc. |
| H1 | Scaffolder hard-fails on Windows (`spawnSync('npm', ...)` without `shell:true`) | **Still open** in `scripts/scaffold.mjs:336`. Notably, both real pilot repos were scaffolded on Windows (this user's machine) and both use `pnpm`, not `npm` — meaning the actual workaround in practice was likely `--skip-install`, not a fix. |
| H2 | Root reference config missing `git commit` from `ask_cmd_patterns` | **Still open** — root `project.config.yml` still has zero occurrences of `git commit`. Superseded in importance by N2 (both *real* repos have `git commit` but are missing `gh pr create`). |
| H3 | Phase 2 runs on every `Stop`/`SubagentStop`, no budget | **Still open** — `hooks/verify-loop.sh:218` still dispatches both events to `run_phase2` unconditionally. |
| H4 | `audit: static` rules have no binding to an actual check | **Still open** — no `check_cmd` field exists in the schema. |
| H5 | `observability` config is dead | **Still open**, and now inconsistent across repos too: root config sets `enabled: true` with a real collector endpoint; both real repos correctly set `enabled: false` (the safer default), but nothing in the schema or docs tells a team which is expected, since the feature does nothing either way. |
| H6 | `docs/reviews/` created but nothing writes to it | **Still open**, and inconsistently scaffolded: the frontend repo has empty `docs/specs/` and `docs/reviews/` directories (with `.gitkeep`); **the backend repo has neither directory at all** — further evidence of N5's version drift, since a later scaffold commit must have added them. |
| H7 | Tier D/E hard stops are prompt-only, no mechanical ADR check | **Still open**, though the backend repo shows the *intended* discipline working manually: it has a real, `Accepted` ADR (`0002b-api-gateway-lambda-authorizer.md`) backing a Tier D auth architecture decision. That's the process working by developer diligence, not by framework enforcement — exactly the gap H7 identified. |
| H8 | No tests/CI for the framework itself | **Still open** — `.github`, `test/`, `LICENSE`, `CHANGELOG.md`, `CONTRIBUTING.md`, `Makefile` are all still missing from the framework repo. Notably, **both consuming repos now have full CI, CODEOWNERS, commit-lint, and branch-validation workflows** — the framework is teaching its consumers a rigor it doesn't apply to itself. |
| M1–M11, L1–L6 | Doc drift, hook-scoping description errors, secret-read gaps, monorepo/glob-array limits, etc. | **Unchanged** — not re-verified line-by-line this pass; nothing above touched their root causes. See the 2026-08-03 findings for detail. |

---

## What real usage validated (don't break these)

Worth stating explicitly, since a review that only lists gaps risks reading as "this doesn't
work": both pilot repos demonstrate the framework's actual value in ways worth protecting during
any fix:

- **CLAUDE.md hydration reads well.** Both repos' generated `CLAUDE.md` correctly describes the
  agentic loop, points to the right files, and doesn't feel templated — teams are actually reading
  and trusting it.
- **The PR/branch/commit governance layer (CODEOWNERS, `docs/BRANCHING.md`, commitlint,
  branch-name validation) is fully wired and running in real CI** in both repos — this is the part
  of the framework's promise that's furthest ahead of what CONFORMANCE.md still marks uncertain.
- **`hard_rules` and `tiers` are being filled in with real, specific content** (e.g. the frontend's
  `no-token-in-storage-logs` rule naming exact files) rather than left as starter boilerplate —
  teams are engaging with the config as a real contract, not rubber-stamping it.

---

## Suggested order of work (updated)

**Immediate — closes live gaps in the two real repos, no framework redesign needed**
1. N2 — add `gh pr create` to both real repos' `ask_cmd_patterns` directly (2-line YAML edit ×2),
   *and* add the validator rule so it can't regress. *~20 min.*
2. N4 — replace `CHANGE_ME-engineering` / `CHANGE_ME-architecture-team` in the frontend's config
   with real values; add the validator rule to catch future placeholders. *~15 min + validator rule ~20 min.*
3. N1 — fix the frontend's `include_glob` immediately by switching to a pattern POSIX `case` can
   express (e.g. two entries or drop brace syntax) as a stopgap; this is urgent because Phase 1
   verification is currently a no-op for that entire repo. *~10 min stopgap.*

**Day 1 — the framework-level fixes those live gaps trace back to**
4. C3/N1 — real minimatch glob matching in `verify-loop.sh`, plus a scaffold/validate-time
   "does this glob match anything in the repo?" smoke test. *~2-3 h.*
5. N3/N5/M4 — version stamping (`.claude/.ai-sdlc-version`), so drift is visible instead of
   requiring a manual file diff to discover (which is how every N-finding above was found).
   *~2 h.*
6. N2/N4 as permanent validator rules (`gh pr create` triad + `CHANGE_ME` rejection), not just
   the two-repo patch above. *~1 h combined.*

**Then continue with the original review's Day 1–5 plan** (C5 framework self-protection, H1
Windows fix, C2 injection fix, C4 re-hydration fix, H8 test suite + CI) — none of that changed,
and H8 remains the highest-leverage single item: a test suite would have caught N1 (glob smoke
test), N2 (required-pattern check), and N4 (placeholder check) automatically, the same way it
would have caught the original C1–C4.

---

## Appendix: reproduction commands (2026-08-04)

```sh
# N1 — {ts,tsx} brace glob never matches under POSIX case (sh and bash both)
case "src/App.tsx" in src/**/*.{ts,tsx}) echo MATCH ;; *) echo NOMATCH ;; esac
# -> NOMATCH, reproduced for every real file in registration-frontend/src

# N1 (backend) — src/**/*.ts silently skips files directly under src/
case "src/app.module.ts" in src/**/*.ts) echo MATCH ;; *) echo NOMATCH ;; esac
# -> NOMATCH, even though src/app.module.ts is a real, currently-tracked file

# N2 — gh pr create missing from both real repos
grep -A3 'ask_cmd_patterns' .../registration-backend/project.config.yml
grep -A3 'ask_cmd_patterns' .../registration-frontend/project.config.yml
# both list only git commit, git push

# N3 — current framework validator rejects the frontend's committed config
node scripts/validate-config.mjs --config .../registration-frontend/project.config.yml
# -> ✗ (root) must have required property 'pull_request'

# N4 — CHANGE_ME placeholders present and unvalidated
grep -n "CHANGE_ME" .../registration-frontend/project.config.yml
grep -c "CHANGE_ME" scripts/validate-config.mjs   # -> 0, i.e. never checked

# N5 — vendored file drift vs. framework HEAD
for f in agents/coordinator.md agents/implementor.md agents/verifier.md \
         hooks/verify-loop.sh hooks/implementor-git-guard.sh; do
  diff ".../registration-backend/.claude/$f" "$f" | grep -c '^[<>]'
done
```

For the full C1–C5/H1–H8/M1–M11/L1–L6 reproduction commands (git guard bypass matrix, `eval`
injection payload, npm-on-Windows ENOENT, settings.json re-hydration diff), see the appendix in
the 2026-08-03 revision of this document (preserved in git history at commit `4e0bed1`).
