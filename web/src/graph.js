// Compute a lane layout for a list of commits ordered newest-first.
// Each lane is `{ sha, type, directFrom? }` (or null for an empty slot), where
// `type` is one of:
//   - 'regular'     : ordinary branch lane
//   - 'uncommitted' : the lane spawned by the synthetic Uncommitted Changes
//                     row; persists down to the HEAD commit, then resets to
//                     'regular' so the master line below HEAD reads as normal
//   - 'stash'       : a route from a stash node to its first parent.
//
// Each row gets `{ col, lanesBefore, lanesAfter, parents, isStash, isUncommitted }`.
// `parents` is filtered to only the parents that are visible in the input list,
// so the renderer never tries to draw a connection that has no endpoint.
//
// `directFrom` marks a route that was kept even though another lane already
// carries the same parent. Keeping it lets every child draw its own visible
// line into the shared parent node instead of collapsing several children into
// one line.
//
// Trunk awareness: `head` (the current HEAD sha) is used to identify the
// "trunk" — HEAD plus its first-parent ancestors. Trunk commits (and the
// uncommitted virtual commit) anchor at col 0, and col 0 is pre-filled so the
// trunk line is continuous from the first row even when newer commits from
// side branches sit above HEAD by date. Side branches get pushed to col 1+.
export const GRAPH_LANE_WIDTH = 18;
export const GRAPH_DOT_RADIUS = 3.5;
export const GRAPH_FILLED_DOT_RADIUS = 3;

export function computeGraph(commits, head) {
  const allHashes = new Set(commits.map(c => c.hash));

  // Trunk = HEAD + its first-parent ancestors that are visible.
  const trunkSet = new Set();
  if (head && allHashes.has(head)) {
    const byHash = new Map(commits.map(c => [c.hash, c]));
    let cur = head;
    while (cur && allHashes.has(cur) && !trunkSet.has(cur)) {
      trunkSet.add(cur);
      cur = byHash.get(cur)?.parents[0];
    }
  }

  // While trunk commits are still ahead in the list, non-trunk commits avoid
  // col 0 (reserved for trunk). After the last trunk commit, col 0 frees up
  // for whatever comes next.
  let lastTrunkRow = -1;
  for (let i = 0; i < commits.length; i++) {
    if (trunkSet.has(commits[i].hash)) lastTrunkRow = i;
  }

  const rows = [];
  let lanes = [];

  // Pre-fill col 0 with the trunk's lane so the master line is continuous
  // from row 0 even before the first trunk commit shows up by date order.
  // Skip when the topmost row is the uncommitted virtual — it'll set up its
  // own col 0 lane (uncommitted type, dashed), and pre-filling would leave
  // a phantom solid line above the uncommitted dot for "nothing".
  const hasUncommittedAtRow0 = commits.length > 0 && commits[0].isUncommitted;
  if (head && allHashes.has(head) && !hasUncommittedAtRow0) {
    lanes.push({ sha: head, type: 'regular' });
  }

  for (let rowIdx = 0; rowIdx < commits.length; rowIdx++) {
    const commit = commits[rowIdx];
    const stash = isStash(commit);
    const isUncommitted = !!commit.isUncommitted;
    const isTrunk = trunkSet.has(commit.hash);
    // Trunk commits and the uncommitted virtual both anchor at col 0; that
    // way the user always sees master in the leftmost lane.
    const wantsCol0 = isTrunk || isUncommitted;
    const trunkComing = rowIdx <= lastTrunkRow;
    const lanesBefore = lanes.map(l => l ? { ...l } : null);

    let col = pickCommitLane(lanesBefore, commit.hash, wantsCol0);
    if (col === -1) {
      // Reserve col 0 for trunk while trunk is still pending below.
      const startCol = wantsCol0 ? 0 : (trunkComing ? 1 : 0);
      const effectiveStart = stash ? Math.max(startCol, 1) : startCol;
      for (let i = effectiveStart; i < lanes.length; i++) {
        if (lanes[i] == null) { col = i; break; }
      }
      if (col === -1) {
        col = Math.max(lanes.length, effectiveStart);
        while (lanes.length <= col) lanes.push(null);
      }
    }

    // Type that gets propagated to the firstParent lane:
    //   - inherit existing lane's type, but
    //   - 'uncommitted' and 'stash' both terminate HERE (this commit IS the
    //     lane's target), so the propagated lane below resets to 'regular'.
    const inheritedType = lanesBefore[col]?.type || 'regular';
    const propagatedType = (inheritedType === 'uncommitted' || inheritedType === 'stash')
      ? 'regular'
      : inheritedType;

    // Converging lanes (other slots also waiting for this commit) terminate.
    for (let i = 0; i < lanes.length; i++) {
      if (i !== col && lanes[i]?.sha === commit.hash) lanes[i] = null;
    }

    const firstParent = commit.parents[0];
    const firstParentVisible = firstParent && allHashes.has(firstParent);

    if (commit.isUncommitted) {
      lanes[col] = firstParentVisible ? { sha: firstParent, type: 'uncommitted' } : null;
    } else if (stash) {
      lanes[col] = firstParentVisible
        ? { sha: firstParent, type: 'stash', directFrom: commit.hash }
        : null;
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
        lanes[col] = { sha: firstParent, type: propagatedType, directFrom: commit.hash };
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

  return rows;
}

function isStash(commit) {
  return !!commit.refs && commit.refs.some(r => r.kind === 'stash');
}

function pickCommitLane(lanesBefore, hash, wantsCol0) {
  // Trunk and uncommitted always claim col 0. The pre-fill places the trunk
  // lane there in advance, so for trunk commits this is just confirming
  // "yes, I'm the commit that lane is waiting for". For uncommitted, col 0
  // already holds a regular trunk lane (sha=HEAD); we overwrite it with the
  // 'uncommitted' type so the section above HEAD renders dashed.
  if (wantsCol0) return 0;

  let bestCol = -1;
  let bestRank = -1;
  for (let i = 0; i < lanesBefore.length; i++) {
    const lane = lanesBefore[i];
    if (lane?.sha !== hash) continue;
    const rank = laneRank(lane);
    if (rank > bestRank) {
      bestRank = rank;
      bestCol = i;
    }
  }
  return bestCol;
}

function laneRank(lane) {
  if (lane?.type === 'uncommitted') return 4;
  if (lane?.type === 'regular' && !lane.directFrom) return 3;
  if (lane?.type === 'regular') return 2;
  if (lane?.type === 'stash') return 1;
  return 0;
}

// Branch colors by column position. Stash tails intentionally use their column
// color too, matching Git graph extensions where every visible lane is distinct.
const LANE_COLORS = [
  '#2ea8ff', '#ff2aa1', '#22e64f', '#f2a000',
  '#16d6d9', '#ff5c57', '#b47cff', '#ffd93d',
];

// Cursor-style: uncommitted dot + the lane down to HEAD render in a muted
// gray (and dashed in the renderer) so they read as "not a real branch".
export const UNCOMMITTED_COLOR = '#8a8a8a';

export function laneColor(col) {
  return LANE_COLORS[col % LANE_COLORS.length];
}

export function colorForLane(lane, col) {
  if (lane?.type === 'uncommitted') return UNCOMMITTED_COLOR;
  return laneColor(col);
}

export function graphNodeRadius(row) {
  return row?.isStash || row?.isUncommitted
    ? GRAPH_FILLED_DOT_RADIUS
    : GRAPH_DOT_RADIUS;
}
