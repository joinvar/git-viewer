async function j(url, init) {
  const r = await fetch(url, init);
  if (!r.ok) {
    let body = await r.text();
    try { body = JSON.parse(body).error || body; } catch {}
    throw new Error(body || `${r.status} ${r.statusText}`);
  }
  return r.json();
}

const postJSON = (url, data) => j(url, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(data || {}),
});

const putJSON = (url, data) => j(url, {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(data || {}),
});

export const api = {
  listRepos: () => j('/api/repos'),
  addRepo:   (data) => postJSON('/api/repos', data),
  updateRepo:(id, data) => putJSON(`/api/repos/${id}`, data),
  deleteRepo:(id) => j(`/api/repos/${id}`, { method: 'DELETE' }),
  reorderRepos:(ids) => postJSON('/api/repos/reorder', { ids }),
  validatePath:(p) => postJSON('/api/validate-path', { path: p }),

  status:    (id) => j(`/api/repos/${id}/status`),
  branches:  (id) => j(`/api/repos/${id}/branches`),
  log:       (id, { limit = 500, remote = true } = {}) =>
    j(`/api/repos/${id}/log?limit=${limit}&remote=${remote}`),
  commit:    (id, sha) => j(`/api/repos/${id}/commit/${sha}`),
  diff:      (id, file, sha) =>
    j(`/api/repos/${id}/diff?file=${encodeURIComponent(file)}${sha ? `&sha=${sha}` : ''}`),
};
