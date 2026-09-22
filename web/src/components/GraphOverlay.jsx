import { useLayoutEffect, useState } from 'react';
import { GRAPH_LANE_WIDTH, graphNodeRadius, colorForLane } from '../graph.js';

const LANE_W = GRAPH_LANE_WIDTH;
const H = 22;
const ROW_HEIGHT = 29;
const NODE_LINE_OVERLAP = 0.75;

export default function GraphOverlay({ rows, maxLanes, containerRef }) {
  const metrics = useGraphRowMetrics(containerRef, rows.length);
  if (!rows.length) return null;

  const totalLanes = rows.reduce(
    (max, row) => Math.max(max, row.lanesBefore.length, row.lanesAfter.length, row.col + 1),
    maxLanes,
  );
  const width = totalLanes * LANE_W + 4;
  const height = metrics?.height || rows.length * ROW_HEIGHT;
  const elements = [];

  rows.forEach((row, rowIndex) => {
    const { col, lanesBefore, lanesAfter, parents } = row;
    const cy = rowCenterY(metrics, rowIndex);
    const topY = rowBoundaryTop(metrics, rowIndex, cy);
    const bottomY = rowBoundaryBottom(metrics, rowIndex, cy, rows.length);
    const cx = xForCol(col);

    lanesBefore.forEach((lane, laneCol) => {
      if (lane == null) return;
      const x = xForCol(laneCol);
      const color = colorForLane(lane, laneCol);
      const dashed = lane.type === 'uncommitted';

      if (lane.sha === row.commitHash) {
        const end = pointNearNode(x, topY, cx, cy, graphNodeRadius(row));
        // Arrive: stay on this lane, then bend into the dot at the end.
        pushLine(elements, curveOrLine(`tb-${rowIndex}-${laneCol}`, x, topY, end.x, end.y, color, dashed, 'end'));
        return;
      }

      pushLine(elements, curveOrLine(`pt-${rowIndex}-${laneCol}`, x, topY, x, bottomY, color, dashed));
    });

    parents.forEach((parentSha, idx) => {
      const parentCol = pickParentCol(lanesAfter, parentSha, col);
      if (parentCol === -1) return;

      const px = xForCol(parentCol);
      const target = lanesAfter[parentCol];
      const color = colorForLane(target, parentCol);
      const dashed = target?.type === 'uncommitted';

      // Only as far as this row's bottom edge. The next rows keep the lane
      // going (straight through, or a final bend into the parent dot).
      // Also stroking all the way to that dot draws a second line, which
      // sticks out past the branch node as a loose ray.
      const start = pointNearNode(px, bottomY, cx, cy, graphNodeRadius(row));
      pushLine(elements, curveOrLine(
        `pc-${rowIndex}-${idx}`,
        start.x, start.y, px, bottomY,
        color, dashed,
        'start',
      ));
    });
  });

  return (
    <svg className="log-graph-overlay" width={width} height={height} aria-hidden="true">
      {elements}
    </svg>
  );
}

function xForCol(col) {
  return col * LANE_W + LANE_W / 2;
}

function rowCenterY(metrics, rowIndex) {
  return metrics?.centers.get(rowIndex) ?? (rowIndex * ROW_HEIGHT + 4 + H / 2);
}

function rowBoundaryTop(metrics, rowIndex, cy) {
  // Row 0 has no row above it; clamping topY to cy collapses any "incoming
  // from above" segment so the topmost commit doesn't sprout a phantom stub.
  if (rowIndex <= 0) return cy;
  return (rowCenterY(metrics, rowIndex - 1) + cy) / 2;
}

function rowBoundaryBottom(metrics, rowIndex, cy, rowCount) {
  // The last row has nothing below it. Ending at the dot avoids a tail
  // hanging past the oldest commit.
  if (rowIndex >= rowCount - 1) return cy;
  return (cy + rowCenterY(metrics, rowIndex + 1)) / 2;
}

function useGraphRowMetrics(containerRef, rowCount) {
  const [metrics, setMetrics] = useState(null);

  useLayoutEffect(() => {
    const container = containerRef?.current;
    if (!container) return undefined;

    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const centers = new Map();
        let height = 0;

        container.querySelectorAll('[data-graph-row]').forEach(rowEl => {
          const rowIndex = Number(rowEl.getAttribute('data-graph-row'));
          if (!Number.isFinite(rowIndex)) return;

          const graphEl = rowEl.querySelector('.graph');
          const graphTop = graphEl ? graphEl.offsetTop : rowEl.offsetHeight / 2 - H / 2;
          centers.set(rowIndex, rowEl.offsetTop + graphTop + H / 2);
          height = Math.max(height, rowEl.offsetTop + rowEl.offsetHeight);
        });

        setMetrics(prev => metricsEqual(prev, centers, height) ? prev : { centers, height });
      });
    };

    measure();
    window.addEventListener('resize', measure);

    let observer = null;
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(measure);
      observer.observe(container);
      container.querySelectorAll('[data-graph-row]').forEach(rowEl => observer.observe(rowEl));
    }

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', measure);
      observer?.disconnect();
    };
  }, [containerRef, rowCount]);

  return metrics;
}

function metricsEqual(prev, centers, height) {
  if (!prev || prev.height !== height || prev.centers.size !== centers.size) return false;
  for (const [rowIndex, center] of centers) {
    if (prev.centers.get(rowIndex) !== center) return false;
  }
  return true;
}

function pickParentCol(lanesAfter, parentSha, col) {
  if (lanesAfter[col]?.sha === parentSha) return col;
  let parentCol = -1;
  let bestDist = Infinity;
  for (let i = 0; i < lanesAfter.length; i++) {
    if (lanesAfter[i]?.sha !== parentSha) continue;
    const dist = Math.abs(i - col);
    if (dist < bestDist) {
      bestDist = dist;
      parentCol = i;
    }
  }
  return parentCol;
}

function pointNearNode(fromX, fromY, cx, cy, radius) {
  const dx = fromX - cx;
  const dy = fromY - cy;
  const dist = Math.hypot(dx, dy);
  if (dist === 0) return { x: cx, y: cy };
  const r = Math.max(0, radius - NODE_LINE_OVERLAP);
  return {
    x: cx + (dx / dist) * r,
    y: cy + (dy / dist) * r,
  };
}

function pushLine(elements, el) {
  if (el) elements.push(el);
}

function curveOrLine(key, x1, y1, x2, y2, color, dashed, bend) {
  if (Math.hypot(x2 - x1, y2 - y1) < 0.5) return null;
  const strokeProps = {
    stroke: color,
    strokeWidth: 2,
    strokeDasharray: dashed ? '3 2' : undefined,
    strokeLinecap: 'butt',
    strokeLinejoin: 'round',
  };

  if (Math.abs(x1 - x2) < 0.5) {
    return <line key={key} x1={x1} y1={y1} x2={x2} y2={y2} {...strokeProps} />;
  }

  const d = roundedLanePath(x1, y1, x2, y2, bend);

  return <path key={key} d={d} fill="none" {...strokeProps} />;
}

// `bend` is where the corner sits:
//   'start' — leave the source column immediately, then run straight on the
//             target column. Used when a commit's line steps onto another lane.
//             Bending at the far end instead leaves a straight ray on the
//             source column and a disconnected stub on the target lane.
//   'end'   — run straight, then bend into the dot. Used when a lane arrives
//             at its commit.
function roundedLanePath(x1, y1, x2, y2, bend = 'end') {
  const dir = y2 >= y1 ? 1 : -1;
  const dy = Math.abs(y2 - y1);
  const dx = Math.abs(x2 - x1);
  const radius = Math.min(dx, dy, 10);

  if (bend === 'start') {
    const yBend = y1 + dir * radius;
    const consumed = dir > 0 ? yBend >= y2 - 0.5 : yBend <= y2 + 0.5;
    if (consumed) {
      return `M ${x1} ${y1} C ${x1} ${y1 + dir * dy * 0.55} ${x2} ${y1 + dir * dy * 0.45} ${x2} ${y2}`;
    }
    return [
      `M ${x1} ${y1}`,
      `C ${x1} ${y1 + dir * radius * 0.55} ${x2} ${y1 + dir * radius * 0.45} ${x2} ${yBend}`,
      `L ${x2} ${y2}`,
    ].join(' ');
  }

  const yBend = y2 - dir * radius;
  const consumed = dir > 0 ? yBend <= y1 + 0.5 : yBend >= y1 - 0.5;
  if (consumed) {
    return `M ${x1} ${y1} C ${x1} ${y1 + dir * dy * 0.55} ${x2} ${y2 - dir * dy * 0.45} ${x2} ${y2}`;
  }
  return [
    `M ${x1} ${y1}`,
    `L ${x1} ${yBend}`,
    `C ${x1} ${y2 - dir * radius * 0.45} ${x2} ${y2 - dir * radius * 0.25} ${x2} ${y2}`,
  ].join(' ');
}
