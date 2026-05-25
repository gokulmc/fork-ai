'use client';
import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import type { Tweaks } from '@/lib/types';
import type { SetTweak } from '@/hooks/useTweaks';

// ── Sub-components ─────────────────────────────────────────────────────────

function TweakSection({ label }: { label: string }) {
  return <div className="twk-sect">{label}</div>;
}

function TweakRow({
  label,
  value,
  inline = false,
  children,
}: {
  label: string;
  value?: string | number;
  inline?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={inline ? 'twk-row twk-row-h' : 'twk-row'}>
      <div className="twk-lbl">
        <span>{label}</span>
        {value != null && <span className="twk-val">{value}</span>}
      </div>
      {children}
    </div>
  );
}

export function TweakRadio({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const valueRef = useRef(value);
  valueRef.current = value;

  const idx = Math.max(0, options.findIndex(o => o.value === value));
  const n = options.length;

  const segAt = (clientX: number) => {
    if (!trackRef.current) return options[0].value;
    const r = trackRef.current.getBoundingClientRect();
    const inner = r.width - 4;
    const i = Math.floor(((clientX - r.left - 2) / inner) * n);
    return options[Math.max(0, Math.min(n - 1, i))].value;
  };

  const onPointerDown = (e: React.PointerEvent) => {
    setDragging(true);
    const v0 = segAt(e.clientX);
    if (v0 !== valueRef.current) onChange(v0);
    const move = (ev: PointerEvent) => {
      if (!trackRef.current) return;
      const v = segAt(ev.clientX);
      if (v !== valueRef.current) onChange(v);
    };
    const up = () => {
      setDragging(false);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  return (
    <TweakRow label={label}>
      <div
        ref={trackRef}
        role="radiogroup"
        onPointerDown={onPointerDown}
        className={`twk-seg${dragging ? ' dragging' : ''}`}
      >
        <div
          className="twk-seg-thumb"
          style={{
            left: `calc(2px + ${idx} * (100% - 4px) / ${n})`,
            width: `calc((100% - 4px) / ${n})`,
          }}
        />
        {options.map(o => (
          <button key={o.value} type="button" role="radio" aria-checked={o.value === value}>
            {o.label}
          </button>
        ))}
      </div>
    </TweakRow>
  );
}

export function TweakSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
}) {
  return (
    <TweakRow label={label}>
      <select className="twk-field" value={value} onChange={e => onChange(e.target.value)}>
        {options.map(o => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </TweakRow>
  );
}

function isLight(hex: string) {
  const h = String(hex).replace('#', '');
  const x = h.length === 3 ? h.replace(/./g, c => c + c) : h.padEnd(6, '0');
  const n = parseInt(x.slice(0, 6), 16);
  if (Number.isNaN(n)) return true;
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return r * 299 + g * 587 + b * 114 > 148000;
}

const Check = ({ light }: { light: boolean }) => (
  <svg viewBox="0 0 14 14" aria-hidden="true">
    <path d="M3 7.2 5.8 10 11 4.2" fill="none" strokeWidth="2.2"
      strokeLinecap="round" strokeLinejoin="round"
      stroke={light ? 'rgba(0,0,0,.78)' : '#fff'} />
  </svg>
);

export function TweakColor({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (v: string) => void;
}) {
  const cur = value.toLowerCase();
  return (
    <TweakRow label={label}>
      <div className="twk-chips" role="radiogroup">
        {options.map((o, i) => {
          const on = o.toLowerCase() === cur;
          return (
            <button
              key={i}
              type="button"
              className="twk-chip"
              role="radio"
              aria-checked={on}
              data-on={on ? '1' : '0'}
              aria-label={o}
              title={o}
              style={{ background: o }}
              onClick={() => onChange(o)}
            >
              {on && <Check light={isLight(o)} />}
            </button>
          );
        })}
      </div>
    </TweakRow>
  );
}

// ── Main panel ─────────────────────────────────────────────────────────────

const PAD = 16;

interface TweaksPanelProps {
  tweaks: Tweaks;
  setTweak: SetTweak;
  fontPairOptions: { value: string; label: string }[];
  accentOptions: string[];
  onRestartTour?: () => void;
}

export function TweaksPanel({ tweaks, setTweak, fontPairOptions, accentOptions, onRestartTour }: TweaksPanelProps) {
  const [open, setOpen] = useState(false);
  const dragRef = useRef<HTMLDivElement>(null);
  const offsetRef = useRef({ x: PAD, y: PAD });

  const clampToViewport = useCallback(() => {
    const panel = dragRef.current;
    if (!panel) return;
    const w = panel.offsetWidth, h = panel.offsetHeight;
    const maxRight = Math.max(PAD, window.innerWidth - w - PAD);
    const maxBottom = Math.max(PAD, window.innerHeight - h - PAD);
    offsetRef.current = {
      x: Math.min(maxRight, Math.max(PAD, offsetRef.current.x)),
      y: Math.min(maxBottom, Math.max(PAD, offsetRef.current.y)),
    };
    panel.style.right = offsetRef.current.x + 'px';
    panel.style.bottom = offsetRef.current.y + 'px';
  }, []);

  useEffect(() => {
    if (!open) return;
    clampToViewport();
    const ro = new ResizeObserver(clampToViewport);
    ro.observe(document.documentElement);
    return () => ro.disconnect();
  }, [open, clampToViewport]);

  const onDragStart = (e: React.MouseEvent) => {
    const panel = dragRef.current;
    if (!panel) return;
    const r = panel.getBoundingClientRect();
    const sx = e.clientX, sy = e.clientY;
    const startRight = window.innerWidth - r.right;
    const startBottom = window.innerHeight - r.bottom;
    const move = (ev: MouseEvent) => {
      offsetRef.current = {
        x: startRight - (ev.clientX - sx),
        y: startBottom - (ev.clientY - sy),
      };
      clampToViewport();
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  return (
    <>
      {/* Floating trigger */}
      {!open && (
        <button
          className="twk-trigger"
          onClick={() => setOpen(true)}
          title="Tweaks"
          aria-label="Open tweaks panel"
        >
          ⚙
        </button>
      )}

      {open && (
        <div
          ref={dragRef}
          className="twk-panel"
          style={{ right: offsetRef.current.x, bottom: offsetRef.current.y }}
        >
          <div className="twk-hd" onMouseDown={onDragStart}>
            <b>Tweaks</b>
            <button
              className="twk-x"
              aria-label="Close tweaks"
              onMouseDown={e => e.stopPropagation()}
              onClick={() => setOpen(false)}
            >✕</button>
          </div>
          <div className="twk-body">
            <TweakSection label="Appearance" />
            <TweakRadio
              label="Theme"
              value={tweaks.theme}
              options={[{ value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }]}
              onChange={v => setTweak('theme', v as Tweaks['theme'])}
            />
            <TweakRadio
              label="Density"
              value={tweaks.density}
              options={[{ value: 'comfortable', label: 'Cozy' }, { value: 'compact', label: 'Compact' }]}
              onChange={v => setTweak('density', v as Tweaks['density'])}
            />
            <TweakColor
              label="Accent"
              value={tweaks.accent}
              options={accentOptions}
              onChange={v => setTweak('accent', v)}
            />
            <TweakSection label="Typography" />
            <TweakSelect
              label="Font pairing"
              value={tweaks.fontPair}
              options={fontPairOptions}
              onChange={v => setTweak('fontPair', v)}
            />
            <TweakSection label="Mind map" />
            <TweakRadio
              label="Layout"
              value={tweaks.mapLayout}
              options={[{ value: 'horizontal', label: 'Horizontal' }, { value: 'vertical', label: 'Vertical' }]}
              onChange={v => setTweak('mapLayout', v as Tweaks['mapLayout'])}
            />
            <TweakSection label="Content" />
            <TweakRadio
              label="Max sections"
              value={String(tweaks.maxSections)}
              options={[4, 5, 6, 7, 8].map(n => ({ value: String(n), label: String(n) }))}
              onChange={v => setTweak('maxSections', Number(v))}
            />
            <TweakRadio
              label="Web search"
              value={tweaks.webSearch ? 'on' : 'off'}
              options={[{ value: 'off', label: 'Off' }, { value: 'on', label: 'On' }]}
              onChange={v => setTweak('webSearch', v === 'on')}
            />
            <TweakSection label="Ask AI shortcuts" />
            <div className="twk-shortcuts">
              {([['?', 'what'], ['!?', 'how'], ['/?', 'why'], ['>?', 'explain']] as const).map(([sym, word]) => (
                <div key={sym} className="twk-shortcut-row">
                  <code className="twk-shortcut-sym">{sym}</code>
                  <span className="twk-shortcut-arr">→</span>
                  <span className="twk-shortcut-word">{word}</span>
                </div>
              ))}
            </div>
            {onRestartTour && (
              <>
                <TweakSection label="Onboarding" />
                <div className="twk-row">
                  <button className="twk-restart-btn" onClick={onRestartTour}>
                    Restart tour
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
