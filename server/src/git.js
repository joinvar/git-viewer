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

// Fetch log with parents so the frontend can draw a graph
export async function getLog(repoPath, { limit = 500, all = true, includeRemote = true } = {}) {
  const git = getGit(repoPath);
  const args = [
    `--pretty=format:%H%x01%P%x01%an%x01%ae%x01%aI%x01%s`,
    `-n${limit}`,
  ];
  if (all) args.push('--all');
  if (!includeRemote) {
    // --all includes remotes; if excluded, branches only
    args.splice(args.indexOf('--all'), 1);
    args.push('--branches');
  }
  const raw = await git.raw(['log', ...args]);
  const commits = raw.split('\n').filter(Boolean).map(line => {
    const [hash, parents, authorName, authorEmail, date, subject] = line.split('\x01');
    return {
      hash,
      parents: parents ? parents.split(' ').filter(Boolean) : [],
      author: { name: authorName, email: authorEmail },
      date,
      subject,
    };
  });

  // Attach refs (branches/tags) to each commit
  const refsRaw = await git.raw(['for-each-ref', '--format=%(objectname) %(refname:short) %(refname)']);
  const refsByCommit = new Map();
  refsRaw.split('\n').filter(Boolean).forEach(line => {
    const [sha, shortName, fullName] = line.split(' ');
    if (!sha) return;
    const kind = fullName?.startsWith('refs/remotes/')
      ? 'remote'
      : fullName?.startsWith('refs/tags/')
      ? 'tag'
      : 'local';
    if (!refsByCommit.has(sha)) refsByCommit.set(sha, []);
    refsByCommit.get(sha).push({ name: shortName, kind });
  });

  const head = (await git.raw(['rev-parse', 'HEAD'])).trim();

  commits.forEach(c => {
    c.refs = refsByCommit.get(c.hash) || [];
    c.isHead = c.hash === head;
  });

  return { head, commits };
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
