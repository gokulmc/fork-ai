'use client';
import { useInView } from './useInView';

// Beat: zoom out — what Alex's session looks like after two branches.
// Decorative SVG only, matching MindMap.tsx's depth-shaded node convention
// without reusing that component (which is coupled to live pan/zoom state).
const EDGES = [
  { d: 'M70 150 C 140 150, 150 76, 224 70', delay: 0.1 },
  { d: 'M70 150 C 140 150, 150 224, 224 230', delay: 0.3 },
  { d: 'M70 150 C 140 150, 150 150, 224 150', delay: 0.5 },
];

const NODES = [
  { cx: 46, cy: 150, r: 22, depth: 0, delay: 0, label: 'Root question', lx: 46, ly: 186 },
  { cx: 250, cy: 70, r: 15, depth: 1, delay: 0.45, label: 'Moderating factors', lx: 250, ly: 42 },
  { cx: 250, cy: 230, r: 15, depth: 1, delay: 0.65, label: 'Ask AI · highlighted sentence', lx: 250, ly: 260 },
  { cx: 250, cy: 150, r: 10, depth: 1, delay: 0.85, label: '+ more as she explores', lx: 250, ly: 178, faint: true },
];

export function MindMapDemo() {
  const { ref, inView } = useInView<HTMLDivElement>();

  return (
    <section className="wp-section">
      <div ref={ref} className={`wp-reveal ${inView ? 'wp-in-view' : ''}`}>
        <div className="wp-kicker">Zoom out</div>
        <h2 className="wp-h2">Every branch becomes a node</h2>
        <div className={`wp-map-demo ${inView ? 'wp-in-view' : ''}`}>
          <svg viewBox="0 0 340 280" role="img" aria-label="Mind map of Alex's research session with two branches">
            {EDGES.map((e, i) => (
              <path key={i} d={e.d} className="wp-map-edge" style={{ animationDelay: `${e.delay}s` }} />
            ))}
            {NODES.map((n, i) => (
              <g key={i}>
                <circle
                  cx={n.cx}
                  cy={n.cy}
                  r={n.r}
                  data-depth={n.depth}
                  className={`wp-map-node ${n.faint ? 'wp-map-node-faint' : ''}`}
                  style={{ animationDelay: `${n.delay}s` }}
                />
                <text
                  x={n.lx}
                  y={n.ly}
                  className={`wp-map-label ${n.faint ? 'wp-map-label-faint' : ''}`}
                  style={{ animationDelay: `${n.delay}s` }}
                  textAnchor="middle"
                >
                  {n.label}
                </text>
              </g>
            ))}
          </svg>
        </div>
        <p className="wp-compare-note">
          Two clean branches already, each traceable back to the exact question or sentence
          that spawned it. Nothing buried, nothing blended together.
        </p>
      </div>
    </section>
  );
}
