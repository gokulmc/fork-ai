'use client';
import { useRef, useState } from 'react';
import { ArrowUpRight, Clock, Plus } from './Icons';
import { CookiePreferencesLink } from './CookiePreferencesLink';
import { QueryBox } from './QueryBox';
import { extractText } from '@/lib/extractDocument';
import { SKILL_PLUGINS, HARNESS_PLUGINS } from '@/lib/mockGithub';
import { BRAND_TAGLINE } from '@/lib/brand';

interface LandingProps {
  onSubmit: (query: string, plugins: string[]) => void;
  onSubmitDocument?: (text: string, fileName: string) => void;
  loading: boolean;
  onShowHistory: () => void;
  outOfCredit?: boolean;
  initialTopics?: string[];
  loggedIn?: boolean;
  onLogin?: () => void;
  // Authed only — opens the "attach an existing GitHub repo" modal that
  // HistoryPage also hosts. Absent for a logged-out visitor.
  onOpenNewProject?: () => void;
}

export function Landing({ onSubmit, onSubmitDocument, loading, onShowHistory, outOfCredit, initialTopics = [], loggedIn, onLogin, onOpenNewProject }: LandingProps) {
  const [q, setQ] = useState('');
  const [plugins, setPlugins] = useState<Set<string>>(new Set());
  const [leaving, setLeaving] = useState(false);
  const [reading, setReading] = useState(false);
  const [ocrProgress, setOcrProgress] = useState<{ msg: string; pct: number } | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const dragCountRef = useRef(0);

  const onGo = () => {
    if (!q.trim() || loading) return;
    setLeaving(true);
    setTimeout(() => onSubmit(q.trim(), [...plugins]), 100);
  };

  const togglePlugin = (id: string) => {
    setPlugins(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const processFile = async (file: File) => {
    setReading(true);
    setOcrProgress(null);
    setFileError(null);
    try {
      const { text } = await extractText(file, (msg, pct) => setOcrProgress({ msg, pct }));
      if (text.trim().length < 200) {
        setFileError("Couldn't extract readable text — try a clearer scan or a different file.");
        return;
      }
      setLeaving(true);
      setTimeout(() => onSubmitDocument?.(text, file.name), 100);
    } catch (err) {
      setFileError(err instanceof Error ? err.message : 'Could not read that file');
    } finally {
      setReading(false);
      setOcrProgress(null);
    }
  };

  const onDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    dragCountRef.current++;
    if (e.dataTransfer.items[0]?.kind === 'file') setDragOver(true);
  };

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  };

  const onDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    dragCountRef.current--;
    if (dragCountRef.current === 0) setDragOver(false);
  };

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    dragCountRef.current = 0;
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (!file) return;
    if (loading || reading) return;
    if (!loggedIn) { onLogin?.(); return; }
    await processFile(file);
  };

  const onPickFile = () => {
    if (loading || reading) return;
    if (!loggedIn) { onLogin?.(); return; }
    setFileError(null);
    fileRef.current?.click();
  };

  const onFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    await processFile(file);
  };

  return (
    <div className={`landing${leaving ? ' leaving' : ''}`}>
      <nav className="landing-nav">
        <button className="icon-btn" onClick={onShowHistory}>
          <Clock size={14} /> History
        </button>
        {loggedIn && onOpenNewProject && (
          <button className="icon-btn" onClick={onOpenNewProject}>
            <Plus size={14} /> New project
          </button>
        )}
        {!loggedIn && (
          <button className="icon-btn" onClick={onLogin}>
            <ArrowUpRight size={14} /> Login
          </button>
        )}
      </nav>

      <div
        className="landing-inner"
        onDragEnter={onDragEnter}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
        <div className="landing-mark">Plan-first coding, by you</div>
        <h1>Program like an actual programmer.<em>One shot never works.</em></h1>
        <p className="landing-sub">
          Learn the concepts, synthesize a plan, then watch the agent commit one focused step at a
          time — reviewable, branchable, never a single unreviewable mega-diff.
        </p>
        <QueryBox
          value={q}
          onChange={setQ}
          onSubmit={onGo}
          placeholder="Try: add rate limiting to my API"
          loading={loading}
          autoFocus
          onPickFile={onPickFile}
          fileBusy={reading}
          className={dragOver ? ' drag-over' : ''}
        >
          <input
            ref={fileRef}
            type="file"
            accept="application/pdf,text/plain,text/markdown,.pdf,.txt,.md,image/*"
            hidden
            onChange={onFileChange}
          />
          {loggedIn && q.trim().length > 0 && !leaving && (
            <div className="plugin-drop" role="group" aria-label="Skills and harnesses">
              <div className="plugin-drop-head">
                <span className="plugin-drop-title">Set up your repo</span>
                <span className="plugin-drop-count">{plugins.size > 0 ? `${plugins.size} selected` : 'optional'}</span>
              </div>
              <div className="plugin-drop-cols">
                {[{ label: 'Skills', items: SKILL_PLUGINS }, { label: 'Harnesses', items: HARNESS_PLUGINS }].map(g => (
                  <div className="plugin-drop-col" key={g.label}>
                    <div className="plugin-drop-kicker">{g.label}</div>
                    {g.items.map(p => (
                      <button
                        key={p.id}
                        type="button"
                        title={p.desc}
                        aria-pressed={plugins.has(p.id)}
                        className={`plugin-row${plugins.has(p.id) ? ' on' : ''}`}
                        onMouseDown={e => e.preventDefault()}
                        onClick={() => togglePlugin(p.id)}
                      >
                        <span className="plugin-row-icon">{p.icon}</span>
                        <span className="plugin-row-name">{p.name}</span>
                        <span className="plugin-row-check" aria-hidden="true">✓</span>
                      </button>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          )}
        </QueryBox>

        {dragOver && (
          <div className="drop-hint">Drop to build a mind map from this file</div>
        )}
        {ocrProgress && (
          <div className="ocr-progress">
            <div className="ocr-progress-track">
              <div className="ocr-progress-bar" style={{ width: `${Math.round(ocrProgress.pct * 100)}%` }} />
            </div>
            <div className="ocr-progress-label">{ocrProgress.msg}</div>
          </div>
        )}
        {outOfCredit && !ocrProgress && (
          <div style={{ marginTop: 10, fontSize: 11, color: '#c0392b', letterSpacing: '0.04em', fontFamily: "ui-monospace,'JetBrains Mono','SF Mono',Menlo,monospace" }}>
            Out of credit — open Billing in account settings to recharge.
          </div>
        )}
        {fileError && (
          <div style={{ marginTop: 10, fontSize: 11, color: '#c0392b', letterSpacing: '0.04em', fontFamily: "ui-monospace,'JetBrains Mono','SF Mono',Menlo,monospace" }}>
            {fileError}
          </div>
        )}
        <div className="examples">
          {initialTopics.map(ex => (
            <button key={ex} className="chip" title={ex} onClick={() => setQ(ex)}>{ex}</button>
          ))}
        </div>
      </div>
      <div className="landing-foot">
        {BRAND_TAGLINE}
        <span className="landing-foot-links">
          <a href="/privacy-policy">Privacy</a>
          <a href="/terms">Terms</a>
          <CookiePreferencesLink />
        </span>
      </div>
    </div>
  );
}
