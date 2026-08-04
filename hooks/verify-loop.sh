#!/bin/sh
# hooks/verify-loop.sh
#
# Config-driven two-phase verification hook (AI-SDLC-FRAMEWORK-SPEC.md
# section 4). Wired as BOTH:
#   - a PostToolUse hook -> phase 1: fast, single-file lint+test right
#     after an edit, scoped to verify_hook.include_glob.
#   - a Stop (and SubagentStop) hook -> phase 2: broad compile/typecheck
#     (stack.extra_validate_cmd) before a turn is allowed to end.
# Every command, glob, and threshold is read from project.config.yml —
# this script must never hardcode a stack's tools (no *.ts, jest, pnpm).
#
# Fail-safe: missing/malformed config, missing Node, or an unrecognized
# hook event all block (exit 2) rather than silently passing.

set -u

# Resolve this script's own directory (POSIX-portable, handles symlinks
# via -- to protect against a dash-prefixed dirname) so we can find the
# sibling lib/ helpers regardless of whether we're running from hooks/
# (this framework repo) or .claude/hooks/ (a vendored consuming repo).
# shellcheck disable=SC1007  # CDPATH= is an intentional empty-value prefix assignment, not a typo.
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
LIB_DIR="$SCRIPT_DIR/lib"

# shellcheck source=lib/common.sh
. "$LIB_DIR/common.sh"

require_node_or_die
capture_stdin

# HOOK_CWD is the project root Claude Code launched the session from. We
# resolve project.config.yml and .state/ relative to THAT, not to this
# script's own location, so state always lands at the spec-mandated
# "<repo-root>/.claude/hooks/.state/" no matter where the hook is vendored.
hook_field HOOK_EVENT=hook_event_name SESSION_ID=session_id \
  FILE_PATH=tool_input.file_path HOOK_CWD=cwd

REPO_ROOT=${HOOK_CWD:-$(pwd)}
STATE_DIR="$REPO_ROOT/.claude/hooks/.state"
mkdir -p "$STATE_DIR" 2>/dev/null || {
  echo "verify-loop.sh: could not create state directory $STATE_DIR." >&2
  exit 2
}

PROJECT_CONFIG_PATH="$REPO_ROOT/project.config.yml"
export PROJECT_CONFIG_PATH

# Escapes '&', backslash, and the sed delimiter '|' in $1 so it is safe to
# drop into a sed replacement, even if a file path happens to contain one.
escape_sed_repl() {
  printf '%s' "$1" | sed 's/[&\\|]/\\&/g'
}

# Wraps $1 in single quotes for safe use as ONE shell word, escaping any
# embedded single quote as '\'' (close quote, escaped literal quote,
# reopen quote) — the standard POSIX idiom, mirroring config-reader.mjs's
# shQuote(). Needed because REL_PATH/BASE_NAME come from tool_input, which
# is agent-controlled, not team-authored — a filename like
# "x; rm -rf ~ #.kt" must reach `eval` as one literal argument, never as
# shell syntax.
shell_quote() {
  printf "'%s'" "$(printf '%s' "$1" | sed "s/'/'\\\\''/g")"
}

# Substitutes {file} / {base} for values that end up inside `eval`
# (LINT_CMD / TEST_CMD). Each value is shell-quoted FIRST, then the
# already-quoted result is sed-escaped — order matters: sed's own
# unescaping reconstructs exactly the quoted text, so the quoting must be
# the innermost layer, or the escaping-for-sed and quoting-for-shell steps
# fight each other. Requires REL_PATH and BASE_NAME to already be set.
substitute_for_eval() {
  _file_q=$(escape_sed_repl "$(shell_quote "$REL_PATH")")
  _base_q=$(escape_sed_repl "$(shell_quote "$BASE_NAME")")
  printf '%s' "$1" | sed "s|{file}|$_file_q|g; s|{base}|$_base_q|g"
}

# Substitutes {file} / {base} for values that are only ever glob-matched
# or filesystem-tested (verify_hook.test_pattern) — NEVER eval'd. Must
# stay unquoted: every real test_pattern is a plain literal template like
# "{base}Test.kt" with no wildcards, and shell-quoting the substituted
# value would wrap it in literal apostrophes that then fail to match
# anything, silently disabling co-located-test detection framework-wide.
substitute_for_pattern() {
  _file_esc=$(escape_sed_repl "$REL_PATH")
  _base_esc=$(escape_sed_repl "$BASE_NAME")
  printf '%s' "$1" | sed "s|{file}|$_file_esc|g; s|{base}|$_base_esc|g"
}

run_phase1() {
  # Not a file edit (e.g. a Bash/Read/Grep tool call) — nothing to verify.
  # In practice the hook's settings.json matcher already restricts this
  # event to Write/Edit/MultiEdit, but we check defensively anyway.
  if [ -z "$FILE_PATH" ]; then
    exit 0
  fi

  config_field LINT_CMD=stack.lint_cmd TEST_CMD=stack.test_cmd \
    NO_INSTALL=stack.flags.no_install INCLUDE_GLOB=verify_hook.include_glob \
    TEST_PATTERN=verify_hook.test_pattern LOOP_BUDGET=verify_hook.loop_budget

  # skip_globs is the one optional field verify_hook has (a team may have
  # none) — treat "field absent" as an empty list rather than a fatal
  # config error, unlike every other field requested above.
  if SKIP_GLOBS_OUT=$(node "$LIB_DIR/config-reader.mjs" SKIP_GLOBS=verify_hook.skip_globs 2>/dev/null); then
    eval "$SKIP_GLOBS_OUT"
  else
    SKIP_GLOBS=""
  fi

  # Belt-and-suspenders re-check of the no-install safety attestation.
  # scripts/validate-config.mjs enforces this at scaffold/CI time, but the
  # config file can be hand-edited afterwards — re-verify at point of use.
  if [ "$NO_INSTALL" != "true" ]; then
    echo "verify-loop.sh: project.config.yml stack.flags.no_install must be true; refusing to run lint/test commands until it is." >&2
    exit 2
  fi

  # FILE_PATH from Claude Code is absolute; make it repo-root-relative so
  # it matches the globs in project.config.yml, which teams write relative
  # to the repo root (e.g. "app/src/**/*.kt").
  case "$FILE_PATH" in
    "$REPO_ROOT"/*) REL_PATH=${FILE_PATH#"$REPO_ROOT"/} ;;
    *) REL_PATH=$FILE_PATH ;;
  esac

  # {base} = filename without directory or extension; FILE_BASENAME keeps
  # the extension. Computed here (earlier than strictly needed for
  # include/skip alone) so TEST_FILE_PATTERN and FILE_BASENAME are both
  # ready for the single combined glob-match.mjs call below, rather than
  # needing a second node invocation later just for the test-pattern
  # question.
  BASE_NAME=${REL_PATH##*/}
  BASE_NAME=${BASE_NAME%.*}
  FILE_BASENAME=${REL_PATH##*/}
  TEST_FILE_PATTERN=$(substitute_for_pattern "$TEST_PATTERN")

  # One `node` call answers all three glob questions (include, skip,
  # "is this file itself the test") via real minimatch semantics —
  # POSIX `case` patterns don't support brace alternation at all and
  # don't implement minimatch's globstar rules, which caused a real,
  # total Phase-1 outage in a consuming repo (see hooks/lib/glob-match.mjs
  # for the full explanation). `set --` builds a variable-length argument
  # list (one --skip per configured skip glob) the POSIX-portable way.
  set -- --path "$REL_PATH" --basename "$FILE_BASENAME" --include "$INCLUDE_GLOB"
  for _pat in $SKIP_GLOBS; do
    set -- "$@" --skip "$_pat"
  done
  set -- "$@" --test-pattern "$TEST_FILE_PATTERN"
  if ! GLOB_MATCH_OUT=$(node "$LIB_DIR/glob-match.mjs" "$@" 2>&1); then
    echo "verify-loop.sh: glob-match.mjs failed: $GLOB_MATCH_OUT" >&2
    exit 2
  fi
  eval "$GLOB_MATCH_OUT"

  # Out of scope for this hook entirely — not in include_glob.
  if [ "$INCLUDE_MATCH" != "true" ]; then
    exit 0
  fi

  # Explicitly excluded even though it matched include_glob.
  if [ "$SKIP_MATCH" = "true" ]; then
    exit 0
  fi

  # Loop-budget bookkeeping is per session+file so two files (or two
  # sessions editing the same file) never share a counter.
  STATE_KEY=$(printf '%s' "$SESSION_ID:$REL_PATH" | tr -c 'A-Za-z0-9._-' '_')
  STATE_FILE="$STATE_DIR/$STATE_KEY.count"
  ATTEMPT_COUNT=0
  [ -f "$STATE_FILE" ] && ATTEMPT_COUNT=$(cat "$STATE_FILE" 2>/dev/null)
  case "$ATTEMPT_COUNT" in *[!0-9]*|'') ATTEMPT_COUNT=0 ;; esac

  LINT_RESOLVED=$(substitute_for_eval "$LINT_CMD")
  LINT_OUTPUT=$(cd "$REPO_ROOT" && eval "$LINT_RESOLVED" 2>&1)
  LINT_STATUS=$?

  TEST_OUTPUT=""
  TEST_STATUS=0
  if [ "$LINT_STATUS" -eq 0 ]; then
    # Only run the (usually slower) test command once lint has already
    # passed — fail fast, and avoid reporting the same break twice.
    case "$REL_PATH" in
      */*) TEST_DIR=${REL_PATH%/*} ;;
      *) TEST_DIR="." ;;
    esac

    HAS_TEST=0
    if [ "$TEST_SELF_MATCH" = "true" ]; then
      # The edited file already matches test_pattern itself — it IS the
      # test, so verify it directly rather than looking for a companion.
      HAS_TEST=1
    elif [ -f "$REPO_ROOT/$TEST_DIR/$TEST_FILE_PATTERN" ]; then
      HAS_TEST=1
    fi

    if [ "$HAS_TEST" = "1" ]; then
      TEST_RESOLVED=$(substitute_for_eval "$TEST_CMD")
      TEST_OUTPUT=$(cd "$REPO_ROOT" && eval "$TEST_RESOLVED" 2>&1)
      TEST_STATUS=$?
    else
      # No co-located test yet is not itself a failure — implementors
      # legitimately write app code before its test in some flows. Say so
      # (advisory, non-blocking) rather than silently skipping the check.
      echo "verify-loop.sh: no co-located test found yet for $REL_PATH (expected $TEST_DIR/$TEST_FILE_PATTERN) — skipping test run, not blocking." >&2
    fi
  fi

  if [ "$LINT_STATUS" -eq 0 ] && [ "$TEST_STATUS" -eq 0 ]; then
    rm -f "$STATE_FILE"
    exit 0
  fi

  NEW_COUNT=$((ATTEMPT_COUNT + 1))

  if [ "$NEW_COUNT" -gt "$LOOP_BUDGET" ]; then
    # Budget exhausted: stop blocking this file and flag it for a human
    # instead of looping the agent forever on the same failure.
    TIMESTAMP=$(date -u +%Y-%m-%dT%H:%M:%SZ 2>/dev/null) || TIMESTAMP="unknown-time"
    echo "$TIMESTAMP session=$SESSION_ID file=$REL_PATH loop_budget=$LOOP_BUDGET" >> "$STATE_DIR/needs-human-review.log"
    echo "verify-loop.sh: $REL_PATH has failed verification $NEW_COUNT times (loop_budget=$LOOP_BUDGET). Flagged for human review in .claude/hooks/.state/needs-human-review.log; no longer blocking this file automatically." >&2
    rm -f "$STATE_FILE"
    exit 1
  fi

  printf '%s' "$NEW_COUNT" > "$STATE_FILE"
  {
    echo "verify-loop.sh: verification failed for $REL_PATH (attempt $NEW_COUNT/$LOOP_BUDGET)."
    if [ "$LINT_STATUS" -ne 0 ]; then
      echo "--- lint ($LINT_RESOLVED) exited $LINT_STATUS ---"
      echo "$LINT_OUTPUT"
    fi
    if [ "$TEST_STATUS" -ne 0 ]; then
      echo "--- test (${TEST_RESOLVED:-skipped}) exited $TEST_STATUS ---"
      echo "$TEST_OUTPUT"
    fi
  } >&2
  exit 2
}

run_phase2() {
  config_field EXTRA_VALIDATE_CMD=stack.extra_validate_cmd
  VALIDATE_OUTPUT=$(cd "$REPO_ROOT" && eval "$EXTRA_VALIDATE_CMD" 2>&1)
  VALIDATE_STATUS=$?
  if [ "$VALIDATE_STATUS" -ne 0 ]; then
    echo "verify-loop.sh: broad validation failed (stack.extra_validate_cmd exited $VALIDATE_STATUS)." >&2
    echo "$VALIDATE_OUTPUT" >&2
    exit 2
  fi
  exit 0
}

case "$HOOK_EVENT" in
  PostToolUse) run_phase1 ;;
  Stop|SubagentStop) run_phase2 ;;
  *)
    echo "verify-loop.sh: unrecognized hook_event_name '$HOOK_EVENT' — refusing to silently no-op." >&2
    exit 2
    ;;
esac
