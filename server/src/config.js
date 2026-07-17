import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const CONFIG_PATH = path.join(ROOT, 'config.json');
const PATH_ACCESS_TIMEOUT_MS = 8_000;

function withTimeout(promise, ms, message) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function slug(s) {
  return s ? String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') : '';
}

function normalizeRepo(r, i) {
  const resolved = path.resolve(r.path);
  const name = r.name || path.basename(resolved);
  return {
    id: r.id || slug(name) || String(i),
    name,
    path: resolved,
  };
}

// Ensure every id is unique; if duplicates exist, append a numeric suffix.
function dedupeIds(repos) {
  const seen = new Map();
  return repos.map(r => {
    const base = r.id;
    let id = base;
    let n = 2;
    while (seen.has(id)) id = `${base}-${n++}`;
    seen.set(id, true);
    return { ...r, id };
  });
}

function readRaw() {
  if (!fs.existsSync(CONFIG_PATH)) {
    const seed = { port: 5174, repos: [] };
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(seed, null, 2) + '\n');
    return seed;
  }
  return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
}

function writeRaw(raw) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(raw, null, 2) + '\n');
}

// Live config — re-read from disk on demand so external edits also take effect.
export function loadConfig() {
  const raw = readRaw();
  const repos = dedupeIds((raw.repos || []).map(normalizeRepo));
  return {
    port: raw.port || 5174,
    repos,
    _raw: raw,
  };
}

export async function validateRepoPath(p) {
  if (!p) return { ok: false, error: '路径不能为空' };
  let abs;
  try {
    abs = path.resolve(p);
  } catch (e) {
    return { ok: false, error: `路径无效: ${e.message}` };
  }
  try {
    const stat = await withTimeout(
      fsp.stat(abs),
      PATH_ACCESS_TIMEOUT_MS,
      `路径访问超时（${PATH_ACCESS_TIMEOUT_MS}ms）: ${abs}`,
    );
    if (!stat.isDirectory()) return { ok: false, error: `不是目录: ${abs}` };
  } catch (e) {
    if (e && /超时/.test(e.message)) return { ok: false, error: e.message };
    return { ok: false, error: `路径不存在或不可达: ${abs}` };
  }
  // Either .git dir (worktree) or the path IS a bare repo. Root already
  // responded, so use a short budget for metadata checks.
  const metaMs = Math.min(PATH_ACCESS_TIMEOUT_MS, 3_000);
  try {
    await withTimeout(fsp.access(path.join(abs, '.git')), metaMs, 'git meta timeout');
    return { ok: true, path: abs };
  } catch (e) {
    if (e && /超时/.test(e.message)) {
      return { ok: false, error: `检查 .git 超时: ${abs}` };
    }
  }
  try {
    await withTimeout(fsp.access(path.join(abs, 'HEAD')), metaMs, 'git meta timeout');
    return { ok: true, path: abs };
  } catch (e) {
    if (e && /超时/.test(e.message)) {
      return { ok: false, error: `检查 git HEAD 超时: ${abs}` };
    }
    return { ok: false, error: `不是 git 仓库（缺少 .git）: ${abs}` };
  }
}

function toPosix(p) {
  return p.replace(/\\/g, '/');
}

export async function addRepo({ name, path: p }) {
  const check = await validateRepoPath(p);
  if (!check.ok) throw new Error(check.error);
  const raw = readRaw();
  raw.repos = raw.repos || [];
  const entry = { name: name || path.basename(check.path), path: toPosix(check.path) };
  raw.repos.push(entry);
  writeRaw(raw);
  return loadConfig();
}

export async function updateRepo(id, { name, path: p }) {
  const cfg = loadConfig();
  const idx = cfg.repos.findIndex(r => r.id === id);
  if (idx === -1) throw new Error(`未知仓库: ${id}`);
  const raw = readRaw();
  const target = raw.repos[idx];
  if (p && p !== target.path) {
    const check = await validateRepoPath(p);
    if (!check.ok) throw new Error(check.error);
    target.path = toPosix(check.path);
  }
  if (name) target.name = name;
  writeRaw(raw);
  return loadConfig();
}

export function deleteRepo(id) {
  const cfg = loadConfig();
  const idx = cfg.repos.findIndex(r => r.id === id);
  if (idx === -1) throw new Error(`未知仓库: ${id}`);
  const raw = readRaw();
  raw.repos.splice(idx, 1);
  writeRaw(raw);
  return loadConfig();
}

export function reorderRepos(ids) {
  const raw = readRaw();
  const cfg = loadConfig();
  const byId = new Map(cfg.repos.map((r, i) => [r.id, raw.repos[i]]));
  const seen = new Set();
  const next = [];
  for (const id of ids) {
    const r = byId.get(id);
    if (r && !seen.has(id)) { next.push(r); seen.add(id); }
  }
  // Append any that were missed (shouldn't happen normally)
  cfg.repos.forEach((r, i) => { if (!seen.has(r.id)) next.push(raw.repos[i]); });
  raw.repos = next;
  writeRaw(raw);
  return loadConfig();
}
