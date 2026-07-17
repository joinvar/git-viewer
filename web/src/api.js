const DEFAULT_TIMEOUT_MS = 60_000;

function combineSignals(a, b) {
  if (!a) return b;
  if (!b) return a;
  if (typeof AbortSignal !== 'undefined' && AbortSignal.any) {
    return AbortSignal.any([a, b]);
  }
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  if (a.aborted || b.aborted) {
    controller.abort();
    return controller.signal;
  }
  a.addEventListener('abort', onAbort, { once: true });
  b.addEventListener('abort', onAbort, { once: true });
  return controller.signal;
}

function timeoutSignal(ms) {
  if (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) {
    return AbortSignal.timeout(ms);
  }
  const controller = new AbortController();
  setTimeout(() => controller.abort(), ms);
  return controller.signal;
}

async function j(url, init = {}, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const signal = combineSignals(init.signal, timeoutSignal(timeoutMs));
  let r;
  try {
    r = await fetch(url, { ...init, signal });
  } catch (err) {
    if (err?.name === 'AbortError') {
      // Caller-passed signal aborted → intentional cancel (repo switch / re-refresh).
      // Combined timeout fired while caller signal is still live → real timeout.
      if (init.signal?.aborted) {
        const cancel = new Error('请求已取消');
        cancel.name = 'AbortError';
        throw cancel;
      }
      throw new Error(`请求超时: ${url}`);
    }
    throw new Error(err?.message || `网络错误: ${url}`);
  }
  if (!r.ok) {
    let body = await r.text();
    try { body = JSON.parse(body).error || body; } catch {}
    throw new Error(body || `${r.status} ${r.statusText}`);
  }
  return r.json();
}

const postJSON = (url, data, opts) => j(url, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(data || {}),
  signal: opts?.signal,
}, opts);

const putJSON = (url, data, opts) => j(url, {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(data || {}),
  signal: opts?.signal,
}, opts);

export const api = {
  listRepos: (opts) => j('/api/repos', { signal: opts?.signal }, opts),
  addRepo:   (data, opts) => postJSON('/api/repos', data, opts),
  updateRepo:(id, data, opts) => putJSON(`/api/repos/${id}`, data, opts),
  deleteRepo:(id, opts) => j(`/api/repos/${id}`, { method: 'DELETE', signal: opts?.signal }, opts),
  reorderRepos:(ids, opts) => postJSON('/api/repos/reorder', { ids }, opts),
  validatePath:(p, opts) => postJSON('/api/validate-path', { path: p }, opts),
  health:    (opts) => j('/api/health', { signal: opts?.signal }, { timeoutMs: 5_000, ...opts }),

  status:    (id, opts) => j(`/api/repos/${id}/status`, { signal: opts?.signal }, opts),
  branches:  (id, opts) => j(`/api/repos/${id}/branches`, { signal: opts?.signal }, opts),
  log:       (id, { limit = 500, remote = true } = {}, opts) =>
    j(`/api/repos/${id}/log?limit=${limit}&remote=${remote}`, { signal: opts?.signal }, {
      timeoutMs: 100_000,
      ...opts,
    }),
  commit:    (id, sha, opts) =>
    j(`/api/repos/${id}/commit/${sha}`, { signal: opts?.signal }, { timeoutMs: 100_000, ...opts }),
  diff:      (id, file, sha, opts) =>
    j(`/api/repos/${id}/diff?file=${encodeURIComponent(file)}${sha ? `&sha=${sha}` : ''}`,
      { signal: opts?.signal }, opts),
  discardFile:(id, file, opts) => postJSON(`/api/repos/${id}/discard`, { file }, opts),
  discardAll:(id, opts) => postJSON(`/api/repos/${id}/discard`, { all: true }, opts),
};
