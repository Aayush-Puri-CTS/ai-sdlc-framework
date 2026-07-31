#!/usr/bin/env node
// Generic project.config.yml field extractor for POSIX-shell hooks.
//
// Usage: node config-reader.mjs VAR_NAME=dotted.path.to.field ...
// Prints shell-safe `VAR_NAME='value'` assignment lines to stdout, one per
// argument, in the order given — the caller does `eval "$(...)"`.
// Arrays of scalars are space-joined (globs/paths are assumed not to
// contain spaces).
//
// Exits 1 with a message on stderr if the config file is missing,
// unparseable, or if any REQUESTED field is absent. Absence is a hard
// failure here (unlike the hook-payload reader) — a hook must never
// proceed with a silently-empty value for a binding it explicitly asked
// for. This is the mechanical half of the fail-safe contract in
// AI-SDLC-FRAMEWORK-SPEC.md section 4; the calling shell script is
// responsible for turning this exit 1 into the hook's exit 2.

import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';

// PROJECT_CONFIG_PATH lets callers point at a config outside the current
// working directory (used by verify-loop.sh, which resolves it to the
// hook payload's repo root rather than assuming its own cwd).
const CONFIG_PATH = path.resolve(process.env.PROJECT_CONFIG_PATH || 'project.config.yml');

function die(msg) {
  console.error(`config-reader: ${msg}`);
  process.exit(1);
}

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

if (!existsSync(CONFIG_PATH)) {
  die(`project.config.yml not found at ${CONFIG_PATH}.`);
}

let config;
try {
  config = yaml.load(readFileSync(CONFIG_PATH, 'utf8'));
} catch (err) {
  die(`project.config.yml is not valid YAML: ${err.message}`);
}

if (config === null || typeof config !== 'object') {
  die('project.config.yml did not parse to a mapping.');
}

const requests = process.argv.slice(2);
if (requests.length === 0) {
  die('no fields requested. Usage: config-reader.mjs VAR=dotted.path ...');
}

const lines = [];
for (const req of requests) {
  const eq = req.indexOf('=');
  if (eq === -1) die(`malformed request "${req}", expected VAR=dotted.path`);
  const varName = req.slice(0, eq);
  const dotted = req.slice(eq + 1);
  const value = getPath(config, dotted);
  if (value === undefined || value === null) {
    die(`project.config.yml is missing required field "${dotted}" (requested as ${varName}).`);
  }
  const flat = Array.isArray(value) ? value.join(' ') : value;
  lines.push(`${varName}=${shQuote(flat)}`);
}

process.stdout.write(lines.join('\n') + '\n');
