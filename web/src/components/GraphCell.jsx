import { laneColor } from '../graph.js';

const LANE_W = 14;
const H = 22;
const DOT_R = 4;

export default function GraphCell({ row, commit, maxLanes }) {
  const { col, lanesBefore, lanesAfter, parents } = row;
  const width = Math.max(maxLanes, lanesAfter.length, lanesBefore.length, col + 1) * LANE_W + 4;
  const cx = col * LANE_W + LANE_W / 2;
  const cy = H / 2;

  const lines = [];

  // Top half: each non-null lane in lanesBefore goes straight down to midpoint
  lanesBefore.forEach((sha, i) => {
    if (sha == null) return;
    const x = i * LANE_W + LANE_W / 2;
    if (sha === commit.hash) {
      // This is the lane that arrives at the dot — straight line
      lines.push(<line key={`tb-${i}`} x1={x} y1={0} x2={cx} y2={cy} stroke={laneColor(i)} strokeWidth="1.5" />);
    } else {
      // A lane passing through this row
      lines.push(<line key={`tp-${i}`} x1={x} y1={0} x2={x} y2={H} stroke={laneColor(i)} strokeWidth="1.5" />);
    }
  });

  // Bottom half: connect commit to each parent's lane in lanesAfter
  parents.forEach(parentSha => {
    const pCol = lanesAfter.indexOf(parentSha);
    if (pCol === -1) return;
    const px = pCol * LANE_W + LANE_W / 2;
    lines.push(<line key={`pc-${parentSha}`} x1={cx} y1={cy} x2={px} y2={H} stroke={laneColor(pCol)} strokeWidth="1.5" />);
  });

  // Also draw any lanes in lanesAfter that did NOT originate from this commit
  // (they continue straight down from the top)
  lanesAfter.forEach((sha, i) => {
    if (sha == null) return;
    if (parents.includes(sha) && lanesAfter.indexOf(sha) === i) return; // already drawn
    // If lane existed before at same position and still same, it's a passthrough (handled above top-half passthrough covers mid->bottom)
    if (lanesBefore[i] === sha) {
      lines.push(<line key={`bp-${i}`} x1={i * LANE_W + LANE_W / 2} y1={cy} x2={i * LANE_W + LANE_W / 2} y2={H} stroke={laneColor(i)} strokeWidth="1.5" />);
    }
  });

  return (
    <svg width={width} height={H} style={{ overflow: 'visible' }}>
      {lines}
      <circle
        cx={cx}
        cy={cy}
        r={DOT_R}
        fill={commit.isHead ? '#ffffff' : laneColor(col)}
        stroke={laneColor(col)}
        strokeWidth="2"
      />
    </svg>
  );
}
