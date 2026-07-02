'use client';

// Decorative animation only — echoes MindMap.tsx's depth-shaded nodes and thin
// gray branch strokes, but is a fresh, static-data SVG (no pan/zoom/session state).
const EDGES = [
  { d: 'M84 180 C 150 180, 160 76, 226 70', delay: 0.15 },
  { d: 'M84 180 C 150 180, 160 180, 226 180', delay: 0.35 },
  { d: 'M84 180 C 150 180, 160 284, 226 290', delay: 0.55 },
  { d: 'M258 178 C 320 150, 340 128, 396 120', delay: 0.95 },
  { d: 'M258 182 C 320 210, 340 232, 396 240', delay: 1.15 },
];

const NODES = [
  { cx: 60, cy: 180, r: 22, depth: 0, delay: 0 },
  { cx: 242, cy: 70, r: 15, depth: 1, delay: 0.55 },
  { cx: 242, cy: 180, r: 15, depth: 1, delay: 0.75 },
  { cx: 242, cy: 290, r: 15, depth: 1, delay: 0.95 },
  { cx: 412, cy: 120, r: 11, depth: 2, delay: 1.35 },
  { cx: 412, cy: 240, r: 11, depth: 2, delay: 1.55 },
];

export function HeroMindMapSVG() {
  return (
    <svg
      className="wp-hero-svg"
      viewBox="0 0 480 360"
      role="img"
      aria-label="Animated diagram of a research question branching into a mind map"
    >
      {EDGES.map((e, i) => (
        <path
          key={i}
          d={e.d}
          className="wp-hero-edge"
          style={{ animationDelay: `${e.delay}s` }}
        />
      ))}
      {NODES.map((n, i) => (
        <circle
          key={i}
          cx={n.cx}
          cy={n.cy}
          r={n.r}
          data-depth={n.depth}
          className="wp-hero-node"
          style={{ animationDelay: `${n.delay}s` }}
        />
      ))}
    </svg>
  );
}
