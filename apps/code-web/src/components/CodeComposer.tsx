'use client';
import { forwardRef, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import type { Tweaks } from '@/lib/types';
import { MODEL_OPTIONS } from './TweaksPanel';
import { Paperclip, X as XIcon } from './Icons';

export interface ComposerAttachment {
  name: string;
  content: string;
}

export interface CodeComposerHandle {
  focus: () => void;
}

interface CodeComposerProps {
  // 'code' = active node can spawn a CODE run (Build primary, Ask ghost, tied
  // to the active commit). 'research' = a learn node with no sandbox to spawn
  // (Go-deeper primary, Ask ghost) — see fix-composer.html variant (c).
  variant: 'code' | 'research';
  onBuild: (instruction: string, attachments: ComposerAttachment[]) => void;
  buildDisabled?: boolean; // true while a run is already in flight for the active lane
  onAsk: (question: string) => void;
  askDisabled?: boolean; // 'code' variant: no commitSha yet to ask about
  askLoading?: boolean;
  onDeeper?: () => void; // 'research' variant only — deepens the node's last section
  deeperDisabled?: boolean;
  deeperLoading?: boolean;
  model: Tweaks['branchModel'];
  onModelChange: (m: Tweaks['branchModel']) => void;
  webSearch: boolean;
  onWebSearchChange: (v: boolean) => void;
  // Web search has no effect on a CODE run (no backend param for it) — greyed
  // the same way the tweaks panel greys it out for DeepSeek's unsupported case.
  webSearchDisabled?: boolean;
}

const MAX_FILES = 3;
const MAX_FILE_BYTES = 64 * 1024;
const ACCEPT = '.txt,.md,.json,.ts,.tsx,.js,.py,.yaml,.yml,.css,.html,text/*';
const MAX_TEXTAREA_ROWS = 8;

// Bottom-docked instruction bar — the single input for both spawning/continuing
// CODE runs (Build) and asking about the active node (Ask), or for a research
// node, going deeper / asking (see App.tsx's showComposer/showComposerResearch
// render gates). Docks as the last in-flow child of .workspace-inner (sticky —
// see .code-composer in globals.css), replacing the old anchored popup.
export const CodeComposer = forwardRef<CodeComposerHandle, CodeComposerProps>(function CodeComposer(
  {
    variant, onBuild, buildDisabled, onAsk, askDisabled, askLoading,
    onDeeper, deeperDisabled, deeperLoading,
    model, onModelChange, webSearch, onWebSearchChange, webSearchDisabled,
  },
  ref,
) {
  const [text, setText] = useState('');
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);
  const [attachError, setAttachError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useImperativeHandle(ref, () => ({
    focus: () => textareaRef.current?.focus(),
  }), []);

  // Auto-grow 1→8 rows: reset to 'auto' first so shrinking (e.g. after a
  // submit clears the text) re-measures from zero instead of only ever growing.
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const lineHeight = parseFloat(getComputedStyle(el).lineHeight) || 20;
    el.style.height = `${Math.min(el.scrollHeight, lineHeight * MAX_TEXTAREA_ROWS)}px`;
  }, [text]);

  const trimmed = text.trim();
  const canBuild = variant === 'code' && trimmed.length > 0 && !buildDisabled;
  const canAsk = trimmed.length > 0 && !askDisabled && !askLoading;
  const canDeeper = variant === 'research' && !deeperDisabled && !deeperLoading;

  function doBuild() {
    if (!canBuild) return;
    onBuild(trimmed, attachments);
    setText('');
    setAttachments([]);
    setAttachError(null);
  }
  function doAsk() {
    if (!canAsk) return;
    onAsk(trimmed);
    setText('');
    setAttachments([]);
    setAttachError(null);
  }
  function doDeeper() {
    if (!canDeeper) return;
    onDeeper?.();
    // Go-deeper doesn't consume the textarea (it expands the last section, not
    // typed text) — leave whatever's typed in place.
  }

  function handleFiles(fileList: FileList | null) {
    if (!fileList?.length) return;
    setAttachError(null);
    const incoming = Array.from(fileList);
    if (attachments.length + incoming.length > MAX_FILES) {
      setAttachError(`Up to ${MAX_FILES} files at a time`);
      return;
    }
    for (const file of incoming) {
      if (file.size > MAX_FILE_BYTES) {
        setAttachError(`${file.name} is too large (max 64KB)`);
        continue;
      }
      const reader = new FileReader();
      reader.onload = () => {
        const content = typeof reader.result === 'string' ? reader.result : '';
        setAttachments(prev => (prev.length >= MAX_FILES ? prev : [...prev, { name: file.name, content }]));
      };
      reader.onerror = () => setAttachError(`Couldn't read ${file.name}`);
      reader.readAsText(file);
    }
  }

  // Enter reaches the visually-primary action; ⌘/Ctrl+Enter always reaches the
  // other one. 'code': Build is primary (Ask still reachable via ⌘Enter or its
  // own button, gated on askDisabled). 'research': neither action can lose
  // typed text, so Enter follows the text itself — Ask if there's a question
  // typed (nothing to type for Go-deeper, which acts on the last section), else
  // Go-deeper; ⌘Enter always reaches the other one.
  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Escape') { (e.target as HTMLTextAreaElement).blur(); return; }
    if (e.key !== 'Enter' || e.shiftKey) return;
    e.preventDefault();
    if (variant === 'code') {
      if (e.metaKey || e.ctrlKey) doAsk(); else doBuild();
      return;
    }
    const preferAsk = trimmed.length > 0;
    if (e.metaKey || e.ctrlKey) { if (preferAsk) doDeeper(); else doAsk(); }
    else { if (preferAsk) doAsk(); else doDeeper(); }
  }

  const placeholder = variant === 'code' ? 'Describe what the agent should build…' : 'Ask a question, or go deeper on this section…';

  return (
    <div className="code-composer">
      <div className="code-composer-inner">
        {(attachments.length > 0 || attachError) && (
          <div className="code-composer-chips">
            {attachments.map((a, i) => (
              <span key={`${a.name}-${i}`} className="code-composer-chip">
                {a.name}
                <button
                  type="button"
                  onClick={() => setAttachments(prev => prev.filter((_, j) => j !== i))}
                  aria-label={`Remove ${a.name}`}
                >
                  <XIcon size={10} />
                </button>
              </span>
            ))}
            {attachError && <span className="code-composer-chip code-composer-chip--error">{attachError}</span>}
          </div>
        )}
        <textarea
          ref={textareaRef}
          className="code-composer-textarea"
          rows={1}
          placeholder={placeholder}
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <div className="code-composer-row--controls">
          <div className="code-composer-row-left">
            <button
              type="button"
              className="code-composer-attach-btn"
              title="Attach files"
              onClick={() => fileInputRef.current?.click()}
            >
              <Paperclip size={13} />
            </button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept={ACCEPT}
              className="code-composer-file-input"
              onChange={e => { handleFiles(e.target.files); e.target.value = ''; }}
            />
            <label className="code-composer-pill code-composer-pill--select" title="Model for this branch">
              🤖
              <select value={model} onChange={e => onModelChange(e.target.value as Tweaks['branchModel'])} aria-label="Model">
                {MODEL_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
              <span className="code-composer-pill-caret">▾</span>
            </label>
            <button
              type="button"
              className={`code-composer-pill${webSearch ? ' code-composer-pill--on' : ''}`}
              disabled={webSearchDisabled}
              title={webSearchDisabled ? "Web search doesn't apply here" : 'Toggle web search'}
              onClick={() => onWebSearchChange(!webSearch)}
            >
              🔍 Web
            </button>
          </div>
          <div className="code-composer-row-right">
            {variant === 'code' ? (
              <>
                <button type="button" className="code-composer-action-btn code-composer-action-btn--ghost" disabled={!canAsk} title="Ask about this commit (⌘/Ctrl+Enter)" onClick={doAsk}>
                  {askLoading ? <span className="spinner" style={{ width: 11, height: 11 }} /> : 'Ask'}
                </button>
                <button type="button" className="code-composer-action-btn code-composer-action-btn--primary" disabled={!canBuild} title="Build (Enter)" onClick={doBuild}>
                  Build <span aria-hidden="true">↑</span>
                </button>
              </>
            ) : (
              <>
                <button type="button" className="code-composer-action-btn code-composer-action-btn--ghost" disabled={!canAsk} title="Ask a question" onClick={doAsk}>
                  {askLoading ? <span className="spinner" style={{ width: 11, height: 11 }} /> : 'Ask'}
                </button>
                <button type="button" className="code-composer-action-btn code-composer-action-btn--primary" disabled={!canDeeper} title="Go deeper on the last section" onClick={doDeeper}>
                  {deeperLoading ? <span className="spinner" style={{ width: 11, height: 11 }} /> : 'Go deeper'}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
});
