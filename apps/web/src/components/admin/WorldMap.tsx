'use client';

import { useCallback, useRef, useState, useEffect } from 'react';
import { Mercator } from '@visx/geo';
import type { ExtendedFeature } from '@visx/vendor/d3-geo';
import { feature } from 'topojson-client';
import type { Topology, GeometryCollection } from 'topojson-specification';
import { adminApi, type TrialLocation, type TrialLocationsResult } from '@/lib/api';
import { donutArc } from './charts';

const WIDTH = 800;
const HEIGHT = 420;
const MIN_SCALE = 1;
const MAX_SCALE = 16;
// Pixel radius (in un-zoomed map units) within which points merge into one
// cluster. Divided by the current zoom scale, so clusters split apart as you
// zoom in — exactly like a slippy-map marker clusterer.
const BASE_CLUSTER_RADIUS = 26;

interface Zoom { scale: number; x: number; y: number }
interface BasePoint { loc: TrialLocation; x: number; y: number }
interface ClusterGroup { x: number; y: number; points: BasePoint[] }

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

// Greedy single-link clustering by on-screen pixel distance. Fine for the
// dozens–hundreds of points an admin map like this deals with.
function clusterPoints(points: BasePoint[], radius: number): ClusterGroup[] {
  const used = new Array(points.length).fill(false);
  const groups: ClusterGroup[] = [];
  for (let i = 0; i < points.length; i++) {
    if (used[i]) continue;
    used[i] = true;
    const members = [points[i]];
    for (let j = i + 1; j < points.length; j++) {
      if (used[j]) continue;
      const dx = points[i].x - points[j].x;
      const dy = points[i].y - points[j].y;
      if (Math.sqrt(dx * dx + dy * dy) <= radius) {
        used[j] = true;
        members.push(points[j]);
      }
    }
    const x = members.reduce((a, p) => a + p.x, 0) / members.length;
    const y = members.reduce((a, p) => a + p.y, 0) / members.length;
    groups.push({ x, y, points: members });
  }
  return groups;
}

export function WorldMap({ idToken }: { idToken: string }) {
  const [world, setWorld] = useState<GeoJSON.Feature[] | null>(null);
  const [data, setData] = useState<TrialLocationsResult | null>(null);
  const [err, setErr] = useState('');
  const [zoom, setZoom] = useState<Zoom>({ scale: 1, x: 0, y: 0 });
  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);
  // True while a drag gesture moved the map — guards the click that fires right
  // after pointerup so a pan ending over a dot doesn't also trigger zoom-to-point.
  const draggedRef = useRef(false);

  useEffect(() => {
    fetch('/world-atlas-110m.json')
      .then((r) => r.json())
      .then((topology: Topology) => {
        const collection = feature(topology, topology.objects.countries as GeometryCollection);
        setWorld(collection.features);
      })
      .catch(() => setErr('Could not load world map data'));
  }, []);

  useEffect(() => {
    adminApi.getTrialLocations(idToken).then(setData).catch((e) => setErr(String(e)));
  }, [idToken]);

  const clientToSvg = useCallback((clientX: number, clientY: number): { x: number; y: number } => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const pt = svg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const ctm = svg.getScreenCTM();
    if (!ctm) return { x: 0, y: 0 };
    const svgP = pt.matrixTransform(ctm.inverse());
    return { x: svgP.x, y: svgP.y };
  }, []);

  const zoomAroundSvgPoint = (mx: number, my: number, factor: number) => {
    setZoom((z) => {
      const newScale = clamp(z.scale * factor, MIN_SCALE, MAX_SCALE);
      const worldX = (mx - z.x) / z.scale;
      const worldY = (my - z.y) / z.scale;
      return { scale: newScale, x: mx - worldX * newScale, y: my - worldY * newScale };
    });
  };

  const zoomToPoint = (px: number, py: number, factor = 2.2) => {
    setZoom((z) => {
      const newScale = clamp(z.scale * factor, MIN_SCALE, MAX_SCALE);
      return { scale: newScale, x: WIDTH / 2 - px * newScale, y: HEIGHT / 2 - py * newScale };
    });
  };

  const onWheel = (e: React.WheelEvent<SVGSVGElement>) => {
    e.preventDefault();
    const { x: mx, y: my } = clientToSvg(e.clientX, e.clientY);
    zoomAroundSvgPoint(mx, my, e.deltaY < 0 ? 1.2 : 1 / 1.2);
  };

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    (e.target as Element).setPointerCapture(e.pointerId);
    draggedRef.current = false;
    dragRef.current = { startX: e.clientX, startY: e.clientY, origX: zoom.x, origY: zoom.y };
  };

  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const d = dragRef.current;
    if (!d) return;
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const scaleFactor = WIDTH / rect.width;
    const dx = (e.clientX - d.startX) * scaleFactor;
    const dy = (e.clientY - d.startY) * scaleFactor;
    if (Math.abs(dx) > 2 || Math.abs(dy) > 2) draggedRef.current = true;
    setZoom((z) => ({ ...z, x: d.origX + dx, y: d.origY + dy }));
  };

  const onPointerUp = () => {
    dragRef.current = null;
    // Defer clearing so the click event firing right after pointerup can still
    // see draggedRef=true and bail — click follows pointerup in the same tick.
    if (draggedRef.current) setTimeout(() => { draggedRef.current = false; }, 0);
  };

  const resetZoom = () => setZoom({ scale: 1, x: 0, y: 0 });

  const clickMarker = (x: number, y: number) => {
    if (draggedRef.current) return;
    zoomToPoint(x, y);
  };

  if (err) return <div className="ad-card ad-err">{err}</div>;
  if (!world || !data) return <div className="ad-empty">Loading map…</div>;

  const conversionPct = data.total > 0 ? Math.round((data.converted / data.total) * 100) : 0;
  const cards = [
    { label: 'Trial visits (located)', value: data.total.toLocaleString() },
    { label: 'Converted to account', value: data.converted.toLocaleString() },
    { label: 'Conversion rate', value: `${conversionPct}%` },
  ];

  return (
    <div className="ad-grid-main">
      <style>{WM_STYLE}</style>
      <div className="ad-stats">
        {cards.map((c) => (
          <div key={c.label} className="ad-card ad-stat">
            <div className="ad-stat-label">{c.label}</div>
            <div className="ad-stat-value">{c.value}</div>
          </div>
        ))}
      </div>

      <div className="ad-card">
        <div className="ad-card-head">
          <h3>Trial visitor locations</h3>
          <div className="wm-legend">
            <span><span className="wm-legend-dot wm-legend-dot-converted" />Converted</span>
            <span><span className="wm-legend-dot" />Not converted</span>
          </div>
        </div>
        {data.locations.length === 0 ? (
          <div className="ad-empty">No geolocated trial sessions yet.</div>
        ) : (
          <div className="wm-mapwrap">
            <svg
              ref={svgRef}
              viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
              width="100%"
              height={HEIGHT}
              className="wm-svg"
              onWheel={onWheel}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerLeave={onPointerUp}
            >
              <g transform={`translate(${zoom.x} ${zoom.y}) scale(${zoom.scale})`}>
                <Mercator<GeoJSON.Feature>
                  data={world}
                  // d3-geo's fitSize accepts a FeatureCollection at runtime; @visx/geo's
                  // type only declares a single ExtendedFeature, hence the cast.
                  fitSize={[[WIDTH, HEIGHT], { type: 'FeatureCollection', features: world } as unknown as ExtendedFeature]}
                >
                  {({ features, projection }) => {
                    const basePoints: BasePoint[] = data.locations
                      .map((loc) => {
                        const p = projection([loc.lon, loc.lat]);
                        return p ? { loc, x: p[0], y: p[1] } : null;
                      })
                      .filter((p): p is BasePoint => p !== null);
                    const clusters = clusterPoints(basePoints, BASE_CLUSTER_RADIUS / zoom.scale);

                    return (
                      <>
                        {features.map(({ feature: f, path, index }) => (
                          <path key={index} d={path || ''} className="wm-country" data-name={(f.properties as { name?: string } | undefined)?.name} />
                        ))}
                        {clusters.map((c, i) => {
                          const count = c.points.length;
                          if (count === 1) {
                            const loc = c.points[0].loc;
                            return (
                              <circle
                                key={loc.sessionId}
                                cx={c.x}
                                cy={c.y}
                                r={3.4 / Math.sqrt(zoom.scale)}
                                className={loc.claimed ? 'wm-dot wm-dot-converted' : 'wm-dot'}
                                onClick={() => clickMarker(c.x, c.y)}
                              >
                                <title>
                                  {[loc.city, loc.country].filter(Boolean).join(', ') || 'Unknown location'}
                                  {' — '}
                                  {loc.claimed ? 'converted' : 'not converted'}
                                </title>
                              </circle>
                            );
                          }
                          const converted = c.points.filter((p) => p.loc.claimed).length;
                          const fConverted = converted / count;
                          const rOuter = clamp(8 + Math.sqrt(count) * 3.2, 8, 26) / Math.sqrt(zoom.scale);
                          const rInner = rOuter * 0.55;
                          return (
                            <g
                              key={i}
                              transform={`translate(${c.x} ${c.y})`}
                              className="wm-cluster"
                              onClick={() => clickMarker(c.x, c.y)}
                            >
                              <title>{count} trial visits — {converted} converted</title>
                              {fConverted === 0 || fConverted === 1 ? (
                                <>
                                  <circle r={rOuter} fill={fConverted === 1 ? '#22c55e' : '#f59e0b'} fillOpacity={0.85} />
                                  <circle r={rInner} fill="var(--admin-card)" />
                                </>
                              ) : (
                                <>
                                  <path d={donutArc(rOuter, rInner, 0, fConverted)} fill="#22c55e" />
                                  <path d={donutArc(rOuter, rInner, fConverted, 1)} fill="#f59e0b" />
                                </>
                              )}
                              <text textAnchor="middle" dominantBaseline="central" fontSize={rOuter * 0.6} fontWeight={700} fill="var(--admin-text)">
                                {count}
                              </text>
                            </g>
                          );
                        })}
                      </>
                    );
                  }}
                </Mercator>
              </g>
            </svg>
            <div className="wm-controls">
              <button type="button" onClick={() => zoomAroundSvgPoint(WIDTH / 2, HEIGHT / 2, 1.4)} title="Zoom in">+</button>
              <button type="button" onClick={() => zoomAroundSvgPoint(WIDTH / 2, HEIGHT / 2, 1 / 1.4)} title="Zoom out">−</button>
              <button type="button" onClick={resetZoom} title="Reset view">⟲</button>
            </div>
            <div className="wm-hint">Scroll to zoom · drag to pan · click a cluster to zoom in</div>
          </div>
        )}
      </div>
    </div>
  );
}

const WM_STYLE = `
.wm-country { fill: var(--admin-grid); stroke: var(--admin-border); stroke-width: 0.5; }
.wm-legend { display: flex; gap: 16px; font-size: 12px; color: var(--admin-muted); }
.wm-legend span { display: inline-flex; align-items: center; gap: 6px; }
.wm-dot { fill: #f59e0b; fill-opacity: 0.55; stroke: #f59e0b; stroke-width: 0.75; cursor: pointer; }
.wm-dot.wm-dot-converted { fill: #22c55e; fill-opacity: 0.75; stroke: #22c55e; }
.wm-legend-dot { width: 9px; height: 9px; border-radius: 50%; display: inline-block; background: #f59e0b; }
.wm-legend-dot-converted { background: #22c55e; }
.wm-mapwrap { position: relative; }
.wm-svg { display: block; touch-action: none; cursor: grab; }
.wm-svg:active { cursor: grabbing; }
.wm-cluster { cursor: pointer; }
.wm-controls { position: absolute; top: 10px; right: 10px; display: flex; flex-direction: column; gap: 4px; }
.wm-controls button {
  width: 28px; height: 28px; border-radius: 7px; border: 1px solid var(--admin-border);
  background: var(--admin-card); color: var(--admin-text); font-size: 15px; font-weight: 600;
  cursor: pointer; line-height: 1; display: flex; align-items: center; justify-content: center;
}
.wm-controls button:hover { border-color: var(--admin-accent); }
.wm-hint { position: absolute; bottom: 8px; left: 12px; font-size: 11px; color: var(--admin-muted); pointer-events: none; }
`;
