import { useLayoutEffect, useState } from 'react';
import { GRAPH_LANE_WIDTH, graphNodeRadius, laneColor, colorForLane } from '../graph.js';

const LANE_W = GRAPH_LANE_WIDTH;
const H = 22;
const VPAD = 6;
const ROW_HEIGHT = 29;
const NODE_LINE_OVERLAP = 0.75;

export default function GraphOverlay({ rows, maxLanes, containerRef }) {
  const metrics = useGraphRowMetrics(containerRef, rows.length);
  if (!rows.length) return null;

  const rowByHash = new Map();
  rows.forEach((row, index) => {
    if (row.commitHash) rowByHash.set(row.commitHash, { row, index });
  });

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
        elements.push(curveOrLine(`tb-${rowIndex}-${laneCol}`, x, topY, end.x, end.y, color, dashed));
        return;
      }

      elements.push(curveOrLine(`pt-${rowIndex}-${laneCol}`, x, topY, x, bottomY, color, dashed));
    });

    parents.forEach((parentSha, idx) => {
      const parentCol = pickParentCol(lanesAfter, parentSha, col);
      if (parentCol === -1) return;

      const px = xForCol(parentCol);
      const parentRow = rowByHash.get(parentSha);
      const drawToParentNode = parentRow && parentCol !== col;
      let color, dashed;
      if (parentCol === col) {
        const target = lanesAfter[parentCol];
        color = colorForLane(target, parentCol);
        dashed = target?.type === 'uncommitted';
      } else {
        const source = lanesBefore[col];
        color = source ? colorForLane(source, col) : laneColor(col);
        dashed = source?.type === 'uncommitted';
      }

      let targetX = drawToParentNode ? xForCol(parentRow.row.col) : px;
      let targetY = drawToParentNode
        ? rowCenterY(metrics, parentRow.index)
        : bottomY;
      const start = pointNearNode(targetX, targetY, cx, cy, graphNodeRadius(row));
      if (drawToParentNode) {
        const target = pointNearNode(start.x, start.y, targetX, targetY, graphNodeRadius(parentRow.row));
        targetX = target.x;
        targetY = target.y;
      }
      elements.push(curveOrLine(`pc-${rowIndex}-${idx}`, start.x, start.y, targetX, targetY, color, dashed));
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
  if (rowIndex >= rowCount - 1) return cy + H / 2 + VPAD;
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

function curveOrLine(key, x1, y1, x2, y2, color, dashed) {
  const strokeProps = {
    stroke: color,
    strokeWidth: 2,
    strokeDasharray: dashed ? '3 2' : undefined,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
  };

  if (x1 === x2) {
    return <line key={key} x1={x1} y1={y1} x2={x2} y2={y2} {...strokeProps} />;
  }

  const d = roundedLanePath(x1, y1, x2, y2);

  return <path key={key} d={d} fill="none" {...strokeProps} />;
}

function roundedLanePath(x1, y1, x2, y2) {
  const direction = y2 >= y1 ? 1 : -1;
  const dy = Math.abs(y2 - y1);
  const dx = Math.abs(x2 - x1);
  const radius = Math.min(Math.max(dx * 0.55, 5), Math.max(dy * 0.45, 5), 12);
  const bendY = y2 - direction * radius;
  const handleX = x1 + (x2 - x1) * 0.72;

  return [
    `M ${x1} ${y1}`,
    `L ${x1} ${bendY}`,
    `C ${x1} ${y2 - direction * radius * 0.35} ${handleX} ${y2} ${x2} ${y2}`,
  ].join(' ');
}
