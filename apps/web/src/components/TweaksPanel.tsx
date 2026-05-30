'use client';
import { useState, useRef, useEffect, useCallback } from 'react';
import type { Tweaks } from '@/lib/types';
import type { SetTweak } from '@/hooks/useTweaks';
import { submitSupportTicket, type SupportSubject } from '@/lib/api';

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

// Branch-model choices (Claude + Gemini). Shared by the Model dropdown and the
// status chip so the label stays in sync.
const MODEL_OPTIONS: { value: Tweaks['branchModel']; label: string }[] = [
  { value: 'haiku', label: 'Claude Haiku' },
  { value: 'sonnet', label: 'Claude Sonnet' },
  { value: 'opus', label: 'Claude Opus' },
  { value: 'gemini-flash-lite', label: 'Gemini 2.5 Flash-Lite' },
  { value: 'gemini-flash', label: 'Gemini 2.5 Flash' },
  { value: 'gemini-pro', label: 'Gemini 2.5 Pro' },
];
const modelLabel = (v: string) => MODEL_OPTIONS.find(o => o.value === v)?.label ?? v;

interface TweaksPanelProps {
  tweaks: Tweaks;
  setTweak: SetTweak;
  fontPairOptions: { value: string; label: string }[];
  onRestartTour?: () => void;
  userEmail?: string;
  userName?: string;
}

export function TweaksPanel({ tweaks, setTweak, fontPairOptions, onRestartTour, userEmail, userName }: TweaksPanelProps) {
  const [open, setOpen] = useState(false);
  const [howToOpen, setHowToOpen] = useState(false);
  const [supportOpen, setSupportOpen] = useState(false);
  const [supportName, setSupportName] = useState(userName ?? '');
  const [supportEmail, setSupportEmail] = useState(userEmail ?? '');
  const [supportSubject, setSupportSubject] = useState<SupportSubject>('Bug');
  const [supportMessage, setSupportMessage] = useState('');
  const [supportLoading, setSupportLoading] = useState(false);
  const [supportError, setSupportError] = useState<string | null>(null);
  const [supportSent, setSupportSent] = useState(false);
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
      {/* Floating status chips + trigger (both hidden once the panel is open) */}
      {!open && (
        <>
          <div className="twk-status" aria-hidden="true">
            <span className="twk-status-pill">🤖 {modelLabel(tweaks.branchModel)}</span>
            <span className={`twk-status-pill ${tweaks.webSearch ? 'twk-status-on' : 'twk-status-off'}`}>
              🔍 Web {tweaks.webSearch ? 'on' : 'off'}
            </span>
          </div>
          <button
            className="twk-trigger"
            onClick={() => setOpen(true)}
            title="Tweaks"
            aria-label="Open tweaks panel"
          >
            ⚙
          </button>
        </>
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
            <TweakSelect
              label="Model"
              value={tweaks.branchModel}
              options={MODEL_OPTIONS}
              onChange={v => setTweak('branchModel', v as Tweaks['branchModel'])}
            />
            <p className="twk-note">Model for Go Deeper &amp; Ask AI (Claude or Gemini). Lighter models are faster &amp; cheaper; top-tier models are most capable but cost more credit.</p>
            <TweakRadio
              label="Web search"
              value={tweaks.webSearch ? 'on' : 'off'}
              options={[{ value: 'off', label: 'Off' }, { value: 'on', label: 'On' }]}
              onChange={v => setTweak('webSearch', v === 'on')}
            />
            <p className="twk-note">Web search queries are costlier than normal LLM calls. Keep them off at most times.</p>
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
            <TweakSection label="Help" />
            <div className="twk-row">
              <button className="twk-restart-btn" onClick={() => { setOpen(false); setHowToOpen(true); }}>
                How to use
              </button>
            </div>
            <TweakSection label="Support" />
            <div className="twk-row">
              <button className="twk-restart-btn" onClick={() => {
                setSupportName(userName ?? '');
                setSupportEmail(userEmail ?? '');
                setSupportSent(false);
                setSupportError(null);
                setSupportMessage('');
                setOpen(false);
                setSupportOpen(true);
              }}>
                Contact support
              </button>
            </div>
          </div>
        </div>
      )}

      {/* How to Use overlay */}
      {howToOpen && (
        <div
          onClick={e => { if (e.currentTarget === e.target) setHowToOpen(false); }}
          style={{
            position: 'fixed', inset: 0, zIndex: 80,
            background: 'rgba(255,255,255,0.88)', backdropFilter: 'blur(4px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <div style={{
            background: '#ffffff', border: '1px solid rgba(10,10,10,0.15)',
            borderRadius: 8, padding: '28px',
            width: 'min(620px, 92vw)',
            maxHeight: '84vh',
            display: 'flex', flexDirection: 'column',
            fontFamily: "ui-monospace,'JetBrains Mono','SF Mono',Menlo,monospace",
            boxShadow: '0 8px 32px rgba(10,10,10,0.10)',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, flexShrink: 0 }}>
              <div style={{ fontSize: 10, letterSpacing: '0.22em', textTransform: 'uppercase', color: 'rgba(10,10,10,0.4)' }}>
                How to use fork ai
              </div>
              <button onClick={() => setHowToOpen(false)} style={{ background: 'none', border: 0, cursor: 'pointer', fontSize: 14, color: 'rgba(10,10,10,0.4)', lineHeight: 1 }}>✕</button>
            </div>
            <div style={{ overflowY: 'auto', flex: 1, fontSize: 11, lineHeight: 1.75, color: 'rgba(10,10,10,0.8)', letterSpacing: '0.02em' }}>
              <HowToContent />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 20, flexShrink: 0 }}>
              <button
                onClick={() => setHowToOpen(false)}
                style={{
                  background: 'none', border: '1px solid rgba(10,10,10,0.15)',
                  borderRadius: 4, padding: '7px 16px', cursor: 'pointer',
                  fontFamily: "ui-monospace,'JetBrains Mono','SF Mono',Menlo,monospace",
                  fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'rgba(10,10,10,0.5)',
                }}
              >Close</button>
            </div>
          </div>
        </div>
      )}

      {/* Support form overlay */}
      {supportOpen && (
        <div
          onClick={e => { if (e.currentTarget === e.target) setSupportOpen(false); }}
          style={{
            position: 'fixed', inset: 0, zIndex: 80,
            background: 'rgba(255,255,255,0.88)', backdropFilter: 'blur(4px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <div style={{
            background: '#ffffff', border: '1px solid rgba(10,10,10,0.15)',
            borderRadius: 8, padding: '28px',
            width: 'min(420px, 92vw)',
            fontFamily: "ui-monospace,'JetBrains Mono','SF Mono',Menlo,monospace",
            boxShadow: '0 8px 32px rgba(10,10,10,0.10)',
          }}>
            <div style={{ fontSize: 10, letterSpacing: '0.22em', textTransform: 'uppercase', color: 'rgba(10,10,10,0.4)', marginBottom: 20 }}>
              Contact support
            </div>
            {supportSent ? (
              <div style={{ fontSize: 11, color: '#27ae60', letterSpacing: '0.04em', marginBottom: 20 }}>
                Message sent — we&apos;ll get back to you at {supportEmail}.
              </div>
            ) : (
              <>
                {(
                  [
                    ['Your name', supportName, setSupportName, 'text'],
                    ['Email address', supportEmail, setSupportEmail, 'email'],
                  ] as [string, string, (v: string) => void, string][]
                ).map(([placeholder, value, setter, type]) => (
                  <input
                    key={placeholder}
                    type={type}
                    value={value}
                    onChange={e => { setSupportError(null); setter(e.target.value); }}
                    placeholder={placeholder}
                    disabled={supportLoading}
                    style={{
                      display: 'block', width: '100%', boxSizing: 'border-box',
                      border: 0, borderBottom: '1px solid rgba(10,10,10,0.12)',
                      padding: '10px 0', marginBottom: 14,
                      fontFamily: 'inherit', fontSize: 11, color: '#0a0a0a',
                      background: '#ffffff', outline: 'none', letterSpacing: '0.04em',
                    }}
                  />
                ))}
                <select
                  value={supportSubject}
                  onChange={e => { setSupportError(null); setSupportSubject(e.target.value as SupportSubject); }}
                  disabled={supportLoading}
                  style={{
                    display: 'block', width: '100%', boxSizing: 'border-box',
                    border: 0, borderBottom: '1px solid rgba(10,10,10,0.12)',
                    padding: '10px 0', marginBottom: 14,
                    fontFamily: 'inherit', fontSize: 11, color: '#0a0a0a',
                    background: '#ffffff', outline: 'none', letterSpacing: '0.04em',
                    appearance: 'none', cursor: 'pointer',
                  }}
                >
                  {(['Bug', 'Billing', 'Feature Request', 'Other'] as SupportSubject[]).map(s => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
                <textarea
                  value={supportMessage}
                  onChange={e => { setSupportError(null); setSupportMessage(e.target.value); }}
                  placeholder="Describe your issue or question…"
                  disabled={supportLoading}
                  rows={5}
                  style={{
                    display: 'block', width: '100%', boxSizing: 'border-box',
                    border: '1px solid rgba(10,10,10,0.12)', borderRadius: 4,
                    padding: '10px', marginBottom: 14,
                    fontFamily: 'inherit', fontSize: 11, color: '#0a0a0a',
                    background: '#ffffff', outline: 'none', letterSpacing: '0.04em',
                    resize: 'vertical',
                  }}
                />
                {supportError && (
                  <div style={{ fontSize: 10, color: '#c0392b', marginBottom: 12, letterSpacing: '0.04em' }}>{supportError}</div>
                )}
                <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                  <button
                    onClick={() => setSupportOpen(false)}
                    style={{
                      background: 'none', border: '1px solid rgba(10,10,10,0.15)',
                      borderRadius: 4, padding: '7px 16px', cursor: 'pointer',
                      fontFamily: 'inherit', fontSize: 10, letterSpacing: '0.12em',
                      textTransform: 'uppercase', color: 'rgba(10,10,10,0.5)',
                    }}
                  >Cancel</button>
                  <button
                    disabled={supportLoading}
                    onClick={async () => {
                      if (!supportName.trim() || !supportEmail.trim() || !supportMessage.trim()) {
                        setSupportError('Please fill in all fields.');
                        return;
                      }
                      setSupportLoading(true);
                      setSupportError(null);
                      try {
                        await submitSupportTicket({ name: supportName.trim(), email: supportEmail.trim(), subject: supportSubject, message: supportMessage.trim() });
                        setSupportSent(true);
                      } catch {
                        setSupportError('Failed to send — please try again.');
                      } finally {
                        setSupportLoading(false);
                      }
                    }}
                    style={{
                      background: '#0a0a0a', border: 0,
                      borderRadius: 4, padding: '7px 16px', cursor: 'pointer',
                      fontFamily: 'inherit', fontSize: 10, letterSpacing: '0.12em',
                      textTransform: 'uppercase', color: '#ffffff',
                      opacity: supportLoading ? 0.6 : 1,
                    }}
                  >{supportLoading ? '…' : 'Send'}</button>
                </div>
              </>
            )}
            {supportSent && (
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <button
                  onClick={() => setSupportOpen(false)}
                  style={{
                    background: 'none', border: '1px solid rgba(10,10,10,0.15)',
                    borderRadius: 4, padding: '7px 16px', cursor: 'pointer',
                    fontFamily: 'inherit', fontSize: 10, letterSpacing: '0.12em',
                    textTransform: 'uppercase', color: 'rgba(10,10,10,0.5)',
                  }}
                >Close</button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function HowToContent() {
  const h2: React.CSSProperties = { fontSize: 10, letterSpacing: '0.18em', textTransform: 'uppercase', color: '#0a0a0a', marginTop: 20, marginBottom: 6 };
  const p: React.CSSProperties = { margin: '0 0 10px' };
  const li: React.CSSProperties = { marginBottom: 4 };
  const code: React.CSSProperties = {
    fontFamily: 'inherit', background: '#ffffff',
    padding: '1px 5px', borderRadius: 3, fontSize: 10,
    border: '1px solid rgba(10,10,10,0.12)',
  };
  return (
    <div>
      <div style={h2}>Getting Started</div>
      <p style={p}>Type any question into the search bar and press Enter. fork ai generates a structured answer split into focused sections — each covering a different angle on your topic.</p>

      <div style={h2}>Mind Map</div>
      <p style={p}>Every question creates a node on the mind map (left panel). As you branch deeper, new nodes appear connected to their parent — giving you a live visual overview of your entire research tree. Drag to pan, scroll to zoom. The map re-fits automatically when you add branches.</p>

      <div style={h2}>Go Deeper</div>
      <p style={p}>Click "Go deeper" on any section to expand it into a full new answer. The new node appears on the mind map as a child of the current one. You can keep branching indefinitely.</p>

      <div style={h2}>Ask AI (from any text)</div>
      <p style={p}>Select any text in a section. A floating menu appears — click "Ask AI" to open a follow-up question using your selection as context. You can also type shortcuts into the follow-up box to pre-fill the question:</p>
      <ul style={{ paddingLeft: 16, margin: '0 0 10px' }}>
        <li style={li}><span style={code}>?</span> → "what [selection]?"</li>
        <li style={li}><span style={code}>!?</span> → "how [selection]?"</li>
        <li style={li}><span style={code}>/?</span> → "why [selection]?"</li>
        <li style={li}><span style={code}>{'>?'}</span> → "explain [selection]"</li>
      </ul>

      <div style={h2}>Highlights</div>
      <p style={p}>Select text and click "Highlight" to save it with a colour. Highlights persist across sessions and are visible to anyone with the share link. Click an existing highlight to remove it. Colour is chosen from the highlight menu — up to 4 colours available.</p>

      <div style={h2}>Notes &amp; Callouts</div>
      <p style={p}>Select text → "Save note" or "Save callout" to anchor a note to that passage. Notes appear in the Notes drawer (accessible via the drawer icon at the bottom right of any node). Notes are plain text; callouts appear as styled pull-quotes ideal for key insights.</p>

      <div style={h2}>Web Search</div>
      <p style={p}>Toggle "Web search" in the Tweaks panel to let the AI fetch up to 3 live search results per call. Useful for recent events, current data, or fast-moving topics. When active, sources are cited as numbered footnotes below the last section. Web search is off by default.</p>

      <div style={h2}>History</div>
      <p style={p}>Click the clock icon (top-left) to view all your past research sessions, grouped by date. The topic bubble cluster above the list groups sessions by keyword. Click any session card to resume it exactly where you left off — all branches, highlights, and notes are preserved.</p>

      <div style={h2}>Sharing &amp; Guest Access</div>
      <p style={p}>Click the Share button (top-right) to generate a share link. Anyone with the link can view your session, highlight text, and branch (Go Deeper / Ask AI) — their LLM calls are charged to your credit. Revoke the link at any time from the same button. Guests see a "Login to Save" button to claim their own copy of the session.</p>

      <div style={h2}>Save to Notion</div>
      <p style={p}>Click "Save to Notion" on the mind map to export your entire research tree as a structured Notion page — a Mermaid mind-map diagram at the top, followed by collapsible toggle sections for each branch. Connect your Notion workspace first via the OAuth prompt (one-time). Re-exporting after adding branches generates a fresh page; the previous export is not overwritten.</p>

      <div style={h2}>Tweaks Panel</div>
      <p style={p}>Click ⚙ (bottom-right, always visible) to open the Tweaks panel. You can drag it anywhere on screen. Options:</p>
      <ul style={{ paddingLeft: 16, margin: '0 0 10px' }}>
        <li style={li}><strong>Theme</strong> — Light or Dark</li>
        <li style={li}><strong>Density</strong> — Cozy or Compact (affects spacing and font sizes)</li>
        <li style={li}><strong>Font pairing</strong> — change the heading and body typeface</li>
        <li style={li}><strong>Mind map layout</strong> — Horizontal (default) or Vertical</li>
        <li style={li}><strong>Max sections</strong> — 4 to 8 sections per answer</li>
        <li style={li}><strong>Model</strong> — Claude (Haiku/Sonnet/Opus) or Gemini (2.5 Flash-Lite/Flash/Pro) for Go Deeper &amp; Ask AI (lighter is cheaper, top-tier most capable)</li>
        <li style={li}><strong>Web search</strong> — On or Off (see above)</li>
      </ul>

      <div style={h2}>Account &amp; Credits</div>
      <p style={p}>Click the account icon (bottom-left) to view your credit balance, usage history, and billing. Credits are prepaid in USD and consumed per LLM call based on token usage. Top up at any time via Razorpay. Unused credits do not expire. Guest branches are charged to the session owner's account.</p>

      <div style={h2}>Onboarding Tour</div>
      <p style={p}>On first login, a step-by-step walkthrough guides you through every feature with interactive tooltips. Restart it at any time via Tweaks → Onboarding → "Restart tour".</p>
    </div>
  );
}
