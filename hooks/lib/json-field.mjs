#!/usr/bin/env node
// Generic Claude Code hook-payload field extractor for POSIX-shell hooks.
//
// Usage: printf '%s' "$PAYLOAD" | node json-field.mjs VAR=dotted.path ...
// Prints shell-safe `VAR='value'` assignment lines to stdout — the caller
// does `eval "$(...)"`. Unlike config-reader.mjs, a missing field becomes
// an EMPTY string rather than a fatal error: hook payloads legitimately
// omit fields depending on which tool fired the event (e.g.
// tool_input.command is absent for a Write tool call), and that absence
// is meaningful signal for the caller to branch on, not a config defect.

import { readFileSync } from 'node:fs';

function shQuote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

function getPath(obj, dotted) {
  let cur = obj;
  for (const key of dotted.split('.')) {
    if (cur === null || typeof cur !== 'object' || !(key in cur)) return undefined;
    cur = cur[key];
  }
  return cur;
}

let raw;
try {
  raw = readFileSync(0, 'utf8'); // fd 0 = stdin
} catch (err) {
  console.error(`json-field: could not read stdin: ${err.message}`);
  process.exit(1);
}

let payload;
try {
  payload = raw.trim() === '' ? {} : JSON.parse(raw);
} catch (err) {
  console.error(`json-field: stdin is not valid JSON: ${err.message}`);
  process.exit(1);
}

const requests = process.argv.slice(2);
const lines = [];
for (const req of requests) {
  const eq = req.indexOf('=');
  if (eq === -1) {
    console.error(`json-field: malformed request "${req}", expected VAR=dotted.path`);
    process.exit(1);
  }
  const varName = req.slice(0, eq);
  const dotted = req.slice(eq + 1);
  const value = getPath(payload, dotted);
  lines.push(`${varName}=${shQuote(value === undefined || value === null ? '' : value)}`);
}

process.stdout.write(lines.join('\n') + '\n');
