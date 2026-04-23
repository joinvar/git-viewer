import { laneColor, STASH_COLOR, UNCOMMITTED_COLOR, colorForLane } from '../graph.js';

const LANE_W = 14;
const H = 22;
const DOT_R = 4;
// Each .log-row has ~4px top/bottom padding plus a 1px border-bottom, so
// consecutive SVGs are visually ~9px apart. We let connecting lines spill
// past the SVG box (overflow:visible) by VPAD on each side so they bridge
// that gap and read as one continuous line.
const VPAD = 6;
// Total .log-row height (4 padding-top + 20 graph + 4 padding-bottom + 1
// border). Used by the renderer to extend a merge curve downward to its
// parent's actual dot when the lane terminates instead of passing through.
const ROW_HEIGHT = 29;

export default function GraphCell({ row, commit, maxLanes }) {
  const { col, lanesBefore, lanesAfter, parents, isStash } = row;
  const isUncommitted = !!commit.isUncommitted;
  const totalLanes = Math.max(maxLanes, lanesAfter.length, lanesBefore.length, col + 1);
  const width = totalLanes * LANE_W + 4;
  const cx = col * LANE_W + LANE_W / 2;
  const cy = H / 2;
  const dotColor = isUncommitted
    ? UNCOMMITTED_COLOR
    : isStash
    ? STASH_COLOR
    : laneColor(col);

  const elements = [];

  // Top half: every non-null entry in lanesBefore connects downward.
  // - sha === commit.hash → terminates at the commit dot
  // - otherwise → straight passthrough at the same column. (A non-converging
  //   lane never moves: nothing this row mutates can touch it. Using
  //   `lanesAfter.indexOf(sha)` would hop to a wrong column when lanesAfter
  //   contains duplicate shas — e.g. two lanes waiting for the same upcoming
  //   commit — and produced a stray diagonal with no line above it on the
  //   next row.)
  lanesBefore.forEach((lane, i) => {
    if (lane == null) return;
    const x = i * LANE_W + LANE_W / 2;
    const color = colorForLane(lane, i);
    const dashed = lane.type === 'uncommitted';
    if (lane.sha === commit.hash) {
      elements.push(curveOrLine(`tb-${i}`, x, -VPAD, cx, cy, color, dashed));
      return;
    }
    elements.push(curveOrLine(`pt-${i}`, x, -VPAD, x, H + VPAD, color, dashed));
  });

  // Bottom half: from the dot to each visible parent's column. For the parent
  // column, prefer the commit's own column (where firstParent is placed for
  // non-stash); otherwise pick the closest matching column in lanesAfter so
  // the curve doesn't sweep across other lanes.
  // Curve color/style: when this commit's lane terminates and the curve
  // merges into a different lane (pCol !== col), the curve belongs to the
  // ENDING lane visually — so use the source (this commit's) lane color.
  // Otherwise use the destination lane's color so passthroughs stay one
  // color across the row.
  // Curve length: a "lane continues" curve (pCol === col) just needs to
  // bridge to the next row's top via VPAD overlap. A merge curve is drawn
  // all the way down to the parent commit's dot so it visibly anchors on a
  // real node — the SVG has overflow:visible, so the curve spills through
  // any intervening rows.
  const parentRowDeltas = row.parentRowDeltas || [];
  parents.forEach((parentSha, idx) => {
    const pCol = pickParentCol(lanesAfter, parentSha, col);
    if (pCol === -1) return;
    const px = pCol * LANE_W + LANE_W / 2;
    let color, dashed;
    if (isStash) {
      color = STASH_COLOR;
      dashed = false;
    } else if (pCol === col) {
      const target = lanesAfter[pCol];
      color = colorForLane(target, pCol);
      dashed = target?.type === 'uncommitted';
    } else {
      const source = lanesBefore[col];
      color = source ? colorForLane(source, col) : laneColor(col);
      dashed = source?.type === 'uncommitted';
    }
    const rowDelta = parentRowDeltas[idx];
    const py = (pCol === col || !(rowDelta > 0))
      ? H + VPAD
      : cy + rowDelta * ROW_HEIGHT;
    elements.push(curveOrLine(`pc-${idx}`, cx, cy, px, py, color, dashed));
  });

  return (
    <svg width={width} height={H} style={{ overflow: 'visible' }}>
      {elements}
      <circle
        cx={cx}
        cy={cy}
        r={DOT_R}
        fill={isUncommitted ? 'none' : (commit.isHead ? '#ffffff' : dotColor)}
        stroke={dotColor}
        strokeWidth="2"
      />
    </svg>
  );
}

function pickParentCol(lanesAfter, parentSha, col) {
  if (lanesAfter[col]?.sha === parentSha) return col;
  let pCol = -1;
  let bestDist = Infinity;
  for (let i = 0; i < lanesAfter.length; i++) {
    if (lanesAfter[i]?.sha !== parentSha) continue;
    const d = Math.abs(i - col);
    if (d < bestDist) { bestDist = d; pCol = i; }
  }
  return pCol;
}

function curveOrLine(key, x1, y1, x2, y2, color, dashed) {
  const dash = dashed ? '3 2' : undefined;
  if (x1 === x2) {
    return (
      <line
        key={key}
        x1={x1}
        y1={y1}
        x2={x2}
        y2={y2}
        stroke={color}
        strokeWidth="1.5"
        strokeDasharray={dash}
      />
    );
  }
  const my = (y1 + y2) / 2;
  return (
    <path
      key={key}
      d={`M ${x1} ${y1} C ${x1} ${my} ${x2} ${my} ${x2} ${y2}`}
      fill="none"
      stroke={color}
      strokeWidth="1.5"
      strokeDasharray={dash}
    />
  );
}
