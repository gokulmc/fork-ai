'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useInView } from '../useInView';
import { useStory, type StoryNode } from '../StoryContext';
import { computeLayout, centerLayoutX } from '../mapLayout';
import { BigMap, BIG_MAP_VIEW_W, BIG_MAP_VIEW_H } from '../BigMap';
import { MIX_QUESTION, MIX_ANSWER } from '../storyContent';

const MIX_ID = 'mix';
const MAX_SELECT = 6;
const MIN_SELECT = 2;
const AUTO_DEMO_DELAY_MS = 6000;
const AUTO_SELECT_COUNT = 3;
const TYPE_SPEED_MS = 28;
const MIX_ANSWER_SENTENCES = MIX_ANSWER.split(/(?<=\. )/).filter(Boolean);

const ROOT: StoryNode = { id: 'root', parentId: null, label: 'Alex’s question', kind: 'story' };

// Beat: the climax after the climax. Alex stops branching outward and starts
// combining — she picks the branches that matter and asks fork ai to argue
// from all of them at once. This is value-prop №5: the Mixer.
export function SceneMix() {
  const { ref: sceneRef, inView } = useInView<HTMLDivElement>(0.2);
  const { nodes, addNode, ensureStoryNodes } = useStory();

  // Fast scrollers who jump straight to the mixer need at least the root +
  // two other story nodes to be selectable — same catch-up as ScenePullback.
  useEffect(() => {
    ensureStoryNodes();
  }, [ensureStoryNodes]);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [mixed, setMixed] = useState(false);
  const [converging, setConverging] = useState(false);
  const [revealedCount, setRevealedCount] = useState(0);
  const [typed, setTyped] = useState('');
  const [typingDone, setTypingDone] = useState(false);

  const autoTimerRef = useRef<number | null>(null);
  const autoFiredRef = useRef(false);
  const [enteredMostly, setEnteredMostly] = useState(false);

  // Auto-demo countdown trigger, separate from the 0.2 threshold used for
  // the general scene entry animation — same pattern as SceneFork's
  // auto-demo. Unlike SceneFork, this scene's content (query box + map +
  // controls) is taller than the viewport on common screen sizes, so a
  // fixed intersectionRatio threshold (e.g. 0.6) can structurally never be
  // reached — use a rootMargin that shrinks the effective viewport to its
  // central band instead, which fires once the scene roughly fills the view
  // regardless of the scene's absolute height.
  useEffect(() => {
    const el = sceneRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => setEnteredMostly(entry.isIntersecting),
      { rootMargin: '-20% 0px -20% 0px', threshold: 0 }
    );
    obs.observe(el);
    return () => obs.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Query box types itself in once the scene comes into view (mirrors
  // SceneQuestion), then the synthesis card streams sentence by sentence.
  useEffect(() => {
    if (!inView) return;
    let cancelled = false;
    let i = 0;
    const typeNext = () => {
      if (cancelled) return;
      i += 1;
      setTyped(MIX_QUESTION.slice(0, i));
      if (i >= MIX_QUESTION.length) {
        setTypingDone(true);
        return;
      }
      window.setTimeout(typeNext, TYPE_SPEED_MS);
    };
    window.setTimeout(typeNext, 300);
    return () => {
      cancelled = true;
    };
  }, [inView]);

  const allNodes = useMemo(
    () => (nodes.some(n => n.id === 'root') ? nodes : [ROOT, ...nodes]),
    [nodes]
  );
  // Selectable = every node except the mix node itself and its own sources
  // once mixed (idempotent — nothing to re-select after synthesis lands).
  const selectableNodes = useMemo(
    () => (mixed ? [] : allNodes.filter(n => n.id !== MIX_ID)),
    [allNodes, mixed]
  );
  const selectableIds = useMemo(() => new Set(selectableNodes.map(n => n.id)), [selectableNodes]);

  // addNode() (fired from doMix's timeout) puts the mix node straight into
  // shared story context, so allNodes already includes it as soon as
  // `mixed` flips true — no need to synthesize a local copy here.
  const pos = useMemo(() => {
    const { pos: raw } = computeLayout(allNodes, { xStep: 250, yStep: 84, baseX: 40, centerY: BIG_MAP_VIEW_H / 2 });
    return centerLayoutX(raw, BIG_MAP_VIEW_W);
  }, [allNodes]);

  // Where the mix node will land once addNode() fires — computed the same
  // way (root's child) so the converging edges funnel to the real future
  // position, not root's own dot (root can itself be one of the selected
  // sources, which would otherwise make its own edge collapse to zero length).
  const mixTargetPos = useMemo(() => {
    if (allNodes.some(n => n.id === MIX_ID)) return pos[MIX_ID];
    const withMix = [...allNodes, { id: MIX_ID, parentId: 'root', label: 'Synthesis', kind: 'story' } as StoryNode];
    const { pos: raw } = computeLayout(withMix, { xStep: 250, yStep: 84, baseX: 40, centerY: BIG_MAP_VIEW_H / 2 });
    return centerLayoutX(raw, BIG_MAP_VIEW_W)[MIX_ID];
  }, [allNodes, pos]);

  // Brief loading affordance on the mix node's pill while its synthesis
  // card is still streaming in sentence by sentence.
  const streamingIds = useMemo(
    () => (mixed && revealedCount < MIX_ANSWER_SENTENCES.length ? new Set([MIX_ID]) : undefined),
    [mixed, revealedCount]
  );

  const cancelAutoDemo = useCallback(() => {
    autoFiredRef.current = true;
    if (autoTimerRef.current != null) {
      window.clearTimeout(autoTimerRef.current);
      autoTimerRef.current = null;
    }
  }, []);

  const doMix = useCallback(
    (sourceIds: string[]) => {
      if (mixed || sourceIds.length < MIN_SELECT) return;
      setConverging(true);
      // Matches ConvergingEdges' own internal timeline (last staggered edge
      // + landing ring/dot) so the real mix node in the layout replaces the
      // animated landing dot exactly as it finishes, not before or after.
      const lastEdgeDelay = (sourceIds.length - 1) * 90;
      const landingDelay = lastEdgeDelay + 500;
      const settle = window.setTimeout(() => {
        setConverging(false);
        setMixed(true);
        addNode({ id: MIX_ID, parentId: 'root', label: 'Synthesis', kind: 'story', mix: true });
      }, landingDelay + 360);
      return () => window.clearTimeout(settle);
    },
    [mixed, addNode]
  );

  // selectableNodes changes reference on every nodes/mixed update (e.g. a
  // visitor branching in an earlier scene still mounted below this one) —
  // read the current value from a ref inside the timeout instead of putting
  // it in the effect's deps, so those unrelated re-renders can't restart
  // the countdown before it ever fires.
  const selectableNodesRef = useRef(selectableNodes);
  selectableNodesRef.current = selectableNodes;

  // Auto-demo: if the visitor never interacts, stage-select 3 story nodes
  // with staggered pops, then trigger Mix — the story never stalls.
  useEffect(() => {
    if (!enteredMostly || autoFiredRef.current || mixed) return;
    autoTimerRef.current = window.setTimeout(() => {
      if (autoFiredRef.current || mixed) return;
      autoFiredRef.current = true;
      const picks = selectableNodesRef.current.filter(n => n.kind === 'story').slice(0, AUTO_SELECT_COUNT);
      const ids = picks.map(n => n.id);
      if (ids.length < MIN_SELECT) return;
      ids.forEach((id, i) => {
        window.setTimeout(() => {
          setSelected(prev => new Set(prev).add(id));
        }, i * 200);
      });
      window.setTimeout(() => doMix(ids), ids.length * 200 + 250);
    }, AUTO_DEMO_DELAY_MS);
    return () => {
      if (autoTimerRef.current != null) window.clearTimeout(autoTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enteredMostly, mixed]);

  const onNodeClick = useCallback(
    (id: string) => {
      if (mixed || !selectableIds.has(id)) return;
      cancelAutoDemo();
      setSelected(prev => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else if (next.size < MAX_SELECT) next.add(id);
        return next;
      });
    },
    [mixed, selectableIds, cancelAutoDemo]
  );

  const onMixClick = useCallback(() => {
    cancelAutoDemo();
    doMix(Array.from(selected));
  }, [cancelAutoDemo, doMix, selected]);

  // Synthesis card streams in paragraph by paragraph once mixed lands.
  useEffect(() => {
    if (!mixed) return;
    let n = 0;
    const revealNext = () => {
      n += 1;
      setRevealedCount(n);
      if (n >= MIX_ANSWER_SENTENCES.length) return;
      window.setTimeout(revealNext, 420);
    };
    window.setTimeout(revealNext, 500);
  }, [mixed]);

  return (
    <section id="scene-mix" data-time={1496} className="wp-scene wp-scene-mix" ref={sceneRef}>
      <div className="wp-wrap">
        <div className="wp-stamp">
          <span className="wp-stamp-label">MON · 12:56 AM</span>
          <span className="wp-stamp-rule" />
        </div>
        <h2 className="wp-h2 wp-reveal">The mix</h2>
        <p className="wp-sub wp-reveal">
          She stops branching and starts combining. Five branches, one question:
        </p>

        <div className={`wp-qbox-wrap ${inView ? 'wp-in-view' : ''}`}>
          <div className="wp-qbox">
            <span className="wp-qbox-text">{typed}</span>
            {!typingDone && <span className="wp-caret" />}
          </div>
        </div>

        <div className="wp-mix-instruction">
          Select 2–6 nodes — including the ones you made.
        </div>

        <BigMap
          nodes={allNodes}
          pos={pos}
          onNodeClick={mixed ? undefined : onNodeClick}
          selected={selected}
          selectableIds={selectableIds}
          caption={mixed ? 'synthesis complete' : undefined}
          streamingIds={streamingIds}
        />

        {converging && mixTargetPos && (
          <ConvergingEdges nodeIds={Array.from(selected)} pos={pos} target={mixTargetPos} />
        )}

        <div className="wp-mix-controls">
          <span className="wp-mix-counter">{selected.size} / {MAX_SELECT} SELECTED</span>
          <button
            type="button"
            className="wp-mix-btn"
            disabled={mixed || selected.size < MIN_SELECT}
            onClick={onMixClick}
          >
            {mixed ? 'Mixed' : 'Mix ⏷'}
          </button>
        </div>

        {mixed && (
          <div className="wp-mix-answer-card wp-demo-card">
            {MIX_ANSWER_SENTENCES.slice(0, revealedCount).map((sentence, i) => (
              <p key={i} className="wp-mix-answer-sentence wp-mix-answer-sentence-in">{sentence}</p>
            ))}
          </div>
        )}

        {mixed && (
          <p className="wp-why">№5 — The Mixer: combine the branches that mattered into one answer.</p>
        )}
      </div>
    </section>
  );
}

// Draws a converging edge from each selected node toward where the new mix
// node will land (pre-computed by the caller via the same layout function,
// since the real node only enters shared story state once `mixed` flips
// true) — staggered ~90ms per edge so it reads as a funnel, not a blink.
function ConvergingEdges({
  nodeIds,
  pos,
  target,
}: {
  nodeIds: string[];
  pos: Record<string, { x: number; y: number }>;
  target: { x: number; y: number };
}) {
  // Landing ring/dot fire once the LAST staggered edge is expected to have
  // finished drawing, so the "arrival" reads as a consequence of the edges
  // landing rather than an unrelated simultaneous flourish.
  const lastEdgeDelay = (nodeIds.length - 1) * 90;
  const landingDelay = lastEdgeDelay + 500;
  return (
    <svg className="wp-mix-converge-svg" viewBox={`0 0 ${BIG_MAP_VIEW_W} ${BIG_MAP_VIEW_H}`}>
      {nodeIds.map((id, i) => {
        const from = pos[id];
        if (!from) return null;
        return (
          <path
            key={id}
            className="wp-mix-converge-edge"
            style={{ animationDelay: `${i * 90}ms` }}
            d={`M ${from.x} ${from.y} Q ${(from.x + target.x) / 2} ${(from.y + target.y) / 2 - 20} ${target.x} ${target.y}`}
          />
        );
      })}
      <circle
        className="wp-mix-converge-landing"
        cx={target.x}
        cy={target.y}
        style={{ animationDelay: `${landingDelay}ms` }}
      />
      <circle
        className="wp-mix-converge-landing-dot"
        cx={target.x}
        cy={target.y}
        r={7}
        style={{ animationDelay: `${landingDelay}ms`, transformBox: 'fill-box', transformOrigin: 'center' }}
      />
    </svg>
  );
}
