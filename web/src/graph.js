// Compute a simple lane layout for a list of commits ordered newest-first.
// Each row gets: { col, lanesBefore, lanesAfter, parents, isStash } where
// lanes are arrays of expected parent SHAs per column (null = empty slot).
// `parents` is filtered to only the parents that are visible in the input
// list, so the renderer never tries to draw a connection that has no endpoint.
//
// Stash commits get special placement: they avoid column 0 (the main lane),
// and their first parent is dropped into the leftmost empty slot rather than
// inheriting the stash's column. This keeps the main branch line straight and
// makes stashes look like side branches that loop back into master.
export function computeGraph(commits) {
  const allHashes = new Set(commits.map(c => c.hash));
  const rows = [];
  let lanes = [];

  for (const commit of commits) {
    const stash = isStash(commit);
    const lanesBefore = lanes.slice();

    let col = -1;
    for (let i = 0; i < lanesBefore.length; i++) {
      if (lanesBefore[i] === commit.hash) { col = i; break; }
    }
    if (col === -1) {
      const startCol = stash ? 1 : 0;
      for (let i = startCol; i < lanes.length; i++) {
        if (lanes[i] == null) { col = i; break; }
      }
      if (col === -1) {
        col = Math.max(lanes.length, startCol);
        while (lanes.length <= col) lanes.push(null);
      }
    }

    // Converging lanes (other slots also waiting for this commit) terminate.
    for (let i = 0; i < lanes.length; i++) {
      if (i !== col && lanes[i] === commit.hash) lanes[i] = null;
    }

    const firstParent = commit.parents[0];
    const firstParentVisible = firstParent && allHashes.has(firstParent);

    if (stash) {
      // Stash's lane ends here — its parent should go to the main side.
      lanes[col] = null;
      if (firstParentVisible && lanes.indexOf(firstParent) === -1) {
        const empty = lanes.findIndex(x => x == null);
        if (empty !== -1) lanes[empty] = firstParent;
        else lanes.push(firstParent);
      }
    } else {
      lanes[col] = firstParentVisible ? firstParent : null;
    }

    // Extra parents (merges): place in empty slots, preferring rightward.
    for (let p = 1; p < commit.parents.length; p++) {
      const parent = commit.parents[p];
      if (!allHashes.has(parent)) continue;
      if (lanes.indexOf(parent) !== -1) continue;
      let empty = -1;
      for (let i = col + 1; i < lanes.length; i++) {
        if (lanes[i] == null) { empty = i; break; }
      }
      if (empty === -1) empty = lanes.findIndex(x => x == null);
      if (empty !== -1) lanes[empty] = parent;
      else lanes.push(parent);
    }

    while (lanes.length && lanes[lanes.length - 1] == null) lanes.pop();

    rows.push({
      col,
      lanesBefore,
      lanesAfter: lanes.slice(),
      parents: commit.parents.filter(p => allHashes.has(p)),
      isStash: stash,
    });
  }

  return rows;
}

function isStash(commit) {
  return !!commit.refs && commit.refs.some(r => r.kind === 'stash');
}

const LANE_COLORS = [
  '#6cb6ff', '#f0b429', '#8ad873', '#e48ae0',
  '#ff7b72', '#7ee0b0', '#f0883e', '#d2a8ff',
];

export const STASH_COLOR = '#e48ae0';
export const UNCOMMITTED_COLOR = '#b89500';

export function laneColor(col) {
  return LANE_COLORS[col % LANE_COLORS.length];
}
