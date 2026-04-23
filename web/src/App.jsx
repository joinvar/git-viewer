import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from './api.js';
import { computeGraph } from './graph.js';
import GraphCell from './components/GraphCell.jsx';
import DiffView, { DiffLines } from './components/DiffView.jsx';
import ReposDialog from './components/ReposDialog.jsx';
import FileList from './components/FileList.jsx';

const UNCOMMITTED = '__uncommitted__';
const FILES_VIEW_KEY = 'git-viewer.filesView';

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
  const [filesView, setFilesView] = useState(() => {
    const v = typeof localStorage !== 'undefined' && localStorage.getItem(FILES_VIEW_KEY);
    return v === 'tree' ? 'tree' : 'list';
  });

  useEffect(() => {
    try { localStorage.setItem(FILES_VIEW_KEY, filesView); } catch {}
  }, [filesView]);

  // Resizable layout widths
  const [sidebarWidth, setSidebarWidth] = useState(280);
  const [logPaneWidth, setLogPaneWidth] = useState(null); // null → 50/50 default
  const [graphWidth, setGraphWidth] = useState(48);
  const [dateWidth, setDateWidth] = useState(140);
  const [authorWidth, setAuthorWidth] = useState(140);
  const logPaneRef = useRef(null);

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

  function discardChange(f) {
    if (!repoId) return;
    const untracked = f.status === 'U';
    const msg = untracked
      ? `确定要删除未跟踪文件 "${f.path}" 吗？此操作不可撤销。`
      : `确定要丢弃对 "${f.path}" 的改动吗？已暂存和工作区的修改都会被还原到 HEAD。`;
    if (!window.confirm(msg)) return;
    api.discardFile(repoId, f.path)
      .then(() => {
        if (selection?.type === 'change' && selection.file === f.path) setSelection(null);
        refresh();
      })
      .catch(e => setError(e.message));
  }

  function discardAllChanges() {
    if (!repoId || !status?.files?.length) return;
    const n = status.files.length;
    if (!window.confirm(`确定要丢弃全部 ${n} 处改动吗？未跟踪文件将被删除，修改将还原到 HEAD，此操作不可撤销。`)) return;
    api.discardAll(repoId)
      .then(() => {
        if (selection?.type === 'change' || selection?.type === 'uncommitted') setSelection(null);
        refresh();
      })
      .catch(e => setError(e.message));
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

  const hasUncommitted = status && status.files && status.files.length > 0;

  // Uncommitted is rendered as a virtual commit at the top of the graph so
  // computeGraph can wire HEAD into lane 0 — the dashed uncommitted lane runs
  // all the way down to the HEAD commit, which is the relationship the user
  // expects to see (working tree is "based on HEAD", not "above the topmost
  // visible commit").
  const uncommittedVirtual = useMemo(() => {
    if (!hasUncommitted || branchFilter !== '__all__' || !log) return null;
    return {
      hash: UNCOMMITTED,
      parents: log.head ? [log.head] : [],
      refs: [],
      isHead: false,
      isUncommitted: true,
    };
  }, [hasUncommitted, branchFilter, log]);

  const graphCommits = useMemo(
    () => uncommittedVirtual ? [uncommittedVirtual, ...filteredCommits] : filteredCommits,
    [uncommittedVirtual, filteredCommits]
  );

  const graphRows = useMemo(() => computeGraph(graphCommits), [graphCommits]);
  const maxLanes = useMemo(
    () => graphRows.reduce((m, r) => Math.max(m, r.lanesBefore.length, r.lanesAfter.length), 0),
    [graphRows]
  );
  const commitRowOffset = uncommittedVirtual ? 1 : 0;

  // Auto-fit the Graph column to the widest row of lanes so a many-branch
  // repo doesn't bleed dots/curves under the Description column. `graphWidth`
  // is the user's manual preference (only changed by dragging the resizer);
  // `effectiveGraphWidth` is what we actually render with — clamped up to
  // the min that fits maxLanes (14px/lane + 8px buffer). Users can still
  // drag wider, but can't drag narrower than that minimum.
  const minGraphWidth = useMemo(
    () => Math.max(24, (maxLanes || 1) * 14 + 8),
    [maxLanes]
  );
  const effectiveGraphWidth = Math.max(graphWidth, minGraphWidth);

  const appStyle = { gridTemplateColumns: `${sidebarWidth}px 4px 1fr` };
  const splitStyle = {
    gridTemplateColumns: logPaneWidth != null
      ? `${logPaneWidth}px 4px 1fr`
      : `1fr 4px 1fr`,
  };
  const logPaneStyle = {
    '--log-graph-w': `${effectiveGraphWidth}px`,
    '--log-date-w': `${dateWidth}px`,
    '--log-author-w': `${authorWidth}px`,
  };

  return (
    <div className="app" style={appStyle}>
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
          <button
            className="icon-btn refresh-btn"
            onClick={() => refresh()}
            disabled={!repoId}
            title="刷新"
          >
            ↻
          </button>
        </div>

        <div className="section-header">
          <span>Changes</span>
          <span className="section-right">
            <ViewToggle value={filesView} onChange={setFilesView} />
            {hasUncommitted && (
              <button
                className="icon-btn discard-btn"
                title="丢弃所有改动"
                onClick={() => discardAllChanges()}
              >
                ↶
              </button>
            )}
            <span className="count">{status?.files?.length || 0}</span>
          </span>
        </div>
        <div className="changes-list">
          {!status && <div className="empty">…</div>}
          {status && status.files.length === 0 && (
            <div className="empty">工作区干净</div>
          )}
          {status && status.files.length > 0 && (
            <FileList
              files={status.files}
              mode={filesView}
              isSelected={f => selection?.type === 'change' && selection.file === f.path}
              onSelect={f => setSelection({ type: 'change', file: f.path })}
              rowClass="change-row"
              renderRow={(f, { label }) => (
                <>
                  <span className="file">{label}</span>
                  <button
                    className="icon-btn row-discard-btn"
                    title={`丢弃对 ${f.path} 的改动`}
                    onClick={e => { e.stopPropagation(); discardChange(f); }}
                  >
                    ↶
                  </button>
                  <span className={`code ${f.status}`}>{f.status}</span>
                </>
              )}
            />
          )}
        </div>
      </aside>

      <div
        className="resizer-x sidebar-resizer"
        onMouseDown={e => startDrag(e, sidebarWidth, 160, 640, setSidebarWidth, +1)}
      />

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

        <div className="log-and-diff" style={splitStyle}>
          <div className="log-pane" ref={logPaneRef} style={logPaneStyle}>
            <div className="log-header">
              <span>Graph</span>
              <span>Description</span>
              <span>Date</span>
              <span>Author</span>
            </div>
            <div
              className="resizer-col col-graph-desc"
              style={{ left: `${effectiveGraphWidth + 2}px` }}
              onMouseDown={e => startDrag(e, effectiveGraphWidth, minGraphWidth, 320, setGraphWidth, +1)}
            />
            <div
              className="resizer-col col-desc-date"
              style={{ right: `${dateWidth + authorWidth + 24}px` }}
              onMouseDown={e => startDrag(e, dateWidth, 60, 400, setDateWidth, -1)}
            />
            <div
              className="resizer-col col-date-author"
              style={{ right: `${authorWidth + 24}px` }}
              onMouseDown={e => startDrag(e, authorWidth, 60, 400, setAuthorWidth, -1)}
            />
            <div className="log-rows">
              {uncommittedVirtual && (
                <div
                  className={`log-row ${selection?.type === 'uncommitted' ? 'selected' : ''}`}
                  onClick={() => setSelection({ type: 'uncommitted' })}
                >
                  <div className="graph">
                    <GraphCell row={graphRows[0]} commit={uncommittedVirtual} maxLanes={maxLanes} />
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
                    <GraphCell row={graphRows[i + commitRowOffset]} commit={c} maxLanes={maxLanes} />
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

          <div
            className="resizer-x log-resizer"
            onMouseDown={e => startDrag(
              e,
              logPaneRef.current?.offsetWidth ?? 600,
              220,
              2000,
              setLogPaneWidth,
              +1,
            )}
          />

          <DiffPanel
            selection={selection}
            diff={diff}
            status={status}
            setSelection={setSelection}
            filesView={filesView}
          />
        </div>
      </div>
    </div>
  );
}

function DiffPanel({ selection, diff, status, setSelection, filesView }) {
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
          <FileList
            files={status?.files || []}
            mode={filesView}
            onSelect={f => setSelection({ type: 'change', file: f.path })}
            rowClass="file-item"
            renderRow={(f, { label }) => (
              <>
                <span className={`code ${f.status}`}>{f.status}</span>
                <span>{label}</span>
              </>
            )}
          />
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
    const fileDiffs = splitPatchByFile(c.diff);
    const statusByPath = new Map(c.files.map(f => [f.path, f.status]));
    return (
      <div className="diff-pane">
        <div className="diff-header commit-meta">
          <div className="title">{c.subject}</div>
          <div className="meta">
            {c.hash.slice(0, 8)} · {c.author.name} · {formatDate(c.date)}
            {c.parents.length > 1 && ` · merge of ${c.parents.length} parents`}
          </div>
          {c.body && <pre className="commit-body">{c.body}</pre>}
        </div>
        <div className="section-bar">文件 ({c.files.length})</div>
        <div className="files-list">
          <FileList
            files={c.files}
            mode={filesView}
            onSelect={f => scrollToFileDiff(f.path)}
            rowClass="file-item"
            renderRow={(f, { label }) => (
              <>
                <span className={`code ${f.status}`}>{f.status}</span>
                <span>{label}</span>
              </>
            )}
          />
        </div>
        <div className="section-bar">差异</div>
        {fileDiffs.length === 0 && <div className="diff-empty">无差异</div>}
        {fileDiffs.map(fd => {
          const st = statusByPath.get(fd.path) || 'M';
          return (
            <section
              key={fd.path}
              id={fileDiffId(fd.path)}
              className="file-diff-block"
            >
              <div className="file-diff-header">
                <span className={`code ${st}`}>{st}</span>
                <span className="path">{fd.path}</span>
              </div>
              <DiffLines text={fd.patch} />
            </section>
          );
        })}
      </div>
    );
  }

  return <div className="diff-pane"><div className="diff-empty">Unsupported</div></div>;
}

function ViewToggle({ value, onChange }) {
  return (
    <span className="view-toggle" title="切换文件列表显示方式">
      <button
        className={`icon-btn ${value === 'list' ? 'active' : ''}`}
        onClick={() => onChange('list')}
        title="列表视图"
      >
        <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M2 4h12M2 8h12M2 12h12" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round" />
        </svg>
      </button>
      <button
        className={`icon-btn ${value === 'tree' ? 'active' : ''}`}
        onClick={() => onChange('tree')}
        title="树视图"
      >
        <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true">
          <path
            d="M2 3h4M4 3v9M4 7h4M4 11h4M9 6h5M9 10h5"
            stroke="currentColor"
            strokeWidth="1.4"
            fill="none"
            strokeLinecap="round"
          />
        </svg>
      </button>
    </span>
  );
}

function startDrag(e, initial, min, max, onChange, sign) {
  e.preventDefault();
  const startX = e.clientX;
  function onMove(me) {
    const dx = (me.clientX - startX) * sign;
    const next = Math.max(min, Math.min(max, initial + dx));
    onChange(next);
  }
  function onUp() {
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  }
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
  document.body.style.cursor = 'col-resize';
  document.body.style.userSelect = 'none';
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

// Split `git show --patch` output into per-file blocks, keyed by the
// destination path (`b/<path>` in the `diff --git` marker).
function splitPatchByFile(text) {
  if (!text) return [];
  const positions = [];
  const re = /^diff --git /gm;
  let m;
  while ((m = re.exec(text)) !== null) positions.push(m.index);
  if (!positions.length) return [];
  const chunks = [];
  for (let i = 0; i < positions.length; i++) {
    const start = positions[i];
    const end = i + 1 < positions.length ? positions[i + 1] : text.length;
    const block = text.slice(start, end);
    const firstLine = block.split('\n', 1)[0];
    // diff --git a/<old> b/<new> — paths may be quoted when they contain spaces.
    const match = firstLine.match(/^diff --git (?:"a\/(.+?)"|a\/(\S+)) (?:"b\/(.+?)"|b\/(.+))$/);
    const path = match ? (match[3] || match[4]) : firstLine.replace(/^diff --git /, '');
    chunks.push({ path, patch: block });
  }
  return chunks;
}

function fileDiffId(path) {
  return `diff-file-${path}`;
}

function scrollToFileDiff(path) {
  const el = document.getElementById(fileDiffId(path));
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
