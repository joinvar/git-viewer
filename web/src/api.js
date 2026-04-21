async function j(url) {
  const r = await fetch(url);
  if (!r.ok) {
    const body = await r.text();
    throw new Error(`${r.status} ${r.statusText}: ${body}`);
  }
  return r.json();
}

export const api = {
  listRepos: () => j('/api/repos'),
  status:    (id) => j(`/api/repos/${id}/status`),
  branches:  (id) => j(`/api/repos/${id}/branches`),
  log:       (id, { limit = 500, remote = true } = {}) =>
    j(`/api/repos/${id}/log?limit=${limit}&remote=${remote}`),
  commit:    (id, sha) => j(`/api/repos/${id}/commit/${sha}`),
  diff:      (id, file, sha) =>
    j(`/api/repos/${id}/diff?file=${encodeURIComponent(file)}${sha ? `&sha=${sha}` : ''}`),
};
