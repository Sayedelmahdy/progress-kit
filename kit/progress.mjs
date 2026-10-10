#!/usr/bin/env node
// Agent-agnostic project progress tracker. Zero dependencies, Node >= 20.
// Source of truth: docs/status/progress.json (shape: docs/status/progress.schema.json).
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const LOG_LIMIT = 30;
const DEFAULT_ACTIVE_PROGRESS = 0.5; // matches docs/status/index.html
const WP_ID = /\b([BFPT]\d+(\.\d+)?[a-z]?)\b/g;

/** Repo copy -> kit copy. `validate` fails when they drift apart. */
export const KIT_PAIRS = [
  ['scripts/progress.mjs', 'tools/progress-kit/progress.mjs'],
  ['scripts/install-hooks.mjs', 'tools/progress-kit/install-hooks.mjs'],
  ['.githooks/post-commit', 'tools/progress-kit/post-commit'],
  ['docs/status/progress.schema.json', 'tools/progress-kit/progress.schema.json'],
  ['docs/status/index.html', 'tools/progress-kit/index.html'],
];

export class CliError extends Error {}

const stripBom = (s) => (s.charCodeAt(0) === 0xfeff ? s.slice(1) : s);

// ---------------------------------------------------------------- time

const pad = (n) => String(n).padStart(2, '0');

export function localIso(d = new Date()) {
  const off = -d.getTimezoneOffset();
  const a = Math.abs(off);
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` +
    `${off >= 0 ? '+' : '-'}${pad(Math.floor(a / 60))}:${pad(a % 60)}`
  );
}
const logStamp = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
const clock = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const dateOnly = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

// ---------------------------------------------------------------- math

export function computeProgress(data) {
  const items = data.phases.flatMap((p) => p.items);
  return { ...scoreItems(items), counts: countItems(items) };
}

export function scoreItems(items) {
  let total = 0;
  let done = 0;
  let active = 0;
  for (const it of items) {
    total += it.w;
    if (it.status === 'done') done += it.w;
    else if (it.status === 'active') active += it.w * (it.progress ?? DEFAULT_ACTIVE_PROGRESS);
  }
  return { total, done, active, fraction: total > 0 ? (done + active) / total : 0 };
}

function countItems(items) {
  const c = { done: 0, active: 0, todo: 0, all: items.length };
  for (const it of items) c[it.status] += 1;
  return c;
}

export function currentPhase(data) {
  return (
    data.phases.find((p) => p.items.some((i) => i.status === 'active')) ??
    data.phases.find((p) => p.items.some((i) => i.status === 'todo')) ??
    null
  );
}

const pct1 = (f) => Math.round(f * 1000) / 10;

export function summarize(data) {
  const all = computeProgress(data);
  const phase = currentPhase(data);
  const ps = phase ? scoreItems(phase.items) : null;
  return {
    updated: data.updated,
    overall: pct1(all.fraction),
    counts: all.counts,
    currentPhase: phase
      ? { id: phase.id, name: phase.name, percent: pct1(ps.fraction), counts: countItems(phase.items) }
      : null,
    now: data.now,
    next: data.next,
    log: data.log.slice(0, 5),
  };
}

function bar(fraction, width = 30) {
  const n = Math.max(0, Math.min(width, Math.round(fraction * width)));
  return `[${'#'.repeat(n)}${'.'.repeat(width - n)}]`;
}

export function renderShow(data) {
  const s = summarize(data);
  const lines = [];
  lines.push(`Overall: ${s.overall}%  ${bar(s.overall / 100)}`);
  lines.push(`Items:   ${s.counts.done} done, ${s.counts.active} active, ${s.counts.todo} todo (of ${s.counts.all})`);
  lines.push(`Updated: ${s.updated}`);
  if (s.currentPhase) {
    const c = s.currentPhase.counts;
    lines.push(`You are here: ${s.currentPhase.name} - ${s.currentPhase.percent}% (${c.done}/${c.all} done)`);
  } else {
    lines.push('You are here: all phases complete');
  }
  lines.push('', 'Now:');
  if (!s.now.length) lines.push('  (nothing active)');
  for (const n of s.now) lines.push(`  - ${n.title} [${n.who}, since ${n.since}]`);
  lines.push('', 'Next:');
  if (!s.next.length) lines.push('  (empty)');
  s.next.forEach((x, i) => lines.push(`  ${i + 1}. ${x}`));
  lines.push('', 'Recent log:');
  if (!s.log.length) lines.push('  (empty)');
  for (const l of s.log) lines.push(`  ${l.at}  ${l.text}`);
  return lines.join('\n');
}

// ---------------------------------------------------------------- validation

function resolveRef(root, ref) {
  if (!ref.startsWith('#/')) throw new Error(`Unsupported $ref ${ref}`);
  return ref
    .slice(2)
    .split('/')
    .reduce((node, key) => node?.[key.replace(/~1/g, '/').replace(/~0/g, '~')], root);
}

const typeOf = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v);

/** Tiny JSON Schema interpreter: only the keywords progress.schema.json uses. */
export function validateSchema(schema, value, root = schema, at = '$', errors = []) {
  if (schema.$ref) return validateSchema(resolveRef(root, schema.$ref), value, root, at, errors);
  const t = typeOf(value);
  if (schema.type) {
    const ok = schema.type === 'number' ? t === 'number' && Number.isFinite(value) : t === schema.type;
    if (!ok) {
      errors.push(`${at}: expected ${schema.type}, got ${t}`);
      return errors;
    }
  }
  if (schema.enum && !schema.enum.includes(value)) errors.push(`${at}: must be one of ${schema.enum.join(', ')}`);
  if (t === 'string') {
    if (schema.minLength != null && value.length < schema.minLength) errors.push(`${at}: must not be empty`);
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) errors.push(`${at}: "${value}" does not match ${schema.pattern}`);
  }
  if (t === 'number') {
    if (schema.minimum != null && value < schema.minimum) errors.push(`${at}: must be >= ${schema.minimum}`);
    if (schema.maximum != null && value > schema.maximum) errors.push(`${at}: must be <= ${schema.maximum}`);
    if (schema.exclusiveMinimum != null && value <= schema.exclusiveMinimum) errors.push(`${at}: must be > ${schema.exclusiveMinimum}`);
  }
  if (t === 'array' && schema.items) value.forEach((v, i) => validateSchema(schema.items, v, root, `${at}[${i}]`, errors));
  if (t === 'object') {
    for (const key of schema.required ?? []) if (!(key in value)) errors.push(`${at}: missing required "${key}"`);
    const props = schema.properties ?? {};
    for (const [key, v] of Object.entries(value)) {
      if (props[key]) validateSchema(props[key], v, root, `${at}.${key}`, errors);
      else if (schema.additionalProperties === false) errors.push(`${at}: unknown property "${key}"`);
    }
  }
  return errors;
}

/** Checks the schema cannot express. */
export function semanticErrors(data) {
  const errors = [];
  if (!Array.isArray(data?.phases)) return errors;
  const ids = new Map();
  const phaseIds = new Set();
  data.phases.forEach((p, pi) => {
    if (phaseIds.has(p?.id)) errors.push(`phases[${pi}]: duplicate phase id "${p.id}"`);
    phaseIds.add(p?.id);
    (Array.isArray(p?.items) ? p.items : []).forEach((it, ii) => {
      const at = `phases[${pi}].items[${ii}]`;
      if (it?.id != null) {
        const key = String(it.id).toLowerCase();
        if (ids.has(key)) errors.push(`${at}: duplicate id "${it.id}" (also ${ids.get(key)})`);
        else ids.set(key, at);
      }
      if (typeof it?.w === 'number' && !(it.w > 0)) errors.push(`${at}: weight must be > 0`);
      if (it?.progress != null && it.status !== 'active') errors.push(`${at}: progress is only allowed on active items`);
    });
  });
  return errors;
}

export function validateData(schema, data) {
  const errors = validateSchema(schema, data);
  return errors.length ? errors : semanticErrors(data);
}

function schemaPathFor(file) {
  const candidates = [
    path.join(path.dirname(file), 'progress.schema.json'),
    path.resolve(SCRIPT_DIR, '..', 'docs', 'status', 'progress.schema.json'),
  ];
  const found = candidates.find((c) => fs.existsSync(c));
  if (!found) throw new CliError(`progress.schema.json not found (looked in ${candidates.join(', ')})`);
  return found;
}

function loadSchema(file) {
  return JSON.parse(stripBom(fs.readFileSync(schemaPathFor(file), 'utf8')));
}

const norm = (buf) => stripBom(buf.toString('utf8')).replace(/\r\n/g, '\n');

export function kitMismatches(root) {
  if (!fs.existsSync(path.join(root, 'tools', 'progress-kit'))) return [];
  const out = [];
  for (const [a, b] of KIT_PAIRS) {
    const pa = path.join(root, a);
    const pb = path.join(root, b);
    if (!fs.existsSync(pa) || !fs.existsSync(pb)) out.push(`${a} / ${b}: file missing`);
    else if (norm(fs.readFileSync(pa)) !== norm(fs.readFileSync(pb))) out.push(`${a} differs from ${b}`);
  }
  return out;
}

// ---------------------------------------------------------------- file io

export function loadFile(file) {
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch {
    throw new CliError(`Cannot read ${file}`);
  }
  raw = stripBom(raw);
  try {
    return { data: JSON.parse(raw), eol: raw.includes('\r\n') ? '\r\n' : '\n' };
  } catch (e) {
    throw new CliError(`${file} is not valid JSON: ${e.message}`);
  }
}

/** Stamps `updated`, trims the log, refuses invalid results, writes atomically (UTF-8, no BOM). */
export function saveFile(file, data, eol = '\n', now = new Date()) {
  data.updated = localIso(now);
  data.log = data.log.slice(0, LOG_LIMIT);
  const errors = validateData(loadSchema(file), data);
  if (errors.length) throw new CliError(`Refusing to write an invalid file:\n  ${errors.join('\n  ')}`);
  const text = JSON.stringify(data, null, 2).replace(/\n/g, eol) + eol;
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(tmp, text, 'utf8');
    fs.renameSync(tmp, file);
  } catch (e) {
    fs.rmSync(tmp, { force: true });
    throw e;
  }
}

function gitRoot(cwd) {
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

export function repoRoot(cwd = process.cwd()) {
  return gitRoot(cwd) ?? path.resolve(SCRIPT_DIR, '..');
}

export function resolveFile(opts, env = process.env, cwd = process.cwd()) {
  if (opts.file) return path.resolve(cwd, opts.file);
  if (env.PROGRESS_FILE) return path.resolve(cwd, env.PROGRESS_FILE);
  const root = repoRoot(cwd);
  const pointer = path.join(root, '.claude', 'progress-path.txt');
  if (fs.existsSync(pointer)) {
    const p = stripBom(fs.readFileSync(pointer, 'utf8')).split(/\r?\n/)[0].trim();
    if (p) return path.resolve(root, p);
  }
  return path.join(root, 'docs', 'status', 'progress.json');
}

// ---------------------------------------------------------------- mutations

const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();

export function findItem(data, id) {
  for (const phase of data.phases) {
    const index = phase.items.findIndex((i) => i.id != null && same(i.id, id));
    if (index >= 0) return { phase, index, item: phase.items[index] };
  }
  throw new CliError(`No item with id "${id}"`);
}

const matchesNow = (n, item) =>
  n.title === item.name || (item.id != null && (same(n.title, item.id) || n.title.toLowerCase().startsWith(`${String(item.id).toLowerCase()} `)));

const addLog = (data, text, now) => data.log.unshift({ at: logStamp(now), text });

export function startItem(data, id, who, now = new Date()) {
  const { item } = findItem(data, id);
  if (item.status === 'done') throw new CliError(`${item.id} is already done`);
  item.status = 'active';
  const entry = data.now.find((n) => matchesNow(n, item));
  if (entry) entry.who = who;
  else data.now.push({ title: item.name, who, since: clock(now) });
  data.next = data.next.filter((x) => !(x.toLowerCase().startsWith(`${String(item.id).toLowerCase()} `) || same(x, item.id)));
  addLog(data, `${item.id} started (${who})`, now);
}

export function setProgress(data, id, value) {
  const { item } = findItem(data, id);
  if (item.status !== 'active') throw new CliError(`${item.id} is ${item.status}; start it first`);
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new CliError('Progress must be a number between 0 and 1');
  item.progress = value;
}

export function doneItem(data, id, commit, now = new Date()) {
  const { item } = findItem(data, id);
  if (item.status === 'done') return false;
  item.status = 'done';
  delete item.progress;
  item.doneAt = dateOnly(now);
  if (commit) item.commit = commit;
  data.now = data.now.filter((n) => !matchesNow(n, item));
  addLog(data, commit ? `${item.id} landed ${commit}` : `${item.id} done`, now);
  return true;
}

export function addItem(data, phaseId, id, name, { w = 1, after } = {}) {
  const phase = data.phases.find((p) => same(p.id, phaseId));
  if (!phase) throw new CliError(`No phase "${phaseId}" (have: ${data.phases.map((p) => p.id).join(', ')})`);
  if (data.phases.some((p) => p.items.some((i) => i.id != null && same(i.id, id)))) throw new CliError(`Id "${id}" already exists`);
  const item = { id, name, w, status: 'todo' };
  if (after) {
    const at = phase.items.findIndex((i) => i.id != null && same(i.id, after));
    if (at < 0) throw new CliError(`"${after}" is not an item of phase ${phase.id}`);
    phase.items.splice(at + 1, 0, item);
  } else {
    phase.items.push(item);
  }
}

// ---------------------------------------------------------------- hook-commit

/** Extracts the sha and the work package ids a commit message marks as done. */
export function parseCommit(text) {
  const [sha = '', ...rest] = text.replace(/\r\n/g, '\n').split('\n');
  const message = rest.join('\n');
  const ids = [];
  const push = (token) => {
    const t = token.trim();
    if (/^[A-Za-z][A-Za-z0-9._-]*$/.test(t) && !ids.some((x) => same(x, t))) ids.push(t);
  };
  const subject = message.split('\n')[0] ?? '';
  const paren = subject.match(/\(([^()]*)\)\s*$/);
  if (paren) paren[1].split(/[\s,;&+/]+/).filter(Boolean).forEach(push);
  for (const m of message.matchAll(/^Progress:[ \t]*(.*)$/gim)) {
    m[1]
      .replace(/^\s*done\b[:\s]*/i, '')
      .split(/[\s,;&+/]+/)
      .filter(Boolean)
      .forEach(push);
  }
  return { sha: sha.trim(), ids };
}

function hookCommit(file, say) {
  let out;
  try {
    out = execFileSync('git', ['log', '-1', '--format=%h%n%B'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    say('progress: no commit to read, nothing to do');
    return;
  }
  const { sha, ids } = parseCommit(out);
  if (!ids.length) return;
  if (!fs.existsSync(file)) {
    say(`progress: ${file} not found, skipped`);
    return;
  }
  const { data, eol } = loadFile(file);
  const marked = [];
  for (const id of ids) {
    try {
      if (doneItem(data, id, sha)) marked.push(id);
    } catch {
      // not a work package id; ignore silently
    }
  }
  if (!marked.length) return;
  saveFile(file, data, eol);
  say(`progress: marked ${marked.join(', ')} done at ${sha} (docs/status/progress.json is modified; include it in your next commit)`);
}

// ---------------------------------------------------------------- cli

const VALUE_FLAGS = new Set(['file', 'who', 'commit', 'w', 'after']);
const BOOL_FLAGS = new Set(['json', 'help']);

export function parseArgs(argv) {
  const opts = {};
  const pos = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) {
      pos.push(a);
      continue;
    }
    const [name, inline] = a.slice(2).split(/=(.*)/s);
    if (BOOL_FLAGS.has(name)) opts[name] = true;
    else if (VALUE_FLAGS.has(name)) {
      const v = inline ?? argv[++i];
      if (v == null) throw new CliError(`--${name} needs a value`);
      opts[name] = v;
    } else throw new CliError(`Unknown option --${name}`);
  }
  return { opts, pos };
}

const USAGE = `Usage: node scripts/progress.mjs [command] [options]
  show                                 overall %, current phase, now, next, recent log (default)
  start <id> [--who <agent>]           mark an item active
  progress <id> <0..1>                 set the fraction of an active item
  done <id> [--commit <sha>]           mark an item done
  add <phaseId> <id> "<name>" [--w N] [--after <id>]
  next "<a>" "<b>" ...                 replace the next list
  log "<text>"                         add a log line
  validate                             check schema, ids, weights, kit copies
  hook-commit                          mark ids named in the last commit as done
Options: --file <path>  --json (show)  PROGRESS_FILE env, .claude/progress-path.txt`;

export function run(argv, { env = process.env, cwd = process.cwd(), out = (s) => console.log(s) } = {}) {
  const { opts, pos } = parseArgs(argv);
  if (opts.help) return out(USAGE);
  const cmd = pos.shift() ?? 'show';
  const file = resolveFile(opts, env, cwd);
  const need = (n, what) => {
    if (pos.length < n) throw new CliError(`${cmd}: missing ${what}\n${USAGE}`);
  };
  const edit = (fn) => {
    const { data, eol } = loadFile(file);
    fn(data);
    saveFile(file, data, eol);
  };

  switch (cmd) {
    case 'show': {
      const { data } = loadFile(file);
      return out(opts.json ? JSON.stringify(summarize(data), null, 2) : renderShow(data));
    }
    case 'start': {
      need(1, '<id>');
      const who = opts.who ?? env.PROGRESS_WHO ?? 'agent';
      return edit((d) => startItem(d, pos[0], who)), out(`${pos[0]} is active`);
    }
    case 'progress': {
      need(2, '<id> <0..1>');
      return edit((d) => setProgress(d, pos[0], Number(pos[1]))), out(`${pos[0]} progress = ${pos[1]}`);
    }
    case 'done': {
      need(1, '<id>');
      return edit((d) => doneItem(d, pos[0], opts.commit)), out(`${pos[0]} is done`);
    }
    case 'add': {
      need(3, '<phaseId> <id> "<name>"');
      const w = opts.w == null ? 1 : Number(opts.w);
      if (!(w > 0)) throw new CliError('--w must be a number > 0');
      return edit((d) => addItem(d, pos[0], pos[1], pos[2], { w, after: opts.after })), out(`${pos[1]} added to ${pos[0]}`);
    }
    case 'next': {
      need(1, '"<item>" ...');
      return edit((d) => (d.next = [...pos])), out(`next = ${pos.length} item(s)`);
    }
    case 'log': {
      need(1, '"<text>"');
      return edit((d) => addLog(d, pos.join(' '), new Date())), out('logged');
    }
    case 'validate': {
      const { data } = loadFile(file);
      const errors = [...validateData(loadSchema(file), data), ...kitMismatches(repoRoot(cwd))];
      if (errors.length) throw new CliError(`${file} is invalid:\n  ${errors.join('\n  ')}`);
      return out(`OK: ${file}`);
    }
    case 'hook-commit':
      try {
        hookCommit(file, out);
      } catch (e) {
        out(`progress: hook skipped (${e.message})`);
      }
      return;
    default:
      throw new CliError(`Unknown command "${cmd}"\n${USAGE}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    run(process.argv.slice(2));
  } catch (e) {
    console.error(e instanceof CliError ? e.message : e);
    // hook-commit must never fail a commit
    process.exitCode = process.argv[2] === 'hook-commit' ? 0 : 1;
  }
}
