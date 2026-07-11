'use client';
import { useEffect, useRef } from 'react';

export interface SceneAnchor {
  id: string;
  time: number; // minutes since Sunday midnight
}

/**
 * rAF-throttled scroll clock. Finds which pair of scene anchors the viewport
 * center currently sits between, interpolates a "minutes since Sunday
 * midnight" value, and hands it to onTick. Never calls setState — callers
 * write straight to the DOM (same discipline as MindMap.tsx) so scrolling
 * never triggers a React re-render.
 *
 * Each scene contributes two virtual points — its top (el.offsetTop) and its
 * bottom (el.offsetTop + el.offsetHeight) — both carrying the SAME time.
 * Interpolating between a scene's own top/bottom pair is therefore always a
 * no-op (start === end), so the clock holds constant while scrolling through
 * a single scene's interior; it only advances in the gap between one scene's
 * bottom and the next scene's top. This keeps SCENE_ANCHORS as one {id,time}
 * entry per scene — no extra DOM ids needed in the scene files.
 */
export function useScrollClock(anchors: SceneAnchor[], onTick: (minutes: number, progress: number) => void) {
  const rafId = useRef<number | null>(null);
  const onTickRef = useRef(onTick);
  onTickRef.current = onTick;

  useEffect(() => {
    if (!anchors.length) return;
    const els = anchors
      .map(a => ({ a, el: document.getElementById(a.id) }))
      .filter((x): x is { a: SceneAnchor; el: HTMLElement } => !!x.el);
    if (!els.length) return;

    // Recomputed on every tick (cheap — just offsetTop/offsetHeight reads),
    // not cached once at mount: scene content streams in over time (section
    // reveals, the mixer's synthesis card, the guest node), which changes
    // offsetHeight and shifts every later scene's offsetTop. A one-time
    // snapshot would silently go stale and break the "holds constant within
    // a scene" guarantee this function exists for.
    const getPoints = () =>
      els
        .flatMap(({ a, el }) => [
          { time: a.time, pos: el.offsetTop },
          { time: a.time, pos: el.offsetTop + el.offsetHeight },
        ])
        .sort((a, b) => a.pos - b.pos);

    const compute = () => {
      rafId.current = null;
      const points = getPoints();
      const center = window.scrollY + window.innerHeight / 2;

      let before = points[0];
      let after = points[points.length - 1];
      for (let i = 0; i < points.length; i++) {
        if (points[i].pos <= center) before = points[i];
        if (points[i].pos >= center) {
          after = points[i];
          break;
        }
        after = points[i];
      }

      let minutes = before.time;
      if (after.pos !== before.pos) {
        const span = after.pos - before.pos;
        const progress = span > 0 ? Math.min(1, Math.max(0, (center - before.pos) / span)) : 0;
        minutes = before.time + (after.time - before.time) * progress;
      }

      const docHeight = document.documentElement.scrollHeight - window.innerHeight;
      const scrollProgress = docHeight > 0 ? Math.min(1, Math.max(0, window.scrollY / docHeight)) : 0;

      onTickRef.current(minutes, scrollProgress);
    };

    const onScroll = () => {
      if (rafId.current != null) return;
      rafId.current = requestAnimationFrame(compute);
    };

    compute();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (rafId.current != null) cancelAnimationFrame(rafId.current);
    };
  }, [anchors]);
}

/**
 * Writes a --wp-progress custom property (0→1) onto the given element as it
 * travels through the viewport: 0 when its top edge reaches the bottom of
 * the viewport, 1 when its bottom edge reaches the top of the viewport.
 * rAF-throttled, no setState — consumers read the CSS var in their own
 * stylesheet (burial crush, pullback zoom, etc).
 */
export function useSceneProgress<T extends HTMLElement>(ref: React.RefObject<T | null>) {
  const rafId = useRef<number | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const compute = () => {
      rafId.current = null;
      const rect = el.getBoundingClientRect();
      const vh = window.innerHeight;
      const total = rect.height + vh;
      const traveled = vh - rect.top;
      const progress = total > 0 ? Math.min(1, Math.max(0, traveled / total)) : 0;
      el.style.setProperty('--wp-progress', progress.toFixed(4));
    };

    const onScroll = () => {
      if (rafId.current != null) return;
      rafId.current = requestAnimationFrame(compute);
    };

    compute();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (rafId.current != null) cancelAnimationFrame(rafId.current);
    };
  }, [ref]);
}
