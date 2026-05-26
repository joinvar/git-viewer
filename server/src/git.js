import simpleGit from 'simple-git';
import fs from 'node:fs';
import path from 'node:path';

const gitCache = new Map();

function getGit(repoPath) {
  if (!gitCache.has(repoPath)) {
    if (!fs.existsSync(path.join(repoPath, '.git'))) {
      throw new Error(`Not a git repo: ${repoPath}`);
    }
    gitCache.set(repoPath, simpleGit(repoPath));
  }
  return gitCache.get(repoPath);
}

// Map porcelain code to semantic label
// See: git status --short codes
function mapStatusCode(index, workdir) {
  if (index === '?' && workdir === '?') return 'U'; // untracked
  if (index === '!' && workdir === '!') return 'I'; // ignored
  const code = index !== ' ' ? index : workdir;
  switch (code) {
    case 'A': return 'A';
    case 'M': return 'M';
    case 'D': return 'D';
    case 'R': return 'R';
    case 'C': return 'C';
    case 'U': return 'C'; // conflict
    default:  return code || '?';
  }
}

export async function getStatus(repoPath) {
  const git = getGit(repoPath);
  const s = await git.status();
  const files = s.files.map(f => {
    const status = mapStatusCode(f.index, f.working_dir);
    // Working-tree size from disk. Deleted files have no on-disk size.
    let size = null;
    if (status !== 'D') {
      try { size = fs.statSync(path.join(repoPath, f.path)).size; } catch {}
    }
    return {
      path: f.path,
      status,
      index: f.index,
      workdir: f.working_dir,
      staged: f.index !== ' ' && f.index !== '?',
      size,
    };
  });
  return {
    branch: s.current,
    tracking: s.tracking,
    ahead: s.ahead,
    behind: s.behind,
    files,
  };
}

export async function getBranches(repoPath) {
  const git = getGit(repoPath);
  const [local, remote] = await Promise.all([
    git.branchLocal(),
    git.branch(['-r']),
  ]);
  const locals = Object.values(local.branches).map(b => ({
    name: b.name,
    current: b.current,
    commit: b.commit,
    label: b.label,
    kind: 'local',
  }));
  const remotes = Object.values(remote.branches)
    .filter(b => !b.name.includes('HEAD ->'))
    .map(b => ({
      name: b.name,
      current: false,
      commit: b.commit,
      label: b.label,
      kind: 'remote',
    }));
  return { local: locals, remote: remotes, current: local.current };
}

// Fetch log with parents so the frontend can draw a graph.
// Stash entries are fetched separately via `git stash list` (instead of relying
// on `--all`), because `--all` pulls in stash's synthetic index/untracked
// parent commits which are noise. It also only yields the top `refs/stash`,
// missing older reflog entries (stash@{1}, stash@{2}, ...).
export async function getLog(repoPath, { limit = 500, includeRemote = true } = {}) {
  const git = getGit(repoPath);
  const logArgs = [
    'log',
    `--pretty=format:%H%x01%P%x01%an%x01%ae%x01%aI%x01%s`,
    `-n${limit}`,
    '--topo-order',
    '--branches',
    '--tags',
  ];
  if (includeRemote) logArgs.push('--remotes');

  const raw = await git.raw(logArgs);
  const logCommits = raw.split('\n').filter(Boolean).map(parseCommitLine);

  // Fetch all stash entries (stash@{0}, stash@{1}, ...) from the reflog.
  let stashCommits = [];
  try {
    const stashRaw = await git.raw([
      'stash', 'list',
      '--format=%gd%x01%H%x01%P%x01%an%x01%ae%x01%aI%x01%s',
    ]);
    stashCommits = stashRaw.split('\n').filter(Boolean).map(line => {
      const [stashRef, hash, parents, authorName, authorEmail, date, subject] = line.split('\x01');
      return {
        hash,
        parents: parents ? parents.split(' ').filter(Boolean) : [],
        author: { name: authorName, email: authorEmail },
        date,
        subject,
        _stashRef: stashRef, // "stash@{0}" etc
      };
    });
  } catch {
    // No stashes or older git — ignore.
  }

  // Merge & dedupe (log shouldn't overlap with stash since we dropped --all,
  // but keep defensive dedupe). Preserve git's --topo-order: don't sort by
  // date afterward, otherwise side-branch commits get re-interleaved with
  // mainline by timestamp and the graph lines criss-cross.
  const seen = new Set();
  const merged = [];
  for (const c of [...logCommits, ...stashCommits]) {
    if (seen.has(c.hash)) continue;
    seen.add(c.hash);
    merged.push(c);
  }

  // Attach refs (branches/tags/remotes). Skip refs/stash — stash entries get
  // their stash@{N} label applied below.
  // Use lstrip=2 instead of :short so symbolic refs like refs/remotes/origin/HEAD
  // come out as "origin/HEAD" instead of bare "origin" (which collides visually
  // with the collapsed display of refs/remotes/origin/master).
  const refsRaw = await git.raw(['for-each-ref', '--format=%(objectname) %(refname:lstrip=2) %(refname)']);
  const refsByCommit = new Map();
  refsRaw.split('\n').filter(Boolean).forEach(line => {
    const [sha, shortName, fullName] = line.split(' ');
    if (!sha) return;
    if (fullName === 'refs/stash') return;
    const kind = fullName?.startsWith('refs/remotes/')
      ? 'remote'
      : fullName?.startsWith('refs/tags/')
      ? 'tag'
      : 'local';
    if (!refsByCommit.has(sha)) refsByCommit.set(sha, []);
    refsByCommit.get(sha).push({ name: shortName, kind });
  });
  for (const s of stashCommits) {
    if (!refsByCommit.has(s.hash)) refsByCommit.set(s.hash, []);
    refsByCommit.get(s.hash).push({ name: s._stashRef, kind: 'stash' });
    delete s._stashRef;
  }

  const head = (await git.raw(['rev-parse', 'HEAD'])).trim();
  merged.forEach(c => {
    c.refs = refsByCommit.get(c.hash) || [];
    c.isHead = c.hash === head;
  });

  // Topologically regroup each stash to sit immediately above its first
  // parent, instead of wherever its timestamp landed in the date-sorted
  // stream. Stashes are side dots that belong next to the commit they were
  // taken from — interleaving them by date can drop one into the middle of
  // an unrelated feature branch and force the renderer to route its lane
  // around the intervening commits.
  return { head, commits: regroupStashes(merged) };
}

function regroupStashes(commits) {
  const isStash = c => c.refs?.some(r => r.kind === 'stash');
  const visible = new Set(commits.map(c => c.hash));

  const stashesByParent = new Map();
  const remaining = [];
  for (const c of commits) {
    const parent = c.parents[0];
    if (isStash(c) && parent && visible.has(parent)) {
      if (!stashesByParent.has(parent)) stashesByParent.set(parent, []);
      stashesByParent.get(parent).push(c);
    } else {
      // Non-stashes and orphan stashes (parent not in the visible window)
      // stay where they were in the date-sorted stream.
      remaining.push(c);
    }
  }

  const result = [];
  for (const c of remaining) {
    const grouped = stashesByParent.get(c.hash);
    if (grouped) for (const s of grouped) result.push(s);
    result.push(c);
  }
  return result;
}

function parseCommitLine(line) {
  const [hash, parents, authorName, authorEmail, date, subject] = line.split('\x01');
  return {
    hash,
    parents: parents ? parents.split(' ').filter(Boolean) : [],
    author: { name: authorName, email: authorEmail },
    date,
    subject,
  };
}

export async function getCommitDetail(repoPath, sha) {
  const git = getGit(repoPath);

  // Metadata in its own call with `-s` (no patch). `%b` may span multiple
  // lines (body + trailers), so we can't reliably split body from patch when
  // both are in the same output stream — fetch them separately.
  const meta = await git.raw([
    'show', '-s',
    '--format=%H%x01%P%x01%an%x01%ae%x01%aI%x01%s%x01%b',
    sha,
  ]);
  const parts = meta.replace(/\n$/, '').split('\x01');
  const [hash, parents, authorName, authorEmail, date, subject] = parts;
  const body = parts.slice(6).join('\x01').trim();
  const parentList = parents ? parents.split(' ').filter(Boolean) : [];

  // `git show` on a merge defaults to combined diff (--cc), which only emits
  // files that differ from *every* parent — and the stash commit's own tree
  // doesn't contain untracked files at all (they live in parent[2], the
  // untracked-tree from `git stash -u`). Both effects hide the same files.
  // `git stash show -u` walks both pieces (tracked diff vs base + untracked
  // tree) and is exactly what other UIs use, so route stashes through it.
  const stash = await isStashCommit(git, hash);

  const filesRaw = stash
    ? await git.raw(['stash', 'show', '-u', '--name-status', sha])
    : await git.raw(['show', '--name-status', '--format=', sha]);
  const fileList = filesRaw.split('\n').filter(Boolean).map(line => {
    const [code, ...rest] = line.split('\t');
    return { status: code.charAt(0), path: rest.join('\t') };
  });

  // Blob sizes for the changed files as they exist in this commit's tree.
  // Deleted files (and untracked entries that live in a stash's parent tree)
  // simply won't resolve here and keep size = null.
  const sizes = await getBlobSizes(git, hash, fileList.map(f => f.path));
  for (const f of fileList) f.size = sizes.get(f.path) ?? null;

  // Skip `--stat` — the frontend already renders the file summary in its own
  // section, and parsing is cleaner when the output is pure `diff --git` blocks.
  const diff = stash
    ? await git.raw(['stash', 'show', '-u', '-p', sha])
    : await git.raw(['show', '--format=', '--patch', sha]);

  return {
    hash,
    parents: parentList,
    author: { name: authorName, email: authorEmail },
    date,
    subject,
    body,
    files: fileList,
    diff,
  };
}

async function isStashCommit(git, sha) {
  return (await stashHashSet(git)).has(sha);
}

// Resolve blob byte-sizes for a set of paths inside a tree-ish. Returns a
// Map<path, size>; paths missing from the tree (e.g. deleted files) are absent.
// `-z` keeps paths with tabs/newlines intact; `-l` adds the size column.
async function getBlobSizes(git, treeish, paths) {
  const sizes = new Map();
  if (!paths.length) return sizes;
  try {
    const raw = await git.raw(['ls-tree', '-l', '-z', treeish, '--', ...paths]);
    for (const entry of raw.split('\0')) {
      if (!entry) continue;
      // "<mode> <type> <object> <size>\t<path>"  (size is "-" for non-blobs)
      const tab = entry.indexOf('\t');
      if (tab === -1) continue;
      const size = parseInt(entry.slice(0, tab).trim().split(/\s+/)[3], 10);
      if (!Number.isNaN(size)) sizes.set(entry.slice(tab + 1), size);
    }
  } catch {
    // Older git or unreadable tree — sizes stay unknown.
  }
  return sizes;
}

// Diff for a working-tree file (vs HEAD). For untracked files, show full content as +.
export async function getWorkingDiff(repoPath, file) {
  const git = getGit(repoPath);
  const status = await git.status();
  const entry = status.files.find(f => f.path === file);
  if (!entry) {
    // File might be clean or not exist; return empty diff
    return { diff: '', file, untracked: false, binary: false };
  }
  const untracked = entry.index === '?' && entry.working_dir === '?';
  if (untracked) {
    const abs = path.join(repoPath, file);
    let content = '';
    let binary = false;
    try {
      const buf = fs.readFileSync(abs);
      if (buf.includes(0)) {
        binary = true;
      } else {
        content = buf.toString('utf8');
      }
    } catch {
      // unreadable
    }
    return { diff: '', file, untracked: true, binary, content };
  }
  // Include both staged and unstaged changes (HEAD..worktree)
  const diff = await git.raw(['diff', 'HEAD', '--', file]);
  return { diff, file, untracked: false, binary: false };
}

export async function getCommitFileDiff(repoPath, sha, file) {
  const git = getGit(repoPath);
  // Stashes need special handling because `git show -- file` on a merge
  // commit returns a combined diff that hides untracked files entirely
  // (they aren't in the stash's own tree — they sit in parent[2]).
  // `git stash show` doesn't accept a pathspec, so resolve the file's
  // location ourselves: tracked file → diff parent[0]..sha; untracked
  // file → show it from parent[2] (a root commit, so `git show` prints
  // it as an addition).
  if (await isStashCommit(git, sha)) {
    const parents = (await git.raw(['rev-list', '--parents', '-n', '1', sha]))
      .trim().split(' ').slice(1);
    if (parents.length > 0) {
      const inStashTree = await pathExistsInTree(git, sha, file);
      if (inStashTree) {
        const diff = await git.raw(['diff', parents[0], sha, '--', file]);
        return { diff, file, sha };
      }
      const untrackedParent = parents[2];
      if (untrackedParent && await pathExistsInTree(git, untrackedParent, file)) {
        const diff = await git.raw(['show', untrackedParent, '--', file]);
        return { diff, file, sha };
      }
    }
  }
  const diff = await git.raw(['show', `${sha}`, '--', file]);
  return { diff, file, sha };
}

async function pathExistsInTree(git, ref, file) {
  try {
    await git.raw(['cat-file', '-e', `${ref}:${file}`]);
    return true;
  } catch {
    return false;
  }
}

async function stashHashSet(git) {
  try {
    const raw = await git.raw(['stash', 'list', '--format=%H']);
    return new Set(raw.split('\n').map(s => s.trim()).filter(Boolean));
  } catch {
    return new Set();
  }
}

// Discard working-tree + index changes for one path.
// Untracked → remove from disk. Tracked (modified / staged / added / deleted / renamed)
// → `git restore --source=HEAD --staged --worktree`, which for added-and-staged
// files also removes them from the working tree since HEAD does not contain them.
export async function discardFile(repoPath, file) {
  const git = getGit(repoPath);
  const status = await git.status();
  const entry = status.files.find(f => f.path === file);
  if (!entry) return { file, discarded: false };

  const untracked = entry.index === '?' && entry.working_dir === '?';
  if (untracked) {
    const abs = path.join(repoPath, file);
    fs.rmSync(abs, { force: true, recursive: true });
    return { file, discarded: true };
  }

  await git.raw(['restore', '--source=HEAD', '--staged', '--worktree', '--', file]);
  return { file, discarded: true };
}

// Discard every working-tree + index change. Tracked changes revert to HEAD;
// untracked files and directories are removed (gitignored files are preserved
// — no `-x`).
export async function discardAll(repoPath) {
  const git = getGit(repoPath);
  const status = await git.status();
  const tracked = status.files.filter(f => !(f.index === '?' && f.working_dir === '?'));
  const untracked = status.files.filter(f => f.index === '?' && f.working_dir === '?');

  if (tracked.length) {
    await git.raw(['restore', '--source=HEAD', '--staged', '--worktree', '--', '.']);
  }
  for (const f of untracked) {
    fs.rmSync(path.join(repoPath, f.path), { force: true, recursive: true });
  }
  return { discarded: status.files.length };
}
