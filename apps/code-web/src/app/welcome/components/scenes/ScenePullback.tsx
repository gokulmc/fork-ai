'use client';
import { useEffect, useMemo, useRef } from 'react';
import { useSceneProgress } from '../useScrollProgress';
import { useStory, type StoryNode } from '../StoryContext';
import { computeLayout, centerLayoutX } from '../mapLayout';
import { BigMap, BIG_MAP_VIEW_W, BIG_MAP_VIEW_H } from '../BigMap';

const ROOT: StoryNode = { id: 'root', parentId: null, label: 'Alex’s question', kind: 'story' };

// Beat: the climax. Two hours become a map, not a transcript — including
// whatever the visitor branched themselves. Scroll-driven scale/opacity via
// the --wp-progress CSS var; pannable by drag. While this scene is
// prominently in view, the fixed dock hides so the big map is the star.
export function ScenePullback() {
  const sceneRef = useRef<HTMLElement>(null);
  useSceneProgress(sceneRef as React.RefObject<HTMLElement>);
  const { nodes, ensureStoryNodes, visitorActions } = useStory();

  // Fast scrollers who jump straight here (anchor link, quick flick) miss
  // the per-scene mounts earlier in the page that normally add each story
  // node one at a time — catch up so the climax always shows the full map.
  useEffect(() => {
    ensureStoryNodes();
  }, [ensureStoryNodes]);

  // SceneQuestion adds its own `id: 'root'` node once the visitor scrolls to
  // it (earlier than this scene); fall back to the placeholder only if that
  // hasn't happened yet (e.g. reduced-motion / fast-scroll edge cases).
  const allNodes = useMemo(
    () => (nodes.some(n => n.id === 'root') ? nodes : [ROOT, ...nodes]),
    [nodes]
  );
  const pos = useMemo(() => {
    const { pos: raw } = computeLayout(allNodes, { xStep: 250, yStep: 84, baseX: 40, centerY: BIG_MAP_VIEW_H / 2 });
    return centerLayoutX(raw, BIG_MAP_VIEW_W);
  }, [allNodes]);

  useEffect(() => {
    const el = sceneRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => {
        document.documentElement.classList.toggle('wp-dock-hidden', entry.intersectionRatio >= 0.4);
      },
      { threshold: [0, 0.4, 1] }
    );
    obs.observe(el);
    return () => {
      obs.disconnect();
      document.documentElement.classList.remove('wp-dock-hidden');
    };
  }, []);

  return (
    <section id="scene-pullback" data-time="1427" className="wp-scene wp-scene-pullback" ref={sceneRef}>
      <div className="wp-wrap">
        <div className="wp-stamp">
          <span className="wp-stamp-label">11:47 PM</span>
          <span className="wp-stamp-rule" />
        </div>
        <h2 className="wp-h2 wp-reveal">Two hours. Not a transcript — a map.</h2>
        {visitorActions.branches > 0 && (
          <p className="wp-sub wp-reveal">Including the branches YOU just made.</p>
        )}

        <BigMap nodes={allNodes} pos={pos} />
      </div>
    </section>
  );
}
