#!/usr/bin/env node
// Real minimatch-semantics glob matching for hooks/verify-loop.sh.
//
// POSIX shell `case` patterns are NOT minimatch-compatible: they have no
// brace-alternation syntax at all (`{ts,tsx}` never matches anything —
// braces are just literal characters to `case`), and `**` in a `case`
// pattern is no different from a single `*` (it happens to still match
// across `/` since `case` doesn't do pathname-restricted matching, but it
// doesn't implement minimatch's "zero or more path segments" semantics
// either — the two just coincide for some inputs and silently diverge for
// others, e.g. a file directly under the globstar's anchor directory).
// This caused a real, total Phase-1 outage in a consuming repo whose
// include_glob used brace alternation. See docs/CONFORMANCE.md.
//
// Usage:
//   node glob-match.mjs --path <REL_PATH> --basename <FILE_BASENAME> \
//     --include <INCLUDE_GLOB> [--skip <SKIP_GLOB>]... \
//     --test-pattern <TEST_FILE_PATTERN>
//
// Prints POSIX-shell-safe `VAR=value` lines (no quoting needed — every
// value here is the literal string "true" or "false"), for the caller to
// `eval`:
//   INCLUDE_MATCH=true|false   — does --path match --include
//   SKIP_MATCH=true|false      — does --path match any --skip
//   TEST_SELF_MATCH=true|false — does --basename match --test-pattern
//
// One process handles all three questions so verify-loop.sh spawns node
// once per edited file for glob decisions, not three times.
//
// dot:true is passed explicitly to every minimatch() call: minimatch
// defaults to dot:false (a `*`/`**` won't match a path segment starting
// with `.`), but POSIX `case` — the engine this replaces — has no such
// exclusion. Without this, switching engines would silently narrow
// matching for any dotfile-prefixed path, which is a behavior change no
// one asked for, not just an engine swap.

import { minimatch } from 'minimatch';

function parseArgs(argv) {
  const args = { path: null, basename: null, include: null, skip: [], testPattern: null };
  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case '--path': args.path = argv[++i]; break;
      case '--basename': args.basename = argv[++i]; break;
      case '--include': args.include = argv[++i]; break;
      case '--skip': args.skip.push(argv[++i]); break;
      case '--test-pattern': args.testPattern = argv[++i]; break;
      default:
        console.error(`glob-match: unrecognized argument "${argv[i]}"`);
        process.exit(1);
    }
  }
  if (args.path === null || args.include === null || args.testPattern === null) {
    console.error('glob-match: --path, --include, and --test-pattern are required.');
    process.exit(1);
  }
  return args;
}

const MM_OPTS = { dot: true };

function main() {
  const args = parseArgs(process.argv.slice(2));

  const includeMatch = minimatch(args.path, args.include, MM_OPTS);
  const skipMatch = args.skip.some((pattern) => minimatch(args.path, pattern, MM_OPTS));
  const testSelfMatch = args.basename !== null ? minimatch(args.basename, args.testPattern, MM_OPTS) : false;

  process.stdout.write(
    [`INCLUDE_MATCH=${includeMatch}`, `SKIP_MATCH=${skipMatch}`, `TEST_SELF_MATCH=${testSelfMatch}`].join('\n') + '\n'
  );
}

main();
