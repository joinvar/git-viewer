import { laneColor, STASH_COLOR, UNCOMMITTED_COLOR } from '../graph.js';

const LANE_W = 14;
const H = 22;
const DOT_R = 4;
// Each .log-row has ~4px top/bottom padding plus a 1px border-bottom, so
// consecutive SVGs are visually ~9px apart. We let connecting lines spill
// past the SVG box (overflow:visible) by VPAD on each side so they bridge
// that gap and read as one continuous line.
const VPAD = 6;

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
  // - otherwise → passes through; render as a single curve to its position
  //   in lanesAfter (handles same-column passthroughs and shifts equally)
  lanesBefore.forEach((sha, i) => {
    if (sha == null) return;
    const x = i * LANE_W + LANE_W / 2;
    if (sha === commit.hash) {
      const color = isStash ? STASH_COLOR : laneColor(i);
      elements.push(curveOrLine(`tb-${i}`, x, -VPAD, cx, cy, color));
      return;
    }
    const newCol = lanesAfter.indexOf(sha);
    if (newCol === -1) return;
    const nx = newCol * LANE_W + LANE_W / 2;
    elements.push(curveOrLine(`pt-${i}`, x, -VPAD, nx, H + VPAD, laneColor(newCol)));
  });

  // Bottom half: from the dot to each visible parent's column.
  // For stash commits, paint these connections pink so the loop-back to the
  // base commit reads as a stash branch.
  parents.forEach((parentSha, idx) => {
    const pCol = lanesAfter.indexOf(parentSha);
    if (pCol === -1) return;
    const px = pCol * LANE_W + LANE_W / 2;
    const color = isStash ? STASH_COLOR : laneColor(pCol);
    elements.push(curveOrLine(`pc-${idx}`, cx, cy, px, H + VPAD, color));
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

function curveOrLine(key, x1, y1, x2, y2, color) {
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
    />
  );
}
