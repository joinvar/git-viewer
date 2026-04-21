import { useEffect, useMemo, useState } from 'react';
import { api } from './api.js';
import { computeGraph } from './graph.js';
import GraphCell from './components/GraphCell.jsx';
import DiffView from './components/DiffView.jsx';
import ReposDialog from './components/ReposDialog.jsx';

const UNCOMMITTED = '__uncommitted__';

export default function App() {
  const [repos, setRepos] = useState([]);
  const [repoId, setRepoId] = useState(null);
  const [status, setStatus] = useState(null);
  const [branches, setBranches] = useState(null);
  const [log, setLog] = useState(null);
  const [branchFilter, setBranchFilter] = useState('__all__');
  const [showRemote, setShowRemote] = useState(true);
  const [selection, setSelection] = useState(null); // { type: 'change'|'commit', ... }
  const [diff, setDiff] = useState(null);
  const [error, setError] = useState(null);
  const [showRepoDialog, setShowRepoDialog] = useState(false);

  // Load repos on mount
  useEffect(() => {
    api.listRepos().then(rs => {
      setRepos(rs);
      if (rs.length) setRepoId(rs[0].id);
    }).catch(e => setError(e.message));
  }, []);

  // Load repo data when repo changes
  useEffect(() => {
    if (!repoId) return;
    setStatus(null); setBranches(null); setLog(null); setSelection(null); setDiff(null);
    refresh(repoId);
  }, [repoId]);

  function refresh(id = repoId) {
    if (!id) return;
    Promise.all([
      api.status(id),
      api.branches(id),
      api.log(id, { remote: showRemote }),
    ]).then(([s, b, l]) => {
      setStatus(s); setBranches(b); setLog(l);
      setError(null);
    }).catch(e => setError(e.message));
  }

  // Reload log when showRemote changes
  useEffect(() => {
    if (!repoId) return;
    api.log(repoId, { remote: showRemote }).then(setLog).catch(e => setError(e.message));
  }, [showRemote]);

  // Load diff for current selection
  useEffect(() => {
    if (!selection || !repoId) { setDiff(null); return; }
    if (selection.type === 'change') {
      api.diff(repoId, selection.file).then(setDiff).catch(e => setError(e.message));
    } else if (selection.type === 'commit') {
      api.commit(repoId, selection.sha).then(setDiff).catch(e => setError(e.message));
    } else if (selection.type === 'commit-file') {
      api.diff(repoId, selection.file, selection.sha).then(setDiff).catch(e => setError(e.message));
    }
  }, [selection, repoId]);

  const filteredCommits = useMemo(() => {
    if (!log) return [];
    if (branchFilter === '__all__') return log.commits;
    // Find the tip SHA for this branch, then walk its ancestry
    const tip = findBranchTip(branches, branchFilter);
    if (!tip) return log.commits;
    return filterAncestors(log.commits, tip);
  }, [log, branches, branchFilter]);

  const graphRows = useMemo(() => computeGraph(filteredCommits), [filteredCommits]);
  const maxLanes = useMemo(
    () => graphRows.reduce((m, r) => Math.max(m, r.lanesBefore.length, r.lanesAfter.length), 0),
    [graphRows]
  );

  const hasUncommitted = status && status.files && status.files.length > 0;

  return (
    <div className="app">
      <div className="titlebar">
        <span className="title">git-viewer</span>
        {status && (
          <span className="status-info">
            <span>● {status.branch || '(detached)'}</span>
            {status.tracking && <span>↔ {status.tracking}</span>}
            {(status.ahead > 0 || status.behind > 0) && (
              <span>↑{status.ahead} ↓{status.behind}</span>
            )}
          </span>
        )}
        <div className="spacer" />
        <button onClick={() => refresh()}>Refresh</button>
        <button onClick={() => setShowRepoDialog(true)} title="管理仓库">⚙ 仓库</button>
      </div>
      {showRepoDialog && (
        <ReposDialog
          repos={repos}
          onClose={() => setShowRepoDialog(false)}
          onChanged={(rs) => {
            setRepos(rs);
            // Keep current selection valid; if current repo was removed, switch to first available
            if (repoId && !rs.find(r => r.id === repoId)) {
              setRepoId(rs[0]?.id || null);
            }
          }}
        />
      )}

      <aside className="sidebar">
        <div className="repo-selector">
          <select value={repoId || ''} onChange={e => setRepoId(e.target.value)}>
            {repos.map(r => (
              <option key={r.id} value={r.id}>{r.name}</option>
            ))}
          </select>
        </div>

        <div className="section-header">
          <span>Changes</span>
          <span>{status?.files?.length || 0}</span>
        </div>
        <div className="changes-list">
          {!status && <div className="empty">…</div>}
          {status && status.files.length === 0 && (
            <div className="empty">工作区干净</div>
          )}
          {status && status.files.map(f => (
            <div
              key={f.path}
              className={`change-row ${selection?.type === 'change' && selection.file === f.path ? 'selected' : ''}`}
              onClick={() => setSelection({ type: 'change', file: f.path })}
              title={f.path}
            >
              <span className="file">{f.path}</span>
              <span className={`code ${f.status}`}>{f.status}</span>
            </div>
          ))}
        </div>
      </aside>

      <div className="right-pane">
        <div className="toolbar">
          <label>
            Branches:
            <select value={branchFilter} onChange={e => setBranchFilter(e.target.value)}>
              <option value="__all__">Show All</option>
              {branches?.local.map(b => (
                <option key={`L-${b.name}`} value={`local:${b.name}`}>{b.name}</option>
              ))}
              {showRemote && branches?.remote.map(b => (
                <option key={`R-${b.name}`} value={`remote:${b.name}`}>{b.name}</option>
              ))}
            </select>
          </label>
          <label>
            <input type="checkbox" checked={showRemote} onChange={e => setShowRemote(e.target.checked)} />
            Show Remote Branches
          </label>
          {error && <span style={{ color: 'var(--conflict)' }}>Error: {error}</span>}
        </div>

        <div className="log-and-diff">
          <div className="log-pane">
            <div className="log-header">
              <span>Graph</span>
              <span>Description</span>
              <span>Date</span>
              <span>Author</span>
            </div>
            <div className="log-rows">
              {hasUncommitted && branchFilter === '__all__' && (
                <div
                  className={`log-row ${selection?.type === 'uncommitted' ? 'selected' : ''}`}
                  onClick={() => setSelection({ type: 'uncommitted' })}
                >
                  <div className="graph">
                    <svg width={16} height={22}>
                      <circle cx={7} cy={11} r={4} fill="none" stroke="#b89500" strokeWidth="2" />
                      <line x1={7} y1={15} x2={7} y2={22} stroke="#b89500" strokeWidth="1.5" />
                    </svg>
                  </div>
                  <div className="subject">
                    <span className="ref-chip uncommitted">Uncommitted Changes ({status.files.length})</span>
                  </div>
                  <div className="date"></div>
                  <div className="author"></div>
                </div>
              )}
              {filteredCommits.map((c, i) => (
                <div
                  key={c.hash}
                  className={`log-row ${selection?.type === 'commit' && selection.sha === c.hash ? 'selected' : ''}`}
                  onClick={() => setSelection({ type: 'commit', sha: c.hash })}
                >
                  <div className="graph">
                    <GraphCell row={graphRows[i]} commit={c} maxLanes={maxLanes} />
                  </div>
                  <div className="subject">
                    {c.refs.map(r => (
                      <span
                        key={`${r.kind}-${r.name}`}
                        className={`ref-chip ${r.kind}${c.isHead && r.kind === 'local' ? ' head' : ''}`}
                      >
                        {r.name}
                      </span>
                    ))}
                    <span className="text" title={c.subject}>{c.subject}</span>
                  </div>
                  <div className="date">{formatDate(c.date)}</div>
                  <div className="author" title={c.author.email}>{c.author.name}</div>
                </div>
              ))}
              {filteredCommits.length === 0 && <div className="empty">无提交</div>}
            </div>
          </div>

          <DiffPanel selection={selection} diff={diff} status={status} setSelection={setSelection} />
        </div>
      </div>
    </div>
  );
}

function DiffPanel({ selection, diff, status, setSelection }) {
  if (!selection) {
    return (
      <div className="diff-pane">
        <div className="diff-empty">选择一个改动或提交来查看差异</div>
      </div>
    );
  }

  if (selection.type === 'uncommitted') {
    // Show list of changed files with combined counts
    return (
      <div className="diff-pane">
        <div className="diff-header">
          <div className="title">Uncommitted Changes</div>
          <div className="meta">{status?.files?.length || 0} 个文件有改动</div>
        </div>
        <div className="files-list">
          {status?.files?.map(f => (
            <div key={f.path} className="file-item" onClick={() => setSelection({ type: 'change', file: f.path })}>
              <span className={`code ${f.status}`}>{f.status}</span>
              <span>{f.path}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (!diff) return <div className="diff-pane"><div className="diff-empty">加载中…</div></div>;

  if (selection.type === 'change') {
    return (
      <DiffView
        title={selection.file}
        meta="working tree vs HEAD"
        diff={diff.diff}
        untracked={diff.untracked}
        binary={diff.binary}
        content={diff.content}
      />
    );
  }

  if (selection.type === 'commit') {
    const c = diff;
    return (
      <div className="diff-pane">
        <div className="diff-header">
          <div className="title">{c.subject}</div>
          <div className="meta">
            {c.hash.slice(0, 8)} · {c.author.name} · {formatDate(c.date)}
            {c.parents.length > 1 && ` · merge of ${c.parents.length} parents`}
          </div>
          {c.body && <pre style={{ margin: '6px 0 0', color: 'var(--text-dim)', whiteSpace: 'pre-wrap' }}>{c.body}</pre>}
        </div>
        <div className="files-list">
          {c.files.map(f => (
            <div key={f.path} className="file-item">
              <span className={`code ${f.status}`}>{f.status}</span>
              <span>{f.path}</span>
            </div>
          ))}
        </div>
        <DiffView title="" meta="" diff={c.diff} />
      </div>
    );
  }

  return <div className="diff-pane"><div className="diff-empty">Unsupported</div></div>;
}

function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function findBranchTip(branches, filter) {
  if (!branches || !filter) return null;
  const [kind, name] = filter.split(':');
  const list = kind === 'local' ? branches.local : branches.remote;
  return list.find(b => b.name === name)?.commit;
}

function filterAncestors(commits, tip) {
  const byHash = new Map(commits.map(c => [c.hash, c]));
  const keep = new Set();
  const stack = [tip];
  while (stack.length) {
    const sha = stack.pop();
    if (keep.has(sha)) continue;
    const c = byHash.get(sha);
    if (!c) continue;
    keep.add(sha);
    c.parents.forEach(p => stack.push(p));
  }
  return commits.filter(c => keep.has(c.hash));
}
