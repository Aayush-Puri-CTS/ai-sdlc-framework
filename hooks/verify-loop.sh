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

# Substitutes the {file} / {base} placeholders used throughout
# stack.lint_cmd, stack.test_cmd, and verify_hook.test_pattern.
# Requires REL_PATH and BASE_NAME to already be set by the caller.
substitute_placeholders() {
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

  # Out of scope for this hook entirely — not in include_glob. $INCLUDE_GLOB
  # is intentionally unquoted here: case patterns are not subject to field
  # splitting, so this is the standard, safe way to use it as a glob.
  # shellcheck disable=SC2254  # intentional: $INCLUDE_GLOB is used AS the glob pattern here.
  case "$REL_PATH" in
    $INCLUDE_GLOB) : ;;
    *) exit 0 ;;
  esac

  # Explicitly excluded even though it matched include_glob. $SKIP_GLOBS is
  # intentionally unquoted in the `for` so it splits into individual glob
  # tokens (globs are assumed not to contain spaces).
  for _pat in $SKIP_GLOBS; do
    # shellcheck disable=SC2254  # intentional: $_pat is used AS the glob pattern here.
    case "$REL_PATH" in
      $_pat) exit 0 ;;
    esac
  done

  # {base} = filename without directory or extension, for {base}Test-style
  # placeholders in test_cmd / test_pattern.
  BASE_NAME=${REL_PATH##*/}
  BASE_NAME=${BASE_NAME%.*}

  # Loop-budget bookkeeping is per session+file so two files (or two
  # sessions editing the same file) never share a counter.
  STATE_KEY=$(printf '%s' "$SESSION_ID:$REL_PATH" | tr -c 'A-Za-z0-9._-' '_')
  STATE_FILE="$STATE_DIR/$STATE_KEY.count"
  ATTEMPT_COUNT=0
  [ -f "$STATE_FILE" ] && ATTEMPT_COUNT=$(cat "$STATE_FILE" 2>/dev/null)
  case "$ATTEMPT_COUNT" in *[!0-9]*|'') ATTEMPT_COUNT=0 ;; esac

  LINT_RESOLVED=$(substitute_placeholders "$LINT_CMD")
  LINT_OUTPUT=$(cd "$REPO_ROOT" && eval "$LINT_RESOLVED" 2>&1)
  LINT_STATUS=$?

  TEST_OUTPUT=""
  TEST_STATUS=0
  if [ "$LINT_STATUS" -eq 0 ]; then
    # Only run the (usually slower) test command once lint has already
    # passed — fail fast, and avoid reporting the same break twice.
    TEST_FILE_PATTERN=$(substitute_placeholders "$TEST_PATTERN")
    case "$REL_PATH" in
      */*) TEST_DIR=${REL_PATH%/*} ;;
      *) TEST_DIR="." ;;
    esac

    FILE_BASENAME=${REL_PATH##*/}
    HAS_TEST=0
    # shellcheck disable=SC2254  # intentional: $TEST_FILE_PATTERN is used AS the glob pattern here.
    case "$FILE_BASENAME" in
      # The edited file already matches test_pattern itself — it IS the
      # test, so verify it directly rather than looking for a companion.
      $TEST_FILE_PATTERN) HAS_TEST=1 ;;
      *)
        [ -f "$REPO_ROOT/$TEST_DIR/$TEST_FILE_PATTERN" ] && HAS_TEST=1
        ;;
    esac

    if [ "$HAS_TEST" = "1" ]; then
      TEST_RESOLVED=$(substitute_placeholders "$TEST_CMD")
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
