import express from 'express';
import cors from 'cors';
import {
  loadConfig,
  addRepo,
  updateRepo,
  deleteRepo,
  reorderRepos,
  validateRepoPath,
} from './config.js';
import {
  getStatus,
  getBranches,
  getLog,
  getCommitDetail,
  getWorkingDiff,
  getCommitFileDiff,
} from './git.js';

// Boot-time port — re-reading port on every change would require a restart,
// so we capture it once. Repos are re-read on every request.
const boot = loadConfig();
const PORT = boot.port;

const app = express();
app.use(cors());
app.use(express.json());

function currentRepos() {
  return loadConfig().repos;
}

function findRepo(id) {
  return currentRepos().find(r => r.id === id);
}

function withRepo(handler) {
  return async (req, res) => {
    const repo = findRepo(req.params.id);
    if (!repo) return res.status(404).json({ error: `Unknown repo: ${req.params.id}` });
    try {
      await handler(repo, req, res);
    } catch (err) {
      console.error(`[${req.method} ${req.originalUrl}]`, err);
      res.status(500).json({ error: err.message });
    }
  };
}

function publicRepo(r) {
  return { id: r.id, name: r.name, path: r.path };
}

app.get('/api/repos', (req, res) => {
  res.json(currentRepos().map(publicRepo));
});

app.post('/api/repos', (req, res) => {
  try {
    const { name, path } = req.body || {};
    const cfg = addRepo({ name, path });
    res.json(cfg.repos.map(publicRepo));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.put('/api/repos/:id', (req, res) => {
  try {
    const { name, path } = req.body || {};
    const cfg = updateRepo(req.params.id, { name, path });
    res.json(cfg.repos.map(publicRepo));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/repos/:id', (req, res) => {
  try {
    const cfg = deleteRepo(req.params.id);
    res.json(cfg.repos.map(publicRepo));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/repos/reorder', (req, res) => {
  try {
    const { ids } = req.body || {};
    if (!Array.isArray(ids)) return res.status(400).json({ error: 'ids must be an array' });
    const cfg = reorderRepos(ids);
    res.json(cfg.repos.map(publicRepo));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/validate-path', (req, res) => {
  const { path } = req.body || {};
  res.json(validateRepoPath(path));
});

app.get('/api/repos/:id/status', withRepo(async (repo, req, res) => {
  res.json(await getStatus(repo.path));
}));

app.get('/api/repos/:id/branches', withRepo(async (repo, req, res) => {
  res.json(await getBranches(repo.path));
}));

app.get('/api/repos/:id/log', withRepo(async (repo, req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 500, 2000);
  const includeRemote = req.query.remote !== 'false';
  res.json(await getLog(repo.path, { limit, all: true, includeRemote }));
}));

app.get('/api/repos/:id/commit/:sha', withRepo(async (repo, req, res) => {
  res.json(await getCommitDetail(repo.path, req.params.sha));
}));

app.get('/api/repos/:id/diff', withRepo(async (repo, req, res) => {
  const file = req.query.file;
  if (!file) return res.status(400).json({ error: 'file query param required' });
  if (req.query.sha) {
    res.json(await getCommitFileDiff(repo.path, req.query.sha, file));
  } else {
    res.json(await getWorkingDiff(repo.path, file));
  }
}));

app.listen(PORT, () => {
  console.log(`git-viewer server listening on http://localhost:${PORT}`);
  console.log(`repos: ${currentRepos().map(r => r.id).join(', ') || '(none)'}`);
});
