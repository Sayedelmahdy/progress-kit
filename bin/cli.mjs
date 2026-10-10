#!/usr/bin/env node
// progress-kit: npx github:Sayedelmahdy/progress-kit <command>
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const [cmd = 'help', ...rest] = process.argv.slice(2);

function run(script, args) {
  const r = spawnSync(process.execPath, [script, ...args], { stdio: 'inherit' });
  process.exit(r.status ?? 1);
}

function installClaude() {
  const claude = join(homedir(), '.claude');
  mkdirSync(join(claude, 'skills'), { recursive: true });
  mkdirSync(join(claude, 'agents'), { recursive: true });
  cpSync(join(root, 'claude', 'project-progress'), join(claude, 'skills', 'project-progress'), {
    recursive: true,
    force: true,
  });
  cpSync(join(root, 'claude', 'agents', 'progress-updater.md'), join(claude, 'agents', 'progress-updater.md'), {
    force: true,
  });
  console.log(`Installed Claude Code extras in ${claude}. Restart Claude Code to load them.`);
}

switch (cmd) {
  case 'init':
    run(join(root, 'kit', 'init.mjs'), rest.includes('--dir') ? rest : ['--dir', process.cwd(), ...rest]);
    break;
  case 'install-claude':
    installClaude();
    break;
  case 'help':
  case '--help':
  case '-h':
    console.log(`progress-kit

  npx github:Sayedelmahdy/progress-kit init [--dir <repo>] [--force]
      Add progress tracking to a repo (default: current directory).
  npx github:Sayedelmahdy/progress-kit install-claude
      Optional: Claude Code status bar mod + Haiku updater agent in ~/.claude.

After init, inside the repo:
  node scripts/progress.mjs              show where the project stands
  node scripts/progress.mjs start B12 --who codex
  git commit -m "feat: thing (B12)"      the hook marks B12 done`);
    break;
  default: {
    // Any other command is forwarded to the repo's own CLI (show, start, done, validate, ...).
    const local = resolve('scripts', 'progress.mjs');
    if (!existsSync(local)) {
      console.error('No scripts/progress.mjs here. Run "init" first.');
      process.exit(1);
    }
    run(local, [cmd, ...rest]);
  }
}
