// Compute a simple lane layout for a list of commits ordered newest-first.
// Each row gets: { col, lanesBefore, lanesAfter } where lanes are arrays of
// expected parent SHAs per column (null = empty slot).
export function computeGraph(commits) {
  const rows = [];
  let lanes = [];

  for (const commit of commits) {
    let col = lanes.indexOf(commit.hash);
    if (col === -1) {
      col = lanes.findIndex(x => x == null);
      if (col === -1) {
        col = lanes.length;
        lanes.push(null);
      }
    }

    const lanesBefore = lanes.slice();

    // Replace this column with the first parent
    lanes[col] = commit.parents[0] || null;

    // Place additional parents in empty lanes (or append)
    for (let p = 1; p < commit.parents.length; p++) {
      const parent = commit.parents[p];
      if (lanes.indexOf(parent) !== -1) continue;
      const empty = lanes.findIndex(x => x == null);
      if (empty !== -1) lanes[empty] = parent;
      else lanes.push(parent);
    }

    // Trim trailing nulls for cleaner rendering
    while (lanes.length && lanes[lanes.length - 1] == null) lanes.pop();

    rows.push({
      col,
      lanesBefore,
      lanesAfter: lanes.slice(),
      parents: commit.parents,
    });
  }

  return rows;
}

const LANE_COLORS = [
  '#6cb6ff', '#f0b429', '#8ad873', '#e48ae0',
  '#ff7b72', '#7ee0b0', '#f0883e', '#d2a8ff',
];

export function laneColor(col) {
  return LANE_COLORS[col % LANE_COLORS.length];
}
