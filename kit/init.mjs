#!/usr/bin/env node
// Installs the progress kit into a repo. Self-contained: only reads files next to this script.
// Usage: node init.mjs [--dir <repo>] [--force]
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const KIT_DIR = path.dirname(fileURLToPath(import.meta.url));

/** [file in the kit, destination in the target repo] */
export const FILES = [
  ['progress.schema.json', 'docs/status/progress.schema.json'],
  ['index.html', 'docs/status/index.html'],
  ['progress.mjs', 'scripts/progress.mjs'],
  ['install-hooks.mjs', 'scripts/install-hooks.mjs'],
  ['post-commit', '.githooks/post-commit'],
];

export const SECTION = `## Progress tracking

Project progress lives in \`docs/status/progress.json\` (schema: \`docs/status/progress.schema.json\`).
Humans and every agent share it, so use the CLI and never hand-edit the JSON.

- Before starting a work package: \`node scripts/progress.mjs start <id> --who <agent>\`.
- After it lands, end the commit subject with \`(<id>)\`, for example \`feat(api): guest identity (B27)\`;
  the post-commit hook marks it done. Or run \`node scripts/progress.mjs done <id> --commit <sha>\`.
- New work package: \`node scripts/progress.mjs add <phaseId> <id> "<name>" --w <weight>\`.
- Run \`node scripts/progress.mjs validate\` before committing changes to the JSON.
- See where the project stands with \`node scripts/progress.mjs\`.
- Once per clone: \`node scripts/install-hooks.mjs\` (the hook only edits the file; the change rides along in your next commit).
`;

const SECTION_MARK = '## Progress tracking';

function skeleton(now = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  const off = -now.getTimezoneOffset();
  const a = Math.abs(off);
  const updated =
    `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}T${p(now.getHours())}:${p(now.getMinutes())}:${p(now.getSeconds())}` +
    `${off >= 0 ? '+' : '-'}${p(Math.floor(a / 60))}:${p(a % 60)}`;
  return (
    JSON.stringify(
      {
        updated,
        now: [],
        next: [],
        log: [],
        phases: [{ id: 'p1', name: 'Phase 1', items: [{ id: 'P1.1', name: 'First task', w: 1, status: 'todo' }] }],
      },
      null,
      2,
    ) + '\n'
  );
}

export function init({ dir = process.cwd(), force = false, log = console.log } = {}) {
  const target = path.resolve(dir);
  if (!fs.existsSync(target)) throw new Error(`Directory not found: ${target}`);
  const done = (verb, rel) => log(`${verb.padEnd(8)} ${rel}`);
  const result = { created: [], skipped: [], overwritten: [] };

  for (const [src, rel] of FILES) {
    const dest = path.join(target, rel);
    const exists = fs.existsSync(dest);
    if (exists && !force) {
      result.skipped.push(rel);
      done('skipped', `${rel} (exists, use --force)`);
      continue;
    }
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(path.join(KIT_DIR, src), dest);
    if (rel === '.githooks/post-commit') fs.chmodSync(dest, 0o755);
    (exists ? result.overwritten : result.created).push(rel);
    done(exists ? 'replaced' : 'created', rel);
  }

  // Never overwritten, not even with --force: it holds the project's data.
  const data = path.join(target, 'docs/status/progress.json');
  if (fs.existsSync(data)) {
    result.skipped.push('docs/status/progress.json');
    done('kept', 'docs/status/progress.json (never overwritten)');
  } else {
    fs.writeFileSync(data, skeleton(), 'utf8');
    result.created.push('docs/status/progress.json');
    done('created', 'docs/status/progress.json');
  }

  for (const name of ['AGENTS.md', 'CLAUDE.md']) {
    const file = path.join(target, name);
    const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
    if (text.includes(SECTION_MARK)) {
      done('kept', `${name} (section present)`);
      continue;
    }
    const eol = text.includes('\r\n') ? '\r\n' : '\n';
    const body = SECTION.replace(/\n/g, eol);
    const sep = text === '' ? '' : text.endsWith('\n') ? eol : eol + eol;
    fs.writeFileSync(file, text + sep + body, 'utf8');
    done(text === '' ? 'created' : 'appended', name);
  }

  // Keep the hook LF on Windows checkouts.
  const attrs = path.join(target, '.gitattributes');
  const attrText = fs.existsSync(attrs) ? fs.readFileSync(attrs, 'utf8') : '';
  if (!attrText.includes('.githooks/*')) {
    fs.writeFileSync(attrs, attrText + (attrText && !attrText.endsWith('\n') ? '\n' : '') + '.githooks/* text eol=lf\n', 'utf8');
    done(attrText ? 'appended' : 'created', '.gitattributes');
  }

  try {
    const out = execFileSync(process.execPath, [path.join(target, 'scripts/install-hooks.mjs')], {
      cwd: target,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    log(out.trim());
  } catch (e) {
    log(`hooks   not installed: ${String(e.stderr || e.message).trim()}`);
  }
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  const i = args.indexOf('--dir');
  try {
    init({ dir: i >= 0 ? args[i + 1] : process.cwd(), force: args.includes('--force') });
    console.log('\nDone. Try: node scripts/progress.mjs');
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
  }
}
