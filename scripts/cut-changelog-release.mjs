#!/usr/bin/env node
// Consolidates changelog.d/*.md fragments into a new dated CHANGELOG.md
// section, then deletes the fragments it consumed. Run at release time —
// automatically on a version tag push if this repo was scaffolded with
// --with-release (see templates/github/ai-sdlc-release.yml), or by hand
// otherwise.
//
// Why fragments instead of editing CHANGELOG.md's own "current release"
// section directly: multiple branches in flight at once would all be
// inserting text at the same anchor point in the same file, which is
// exactly the shape of change git's merge algorithm conflicts on most
// often. One fragment file per unit of work
// (changelog.d/<ticket-id>.<category>.md) means two branches never touch
// the same file, so they never conflict regardless of merge order, and a
// slow-to-merge branch's fragment simply rolls into whichever release cut
// happens after it lands — see docs/CONFORMANCE.md and
// changelog.d/README.md.
//
// Usage:
//   node scripts/cut-changelog-release.mjs --version <version> \
//     [--date <YYYY-MM-DD>] [--changelog <path>] [--fragments-dir <path>]

import { existsSync, readFileSync, writeFileSync, readdirSync, unlinkSync } from 'node:fs';
import path from 'node:path';

function die(msg) {
  console.error(`cut-changelog-release: ${msg}`);
  process.exit(1);
}

function parseArgs(argv) {
  const args = { version: null, date: null, changelog: 'CHANGELOG.md', fragmentsDir: 'changelog.d' };
  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case '--version': args.version = argv[++i]; break;
      case '--date': args.date = argv[++i]; break;
      case '--changelog': args.changelog = argv[++i]; break;
      case '--fragments-dir': args.fragmentsDir = argv[++i]; break;
      default:
        die(`unrecognized argument "${argv[i]}". Usage: cut-changelog-release.mjs --version <version> [--date <YYYY-MM-DD>] [--changelog <path>] [--fragments-dir <path>]`);
    }
  }
  if (!args.version) die('missing required --version <version>.');
  if (!args.date) args.date = new Date().toISOString().slice(0, 10);
  return args;
}

// Keep a Changelog's own category vocabulary, in its canonical display
// order — not alphabetical, not filesystem/creation order.
const CATEGORY_ORDER = ['added', 'changed', 'deprecated', 'removed', 'fixed', 'security'];
const CATEGORY_HEADINGS = {
  added: 'Added',
  changed: 'Changed',
  deprecated: 'Deprecated',
  removed: 'Removed',
  fixed: 'Fixed',
  security: 'Security',
};

// "<ticket-id>.<category>.md" -> { ticketId, category }, or null if it
// doesn't match that shape (no category segment, or an unrecognized one).
function parseFragmentFilename(filename) {
  const base = filename.slice(0, -path.extname(filename).length);
  const lastDot = base.lastIndexOf('.');
  if (lastDot === -1) return null;
  const ticketId = base.slice(0, lastDot);
  const category = base.slice(lastDot + 1);
  if (!ticketId || !CATEGORY_ORDER.includes(category)) return null;
  return { ticketId, category };
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!existsSync(args.fragmentsDir)) {
    console.log(`cut-changelog-release: ${args.fragmentsDir} doesn't exist — nothing to release.`);
    return;
  }

  const fragmentFiles = readdirSync(args.fragmentsDir).filter((f) => f.endsWith('.md') && f !== 'README.md');
  if (fragmentFiles.length === 0) {
    console.log(`cut-changelog-release: no fragments in ${args.fragmentsDir} — nothing to release.`);
    return;
  }

  // Validate and read every fragment BEFORE writing or deleting anything —
  // one malformed fragment should block the whole cut, not partially
  // consume the good ones and leave the bad one orphaned.
  const byCategory = {};
  for (const file of fragmentFiles) {
    const parsed = parseFragmentFilename(file);
    if (!parsed) {
      die(`${path.join(args.fragmentsDir, file)} doesn't match "<ticket-id>.<category>.md" (category must be one of ${CATEGORY_ORDER.join('/')}) — fix or remove it before cutting a release.`);
    }
    const content = readFileSync(path.join(args.fragmentsDir, file), 'utf8').trim();
    if (!content) {
      die(`${path.join(args.fragmentsDir, file)} is empty — fix or remove it before cutting a release.`);
    }
    (byCategory[parsed.category] ||= []).push({ ticketId: parsed.ticketId, content });
  }

  const sections = CATEGORY_ORDER.filter((cat) => byCategory[cat]?.length > 0).map((cat) => {
    const entries = byCategory[cat].map((e) => `- (${e.ticketId}): ${e.content}`).join('\n');
    return `### ${CATEGORY_HEADINGS[cat]}\n\n${entries}`;
  });
  const newSection = `## [${args.version}] - ${args.date}\n\n${sections.join('\n\n')}\n`;

  if (!existsSync(args.changelog)) {
    die(`${args.changelog} doesn't exist — run the scaffolder first so a starter CHANGELOG.md is in place.`);
  }
  const existingText = readFileSync(args.changelog, 'utf8');
  // Newest release goes on top: insert right before the first existing
  // dated section, or at the end of the file if this is the first release.
  const firstSectionMatch = existingText.match(/^## \[/m);
  const insertAt = firstSectionMatch ? firstSectionMatch.index : existingText.length;
  const before = existingText.slice(0, insertAt).replace(/\n*$/, '\n\n');
  const after = existingText.slice(insertAt);
  writeFileSync(args.changelog, before + newSection + (after ? '\n' + after : ''));

  for (const file of fragmentFiles) {
    unlinkSync(path.join(args.fragmentsDir, file));
  }

  console.log(`cut-changelog-release: consolidated ${fragmentFiles.length} fragment(s) into ${args.changelog} under [${args.version}] - ${args.date}.`);
}

main();
