#!/usr/bin/env node
// hooks/session-start-handoff.mjs
//
// SessionStart hook: if a previous session left a handoff note at
// .claude/hooks/.state/HANDOFF.md (written by the session-handoff skill,
// templates/skills/session-handoff/SKILL.md), surface it as additional
// context for this session. This is the mechanical half of "feed a
// handoff doc into a clean session" — the skill is the half that writes
// it.
//
// Silent and non-blocking by design: no handoff file is the
// overwhelmingly common case, and this must never be the reason a
// session fails to start — a missing or unreadable file exits 0 with no
// output, never an error. Emits Claude Code's SessionStart
// hookSpecificOutput.additionalContext JSON contract to inject the
// handoff content; if that contract has changed since this was written,
// this is the line to check first against current Claude Code hook
// documentation — intentionally does not fail loudly on a schema
// mismatch, since a SessionStart hook blocking session start over that
// would be a worse failure mode than silently not injecting the note.
//
// $CLAUDE_PROJECT_DIR is read from the environment (inherited from the
// same shell Claude Code expands it in to locate this very script in
// settings.json — see hooks/verify-loop.sh's own HOOK_CWD comment for
// why state is always resolved relative to the repo root, never to
// wherever this script happens to be vendored).
//
// Does not delete or modify HANDOFF.md itself. SessionStart also fires
// on /clear and /compact, not only a genuinely new session — destructively
// consuming the file on any of those would risk losing a note before a
// truly fresh session ever saw it. Clearing it once consumed is left to
// whoever reads it (see the instruction this script injects, and
// agents/coordinator.md's Context Management section).

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const REPO_ROOT = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const HANDOFF_FILE = path.join(REPO_ROOT, '.claude', 'hooks', '.state', 'HANDOFF.md');

if (!existsSync(HANDOFF_FILE)) {
  process.exit(0);
}

let content;
try {
  content = readFileSync(HANDOFF_FILE, 'utf8');
} catch {
  process.exit(0);
}

process.stdout.write(
  JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext:
        'A previous session left a handoff note below. Read it, and once its ' +
        'content is incorporated or confirmed stale, delete ' +
        '.claude/hooks/.state/HANDOFF.md yourself so it does not keep ' +
        'resurfacing on future session starts.\n\n---\n' +
        content,
    },
  })
);
