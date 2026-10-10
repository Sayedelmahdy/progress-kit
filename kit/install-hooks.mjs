#!/usr/bin/env node
// Points git at .githooks (idempotent). Usage: node scripts/install-hooks.mjs [--force]
import { execFileSync } from 'node:child_process';

const force = process.argv.includes('--force');
const git = (...args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();

try {
  git('rev-parse', '--show-toplevel');
} catch {
  console.error('Not inside a git repository; nothing installed.');
  process.exit(1);
}

let current = '';
try {
  current = git('config', '--get', 'core.hooksPath');
} catch {
  // unset
}

if (current === '.githooks') {
  console.log('Hooks already installed (core.hooksPath = .githooks).');
} else if (current && !force) {
  console.error(`core.hooksPath is already "${current}". Re-run with --force to replace it.`);
  process.exit(1);
} else {
  git('config', 'core.hooksPath', '.githooks');
  console.log('Installed: core.hooksPath = .githooks');
}
