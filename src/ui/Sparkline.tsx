/**
 * Tiny SVG line chart for in-memory time series. Stretches to its CSS width via
 * viewBox + non-scaling strokes, so callers can size it with plain styles.
 */
export function Sparkline({
  points,
  height = 40,
  color = "var(--blue)",
  style,
}: {
  points: number[];
  height?: number;
  color?: string;
  style?: React.CSSProperties;
}) {
  const W = 240;
  const PAD = 3;
  if (points.length < 2) {
    return <div style={{ height, color: "var(--text-3)", fontSize: "0.8462rem", display: "flex", alignItems: "center", ...style }}>collecting…</div>;
  }
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const stepX = W / (points.length - 1);
  const xy = points.map((v, i) => [i * stepX, height - PAD - ((v - min) / span) * (height - PAD * 2)] as const);
  const line = xy.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const [lastX, lastY] = xy[xy.length - 1];
  return (
    <svg
      viewBox={`0 0 ${W} ${height}`}
      preserveAspectRatio="none"
      style={{ display: "block", width: "100%", height, ...style }}
      aria-hidden
    >
      <polygon points={`0,${height} ${line} ${W},${height}`} fill={color} opacity={0.08} />
      <polyline points={line} fill="none" stroke={color} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
      <circle cx={lastX} cy={lastY} r={2.5} fill={color} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
