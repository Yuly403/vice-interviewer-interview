import { useMemo } from "react";
import "./RadarChart.css";

export interface RadarChartData {
  dimension: string;
  score: number; // 0-100
}

interface RadarChartProps {
  data: RadarChartData[];
  size?: number;
}

export function RadarChart({ data, size = 260 }: RadarChartProps) {
  const center = size / 2;
  const padding = 48;
  const radius = center - padding;
  const levels = 4;

  const angleStep = useMemo(
    () => (2 * Math.PI) / Math.max(data.length, 1),
    [data.length],
  );

  const axisEndpoints = useMemo(
    () =>
      data.map((_, i) => {
        const a = angleStep * i - Math.PI / 2;
        return {
          x: center + radius * Math.cos(a),
          y: center + radius * Math.sin(a),
          angle: a,
        };
      }),
    [data, angleStep, center, radius],
  );

  const scorePoints = useMemo(
    () =>
      data.map((d, i) => {
        const a = angleStep * i - Math.PI / 2;
        const r = (d.score / 100) * radius;
        return { x: center + r * Math.cos(a), y: center + r * Math.sin(a) };
      }),
    [data, angleStep, center, radius],
  );

  // Ring radii
  const rings = useMemo(
    () => Array.from({ length: levels }, (_, i) => ((i + 1) / levels) * radius),
    [levels, radius],
  );

  if (data.length < 3) {
    return (
      <div className="radar-empty">
        需要至少 3 个维度才能绘制雷达图
      </div>
    );
  }

  const polygonPath = scorePoints.map((p) => `${p.x},${p.y}`).join(" ");

  return (
    <div className="radar-chart-wrapper">
      <svg
        viewBox={`0 0 ${size} ${size}`}
        className="radar-chart"
        role="img"
        aria-label="面试维度雷达图"
      >
        {/* Grid rings */}
        {rings.map((r, i) => (
          <circle
            key={`ring-${i}`}
            cx={center}
            cy={center}
            r={r}
            fill="none"
            stroke="var(--color-gray-200)"
            strokeWidth="1"
          />
        ))}

        {/* Axis lines */}
        {axisEndpoints.map((p, i) => (
          <line
            key={`axis-${i}`}
            x1={center}
            y1={center}
            x2={p.x}
            y2={p.y}
            stroke="var(--color-gray-300)"
            strokeWidth="1"
            strokeDasharray="3 2"
          />
        ))}

        {/* Score polygon */}
        <polygon
          points={polygonPath}
          fill="var(--color-primary-400)"
          fillOpacity="0.18"
          stroke="var(--color-primary-500)"
          strokeWidth="2"
        />

        {/* Score dots */}
        {scorePoints.map((p, i) => (
          <circle
            key={`dot-${i}`}
            cx={p.x}
            cy={p.y}
            r="4"
            fill="var(--color-primary-600)"
            stroke="#fff"
            strokeWidth="1.5"
          />
        ))}

        {/* Dimension labels */}
        {data.map((d, i) => {
          const ep = axisEndpoints[i];
          const labelR = radius + 22;
          const lx = center + labelR * Math.cos(ep.angle);
          const ly = center + labelR * Math.sin(ep.angle);
          const anchor =
            Math.abs(lx - center) < 12 ? "middle" : lx > center ? "start" : "end";
          return (
            <text
              key={`label-${i}`}
              x={lx}
              y={ly}
              textAnchor={anchor}
              dominantBaseline="middle"
              className="radar-axis-label"
            >
              {d.dimension}
            </text>
          );
        })}
      </svg>

      {/* Legend */}
      <div className="radar-legend">
        {data.map((d, i) => (
          <div key={i} className="radar-legend-item">
            <span className="radar-legend-dot" />
            <span className="radar-legend-dim">{d.dimension}</span>
            <span className="radar-legend-score">{d.score}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Derive radar-chart data from review conclusions.
 * Score = normalized evidence count (0-5 refs → 0-100).
 */
export function conclusionsToRadarData(
  conclusions: { dimension: string; evidenceRefs?: unknown[] }[],
): RadarChartData[] {
  return conclusions
    .filter((c) => c.dimension)
    .map((c) => ({
      dimension: c.dimension,
      score: Math.min(100, Math.round(((c.evidenceRefs?.length ?? 0) / 5) * 100)),
    }));
}
