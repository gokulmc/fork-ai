'use client';
import { useRef, useState } from 'react';
import { Search, ArrowRight, ArrowUpRight, Clock, FileText } from './Icons';
import { CookiePreferencesLink } from './CookiePreferencesLink';
import { extractText } from '@/lib/extractDocument';

interface LandingProps {
  onSubmit: (query: string) => void;
  onSubmitDocument?: (text: string, fileName: string) => void;
  loading: boolean;
  onShowHistory: () => void;
  outOfCredit?: boolean;
  initialTopics?: string[];
  loggedIn?: boolean;
  onLogin?: () => void;
}

export function Landing({ onSubmit, onSubmitDocument, loading, onShowHistory, outOfCredit, initialTopics = [], loggedIn, onLogin }: LandingProps) {
  const [q, setQ] = useState('');
  const [leaving, setLeaving] = useState(false);
  const [reading, setReading] = useState(false);
  const [ocrProgress, setOcrProgress] = useState<{ msg: string; pct: number } | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const onGo = () => {
    if (!q.trim() || loading) return;
    setLeaving(true);
    setTimeout(() => onSubmit(q.trim()), 100);
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

  return (
    <div className={`landing${leaving ? ' leaving' : ''}`}>
      <nav className="landing-nav">
        <button className="icon-btn" onClick={onShowHistory}>
          <Clock size={14} /> History
        </button>
        {!loggedIn && (
          <button className="icon-btn" onClick={onLogin}>
            <ArrowUpRight size={14} /> Login
          </button>
        )}
      </nav>

      <div className="landing-inner">
        <div className="landing-mark">A branching research workspace</div>
        <h1>Ask once. <em>Branch</em> forever.</h1>
        <p className="landing-sub">
          Type a question. Get an answer split into sections you can dive deeper into, highlight,
          and branch from. Every detour becomes a node on your mind map.
        </p>
        <div className="query-box" data-tour="tour-query">
          <span className="icon"><Search size={20} /></span>
          <input
            type="text"
            autoFocus
            value={q}
            placeholder="Try: how does photosynthesis work?"
            onChange={e => setQ(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && onGo()}
          />
          <input
            ref={fileRef}
            type="file"
            accept="application/pdf,text/plain,text/markdown,.pdf,.txt,.md,image/*"
            hidden
            onChange={onFileChange}
          />
          <button
            type="button"
            className="qb-file"
            disabled={loading || reading}
            onClick={onPickFile}
            title="Build a mind map from a PDF, image, or text file"
            aria-label="Upload a PDF, image, or text file"
          >
            {reading ? <span className="spinner" style={{ width: 14, height: 14 }} /> : <FileText size={18} />}
          </button>
          <button className="submit" disabled={!q.trim() || loading} onClick={onGo}>
            {loading ? (
              <><span className="spinner" style={{ width: 11, height: 11 }} /> Thinking…</>
            ) : (
              <>Begin <ArrowRight size={13} /></>
            )}
          </button>
        </div>

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
        FORK AI · V0.1 · BRANCHING RESEARCH, BY YOU
        <span className="landing-foot-links">
          <a href="/blog">Blog</a>
          <a href="/privacy-policy">Privacy</a>
          <a href="/terms">Terms</a>
          <CookiePreferencesLink />
        </span>
      </div>
    </div>
  );
}
