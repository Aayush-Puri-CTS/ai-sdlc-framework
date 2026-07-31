#!/bin/sh
# hooks/implementor-git-guard.sh
#
# PreToolUse hook enforcing half of the framework's separation of duties:
# whoever it is attached to may not run git commands that mutate
# repository state (commit, push, merge, rebase, ...) — only a small
# read-only / local-setup allowlist is permitted. Language-agnostic and
# config-free by design (AI-SDLC-FRAMEWORK-SPEC.md section 2): git's own
# vocabulary doesn't change per tech stack, so this hook ships as-is and
# is never hydrated from project.config.yml.
#
# Scoping (READ THIS BEFORE WIRING IT UP): this script is deliberately
# role-agnostic — it does not attempt to detect "am I the Coordinator" at
# runtime. An earlier version tried an AI_SDLC_ROLE environment variable
# set by whichever role was executing, but Claude Code's Bash tool does
# not persist shell state (including exported env vars) across separate
# tool calls, and a state FILE written by an agent's own Write/Edit/Bash
# tools could just as easily be overwritten by that same (possibly
# confused, possibly prompt-injected) agent to impersonate the
# Coordinator — neither is a real mechanical boundary.
#
# The guarantee instead comes from WHERE this hook is registered: attach
# it only to the Implementor and Verifier subagent contexts (see
# agents/implementor.md and agents/verifier.md), never to the
# Coordinator's own (main-thread) context. The Coordinator is the one
# role this hook must never fire for, and it achieves that by not being
# wired there at all, not by recognizing the Coordinator and standing
# down. scripts/scaffold.mjs and docs/CONFORMANCE.md both call out
# verifying this attachment as a required post-scaffold check, since the
# exact per-subagent hook-scoping mechanism can vary by Claude Code
# version.
#
# Fail-safe: inability to parse the hook payload blocks (exit 2), never
# silently allows.

set -u

# shellcheck disable=SC1007  # CDPATH= is an intentional empty-value prefix assignment, not a typo.
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
LIB_DIR="$SCRIPT_DIR/lib"

# shellcheck source=lib/common.sh
. "$LIB_DIR/common.sh"

require_node_or_die
capture_stdin
hook_field TOOL_NAME=tool_name COMMAND=tool_input.command

# Only Bash tool calls can run git; nothing else to check.
if [ "$TOOL_NAME" != "Bash" ] || [ -z "$COMMAND" ]; then
  exit 0
fi

# git subcommands this hook's role may run freely: pure inspection, plus
# the two local/non-destructive setup actions AI-SDLC-FRAMEWORK-SPEC.md
# section 5 explicitly allows (git add, git checkout -b). Everything else
# is denied by default — the safe direction for a separation-of-duties
# guarantee is to under-permit, not over-permit, when a git subcommand is
# unrecognized.
SAFE_SUBCOMMANDS="status diff log show blame grep fetch add"

# Splits $1 (the full Bash command string) into individual clauses on the
# common command separators (`;`, `&&`, `||`, `|`), then for every clause
# that invokes `git`, prints "<subcommand>\t<full clause>" — one per line.
# The subcommand is the first token after `git` that isn't a global flag
# (e.g. skips the `-C <dir>` in `git -C repo commit ...`). This is a
# best-effort lexical scan, not a real shell parser — it errs toward
# over-blocking (a false positive just costs the agent a retry) rather
# than under-blocking, which is the safe direction for this guarantee.
extract_git_clauses() {
  printf '%s\n' "$1" | awk '
    {
      gsub(/&&|\|\||[;|]/, "\n")
      n = split($0, clauses, "\n")
      for (i = 1; i <= n; i++) {
        c = clauses[i]
        gsub(/^[ \t]+/, "", c)
        if (c == "") continue
        m = split(c, words, /[ \t]+/)
        if (words[1] != "git") continue
        subcmd = ""
        skip_next = 0
        for (j = 2; j <= m; j++) {
          if (skip_next) { skip_next = 0; continue }
          # -C <path> and -c <key>=<value> are global flags that take a
          # separate value token — skip that value too, not just the flag,
          # or we would misidentify the value as the subcommand.
          if (words[j] == "-C" || words[j] == "-c") { skip_next = 1; continue }
          if (substr(words[j], 1, 1) != "-") { subcmd = words[j]; break }
        }
        print subcmd "\t" c
      }
    }
  '
}

# The `while read` runs as the last stage of this pipe, so its exit status
# becomes the pipeline's exit status (POSIX: pipeline status = last
# command's status). That lets `exit 2` inside the loop propagate out to
# STATUS below without needing a variable to survive the subshell that a
# pipe's non-final stages run in.
extract_git_clauses "$COMMAND" | {
  while IFS="$(printf '\t')" read -r subcmd clause; do
    case " $SAFE_SUBCOMMANDS " in
      *" $subcmd "*) continue ;;
    esac
    if [ "$subcmd" = "checkout" ]; then
      case " $clause " in
        *" -b "*) continue ;;
      esac
    fi
    echo "implementor-git-guard.sh: blocked \"git $subcmd\" (from: $clause). Only the Coordinator may change git state — report completion and let the Coordinator commit/push." >&2
    exit 2
  done
}
STATUS=$?
if [ "$STATUS" -ne 0 ]; then
  exit "$STATUS"
fi

exit 0
