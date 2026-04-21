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
  const files = s.files.map(f => ({
    path: f.path,
    status: mapStatusCode(f.index, f.working_dir),
    index: f.index,
    workdir: f.working_dir,
    staged: f.index !== ' ' && f.index !== '?',
  }));
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
  // but keep defensive dedupe). Sort newest first by ISO date.
  const seen = new Set();
  const merged = [];
  for (const c of [...logCommits, ...stashCommits]) {
    if (seen.has(c.hash)) continue;
    seen.add(c.hash);
    merged.push(c);
  }
  merged.sort((a, b) => (b.date || '').localeCompare(a.date || ''));

  // Attach refs (branches/tags/remotes). Skip refs/stash — stash entries get
  // their stash@{N} label applied below.
  const refsRaw = await git.raw(['for-each-ref', '--format=%(objectname) %(refname:short) %(refname)']);
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

  return { head, commits: merged };
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
  const show = await git.show([
    '--stat',
    '--patch',
    '--format=%H%x01%P%x01%an%x01%ae%x01%aI%x01%s%x01%b',
    sha,
  ]);
  // First line is the formatted meta; rest is stat+diff
  const nl = show.indexOf('\n');
  const metaLine = show.slice(0, nl);
  const body = show.slice(nl + 1);
  const [hash, parents, authorName, authorEmail, date, subject, commitBody] = metaLine.split('\x01');

  // Files changed (from --stat section or diff headers)
  const files = await git.raw(['show', '--name-status', '--format=', sha]);
  const fileList = files.split('\n').filter(Boolean).map(line => {
    const [code, ...rest] = line.split('\t');
    return { status: code.charAt(0), path: rest.join('\t') };
  });

  return {
    hash,
    parents: parents ? parents.split(' ').filter(Boolean) : [],
    author: { name: authorName, email: authorEmail },
    date,
    subject,
    body: commitBody || '',
    files: fileList,
    diff: body,
  };
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
  const diff = await git.raw(['show', `${sha}`, '--', file]);
  return { diff, file, sha };
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
