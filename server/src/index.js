import express from 'express';
import cors from 'cors';
import { loadConfig } from './config.js';
import {
  getStatus,
  getBranches,
  getLog,
  getCommitDetail,
  getWorkingDiff,
  getCommitFileDiff,
} from './git.js';

const config = loadConfig();
const app = express();
app.use(cors());
app.use(express.json());

function findRepo(id) {
  return config.repos.find(r => r.id === id);
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

app.get('/api/repos', (req, res) => {
  res.json(config.repos.map(({ id, name, path }) => ({ id, name, path })));
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

app.listen(config.port, () => {
  console.log(`git-viewer server listening on http://localhost:${config.port}`);
  console.log(`repos: ${config.repos.map(r => r.id).join(', ') || '(none)'}`);
});
