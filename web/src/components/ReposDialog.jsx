import { useEffect, useState } from 'react';
import { api } from '../api.js';

export default function ReposDialog({ repos, onClose, onChanged }) {
  const [items, setItems] = useState(repos);
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => { setItems(repos); }, [repos]);

  async function reload() {
    const rs = await api.listRepos();
    setItems(rs);
    onChanged?.(rs);
  }

  async function remove(id) {
    if (!confirm(`确认从列表移除 "${items.find(r => r.id === id)?.name}"？（不会删除仓库文件）`)) return;
    setBusyId(id);
    try {
      await api.deleteRepo(id);
      await reload();
      setError(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusyId(null);
    }
  }

  async function move(id, direction) {
    const idx = items.findIndex(r => r.id === id);
    const target = idx + direction;
    if (target < 0 || target >= items.length) return;
    const next = items.slice();
    [next[idx], next[target]] = [next[target], next[idx]];
    setItems(next);
    try {
      await api.reorderRepos(next.map(r => r.id));
      await reload();
    } catch (e) {
      setError(e.message);
      await reload();
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span>仓库管理</span>
          <button className="icon-btn" onClick={onClose} title="关闭">✕</button>
        </div>

        {error && <div className="modal-error">{error}</div>}

        <div className="repo-table">
          {items.length === 0 && <div className="empty">还没有配置仓库，点下面按钮添加一个。</div>}
          {items.map((r, i) => (
            editingId === r.id ? (
              <RepoEditRow
                key={r.id}
                repo={r}
                onCancel={() => setEditingId(null)}
                onSave={async (data) => {
                  try {
                    await api.updateRepo(r.id, data);
                    await reload();
                    setEditingId(null);
                    setError(null);
                  } catch (e) { setError(e.message); }
                }}
              />
            ) : (
              <div key={r.id} className="repo-row">
                <div className="order">
                  <button className="icon-btn" onClick={() => move(r.id, -1)} disabled={i === 0} title="上移">▲</button>
                  <button className="icon-btn" onClick={() => move(r.id, +1)} disabled={i === items.length - 1} title="下移">▼</button>
                </div>
                <div className="repo-info">
                  <div className="repo-name">{r.name}</div>
                  <div className="repo-path" title={r.path}>{r.path}</div>
                </div>
                <div className="repo-actions">
                  <button onClick={() => setEditingId(r.id)} disabled={busyId === r.id}>编辑</button>
                  <button onClick={() => remove(r.id)} disabled={busyId === r.id}>移除</button>
                </div>
              </div>
            )
          ))}
        </div>

        {adding ? (
          <RepoEditRow
            repo={{ name: '', path: '' }}
            onCancel={() => setAdding(false)}
            onSave={async (data) => {
              try {
                await api.addRepo(data);
                await reload();
                setAdding(false);
                setError(null);
              } catch (e) { setError(e.message); }
            }}
          />
        ) : (
          <div className="modal-footer">
            <button onClick={() => setAdding(true)}>+ 添加仓库</button>
            <span className="hint">配置会同步写入 config.json</span>
          </div>
        )}
      </div>
    </div>
  );
}

function RepoEditRow({ repo, onCancel, onSave }) {
  const [name, setName] = useState(repo.name || '');
  const [path, setPath] = useState(repo.path || '');
  const [check, setCheck] = useState(null); // null | {ok, error, path}
  const [checking, setChecking] = useState(false);

  async function validate() {
    if (!path.trim()) { setCheck({ ok: false, error: '路径不能为空' }); return false; }
    setChecking(true);
    try {
      const result = await api.validatePath(path.trim());
      setCheck(result);
      return result.ok;
    } finally { setChecking(false); }
  }

  function autoFillName() {
    if (!name && path) {
      const basename = path.trim().replace(/[\\/]+$/, '').split(/[\\/]/).pop();
      if (basename) setName(basename);
    }
  }

  async function save() {
    if (!await validate()) return;
    onSave({ name: name.trim(), path: path.trim() });
  }

  return (
    <div className="repo-edit">
      <div className="edit-grid">
        <label>路径</label>
        <input
          type="text"
          value={path}
          onChange={e => { setPath(e.target.value); setCheck(null); }}
          onBlur={() => { autoFillName(); if (path.trim()) validate(); }}
          placeholder="D:/code/my-repo"
          autoFocus
        />
        <label>名称</label>
        <input
          type="text"
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="留空则用目录名"
        />
      </div>
      {check && !check.ok && <div className="modal-error">{check.error}</div>}
      {check && check.ok && <div className="modal-ok">✓ 有效 git 仓库</div>}
      <div className="edit-actions">
        <button onClick={save} disabled={checking}>{checking ? '验证中…' : '保存'}</button>
        <button onClick={onCancel}>取消</button>
      </div>
    </div>
  );
}
