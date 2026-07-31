#!/bin/sh
# Shared helpers for AI-SDLC framework hooks. Sourced (`. "$LIB_DIR/common.sh"`),
# never executed directly. Callers must set LIB_DIR (the hooks/lib
# directory) before sourcing this file.
#
# Centralizing the Node-invocation boilerplate here means verify-loop.sh
# and implementor-git-guard.sh don't each duplicate the fail-safe checks —
# one place to get the "never silently no-op" contract right.

# Every hook depends on Node to parse YAML/JSON reliably (there is no
# portable, dependency-free JSON/YAML parser in POSIX shell). If Node is
# missing we cannot verify anything, so we block rather than skip checks.
require_node_or_die() {
  if ! command -v node >/dev/null 2>&1; then
    echo "$(basename -- "$0"): node is required to run AI-SDLC framework hooks but was not found on PATH." >&2
    exit 2
  fi
}

# Reads the hook's JSON payload from stdin exactly once into STDIN_JSON.
# Must run before any other stdin read in the script (stdin is not
# re-readable once consumed).
capture_stdin() {
  STDIN_JSON=$(cat)
}

# hook_field VAR=dotted.path [VAR=dotted.path ...]
# Defines shell variables from the captured hook payload. A field that is
# absent from the payload becomes an empty string (see json-field.mjs) —
# that's expected, not an error, so this only fails on a JSON parse
# problem, which should never happen with a well-formed Claude Code hook
# invocation.
hook_field() {
  _hf_out=$(printf '%s' "$STDIN_JSON" | node "$LIB_DIR/json-field.mjs" "$@")
  _hf_status=$?
  if [ "$_hf_status" -ne 0 ]; then
    echo "$(basename -- "$0"): failed to parse the hook payload JSON." >&2
    exit 2
  fi
  eval "$_hf_out"
}

# config_field VAR=dotted.path [VAR=dotted.path ...]
# Defines shell variables from project.config.yml. Fails closed (exit 2)
# if the config is missing, unparseable, or any requested field is absent
# — a hook must never proceed on a guessed/default value for a binding it
# depends on (AI-SDLC-FRAMEWORK-SPEC.md section 4, fail-safe contract).
config_field() {
  _cf_out=$(node "$LIB_DIR/config-reader.mjs" "$@")
  _cf_status=$?
  if [ "$_cf_status" -ne 0 ]; then
    echo "$(basename -- "$0"): blocking rather than guessing — see the config-reader error above." >&2
    exit 2
  fi
  eval "$_cf_out"
}
