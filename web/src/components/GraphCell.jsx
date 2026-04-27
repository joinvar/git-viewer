import {
  GRAPH_DOT_RADIUS,
  GRAPH_FILLED_DOT_RADIUS,
  GRAPH_LANE_WIDTH,
  laneColor,
  UNCOMMITTED_COLOR,
} from '../graph.js';

const LANE_W = GRAPH_LANE_WIDTH;
const H = 22;
// Cursor-style: hollow circles for ordinary commits, solid filled dots
// for stash entries and the synthetic uncommitted row. Filled dots read
// as "side markers" rather than full commits, matching how Cursor's git
// graph visually distinguishes them.
const DOT_R = GRAPH_DOT_RADIUS;
const FILLED_DOT_R = GRAPH_FILLED_DOT_RADIUS;
const NODE_FILL = 'var(--git-graph-node-fill, var(--bg))';

export default function GraphCell({ row, commit, maxLanes }) {
  const { col, lanesBefore, lanesAfter, isStash } = row;
  const isUncommitted = !!commit.isUncommitted;
  const totalLanes = Math.max(maxLanes, lanesAfter.length, lanesBefore.length, col + 1);
  const width = totalLanes * LANE_W + 4;
  const cx = col * LANE_W + LANE_W / 2;
  const cy = H / 2;
  const dotColor = isUncommitted
    ? UNCOMMITTED_COLOR
    : laneColor(col);
  const filled = isStash || isUncommitted;
  const dotRadius = filled ? FILLED_DOT_R : DOT_R;
  const dotFill = filled ? dotColor : NODE_FILL;
  const dotStrokeWidth = filled ? 0 : 1.6;

  return (
    <svg width={width} height={H} style={{ overflow: 'visible' }}>
      <circle
        cx={cx}
        cy={cy}
        r={dotRadius}
        fill={dotFill}
        stroke={dotColor}
        strokeWidth={dotStrokeWidth}
      />
    </svg>
  );
}
