// Compute a lane layout for a list of commits ordered newest-first.
// Each lane is `{ sha, type }` (or null for an empty slot), where `type` is one
// of:
//   - 'regular'     : ordinary branch lane
//   - 'uncommitted' : the lane spawned by the synthetic Uncommitted Changes
//                     row; persists down to the HEAD commit, then resets to
//                     'regular' so the master line below HEAD reads as normal
//   - 'stash'       : the (very short-lived) lane held by a stash commit; we
//                     reuse STASH_COLOR for its branch curves directly, so
//                     this label is mostly informational
//
// Each row gets `{ col, lanesBefore, lanesAfter, parents, isStash, isUncommitted }`.
// `parents` is filtered to only the parents that are visible in the input list,
// so the renderer never tries to draw a connection that has no endpoint.
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
    const lanesBefore = lanes.map(l => l ? { ...l } : null);

    let col = -1;
    for (let i = 0; i < lanesBefore.length; i++) {
      if (lanesBefore[i]?.sha === commit.hash) { col = i; break; }
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

    // Type that gets propagated to the firstParent lane:
    //   - inherit existing lane's type, but
    //   - 'uncommitted' terminates HERE (this commit IS the uncommitted lane's
    //     target), so the propagated lane below resets to 'regular'.
    const inheritedType = lanesBefore[col]?.type || 'regular';
    const propagatedType = inheritedType === 'uncommitted' ? 'regular' : inheritedType;

    // Converging lanes (other slots also waiting for this commit) terminate.
    for (let i = 0; i < lanes.length; i++) {
      if (i !== col && lanes[i]?.sha === commit.hash) lanes[i] = null;
    }

    const firstParent = commit.parents[0];
    const firstParentVisible = firstParent && allHashes.has(firstParent);

    if (commit.isUncommitted) {
      lanes[col] = firstParentVisible ? { sha: firstParent, type: 'uncommitted' } : null;
    } else if (stash) {
      // Stash's lane ends here — its parent should go to the main side.
      lanes[col] = null;
      if (firstParentVisible && lanes.findIndex(l => l?.sha === firstParent) === -1) {
        const empty = lanes.findIndex(x => x == null);
        const newLane = { sha: firstParent, type: 'regular' };
        if (empty !== -1) lanes[empty] = newLane;
        else lanes.push(newLane);
      }
    } else {
      // If firstParent is already carried by another lane, terminate THIS
      // lane instead of duplicating the sha. The bottom-half curve will
      // route to the existing lane's col, anchoring the convergence at this
      // commit's dot rather than at a passthrough mid-gutter on the parent's
      // row.
      const dupIdx = firstParentVisible
        ? lanes.findIndex((l, i) => i !== col && l?.sha === firstParent)
        : -1;
      if (dupIdx !== -1) {
        lanes[col] = null;
      } else {
        lanes[col] = firstParentVisible ? { sha: firstParent, type: propagatedType } : null;
      }
    }

    // Extra parents (merges): place in empty slots, preferring rightward.
    for (let p = 1; p < commit.parents.length; p++) {
      const parent = commit.parents[p];
      if (!allHashes.has(parent)) continue;
      if (lanes.findIndex(l => l?.sha === parent) !== -1) continue;
      let empty = -1;
      for (let i = col + 1; i < lanes.length; i++) {
        if (lanes[i] == null) { empty = i; break; }
      }
      if (empty === -1) empty = lanes.findIndex(x => x == null);
      const newLane = { sha: parent, type: 'regular' };
      if (empty !== -1) lanes[empty] = newLane;
      else lanes.push(newLane);
    }

    while (lanes.length && lanes[lanes.length - 1] == null) lanes.pop();

    rows.push({
      col,
      lanesBefore,
      lanesAfter: lanes.map(l => l ? { ...l } : null),
      parents: commit.parents.filter(p => allHashes.has(p)),
      isStash: stash,
      isUncommitted: !!commit.isUncommitted,
    });
  }

  // Annotate parent row deltas so the renderer can extend a merge curve
  // (lane terminates and curves into another lane) all the way down to its
  // parent's dot, instead of stopping at the immediate inter-row gutter.
  const rowIndexByHash = new Map();
  commits.forEach((c, i) => rowIndexByHash.set(c.hash, i));
  rows.forEach((row, i) => {
    row.parentRowDeltas = row.parents.map(p => {
      const pIdx = rowIndexByHash.get(p);
      return pIdx !== undefined ? pIdx - i : 1;
    });
  });

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
// Cursor-style: uncommitted dot + the lane down to HEAD render in a muted
// gray (and dashed in GraphCell) so they read as "not a real branch".
export const UNCOMMITTED_COLOR = '#8a8a8a';

export function laneColor(col) {
  return LANE_COLORS[col % LANE_COLORS.length];
}

export function colorForLane(lane, col) {
  if (lane?.type === 'uncommitted') return UNCOMMITTED_COLOR;
  return laneColor(col);
}
