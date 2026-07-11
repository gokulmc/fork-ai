'use client';
import { useRef } from 'react';
import { useScrollClock, type SceneAnchor } from './useScrollProgress';

const SCENE_ANCHORS: SceneAnchor[] = [
  { id: 'scene-prologue', time: 1262 },
  { id: 'scene-question', time: 1274 },
  { id: 'scene-fork', time: 1291 },
  { id: 'scene-models', time: 1325 },
  { id: 'scene-sources', time: 1360 },
  { id: 'scene-pullback', time: 1427 },
  { id: 'scene-mix', time: 1496 },
  { id: 'scene-morning', time: 1935 },
  { id: 'scene-epilogue', time: 1935 },
];

// minutes-since-Sunday-midnight -> "SUN · 9:02 PM" style label
function formatClock(minutes: number): string {
  const dayIndex = Math.floor(minutes / 1440); // 0 = Sunday, 1 = Monday
  const day = dayIndex >= 1 ? 'MON' : 'SUN';
  const minsInDay = ((Math.round(minutes) % 1440) + 1440) % 1440;
  let hour24 = Math.floor(minsInDay / 60);
  const min = minsInDay % 60;
  const ampm = hour24 >= 12 ? 'PM' : 'AM';
  let hour12 = hour24 % 12;
  if (hour12 === 0) hour12 = 12;
  const minStr = min.toString().padStart(2, '0');
  return `${day} · ${hour12}:${minStr} ${ampm}`;
}

export function ChapterClock() {
  const textRef = useRef<HTMLSpanElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const lastMinuteRef = useRef<number | null>(null);

  useScrollClock(SCENE_ANCHORS, (minutes, scrollProgress) => {
    const roundedMinute = Math.round(minutes);
    if (lastMinuteRef.current !== roundedMinute) {
      lastMinuteRef.current = roundedMinute;
      if (textRef.current) textRef.current.textContent = formatClock(roundedMinute);
    }
    if (barRef.current) barRef.current.style.width = `${(scrollProgress * 100).toFixed(2)}%`;
  });

  return (
    <div className="wp-clock" aria-live="off">
      <span className="wp-clock-text" ref={textRef}>SUN · 9:02 PM</span>
      <div className="wp-clock-rule">
        <div className="wp-clock-bar" ref={barRef} />
      </div>
    </div>
  );
}
