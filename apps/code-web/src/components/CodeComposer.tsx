'use client';
import { forwardRef, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import type { Tweaks } from '@/lib/types';
import { describeImage } from '@/lib/api';
import { MODEL_OPTIONS } from './TweaksPanel';
import { Paperclip, X as XIcon } from './Icons';

export interface ComposerAttachment {
  name: string;
  content: string;
}

// Local chip state — `id` is a stable key across the async describe-image
// round trip (index-based keys break once a chip earlier in the list is
// removed while another is still describing); `describing` is UI-only and
// never sent to onBuild/onAsk.
interface AttachmentChip extends ComposerAttachment {
  id: string;
  describing?: boolean;
}

export interface CodeComposerHandle {
  focus: () => void;
}

interface CodeComposerProps {
  // 'code' = active node can spawn a CODE run (Build primary, Ask ghost, tied
  // to the active commit). 'research' = a learn node with no sandbox to spawn
  // (Go-deeper primary, Ask ghost) — see fix-composer.html variant (c).
  variant: 'code' | 'research';
  idToken: string; // needed to call describeImage for image attachments
  onBuild: (instruction: string, attachments: ComposerAttachment[]) => void;
  buildDisabled?: boolean; // true while a run is already in flight for the active lane
  onAsk: (question: string, attachments: ComposerAttachment[]) => void;
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
  // #237 Phase 1a — when on, Ask appends a short turn to the current node
  // instead of spawning a child. A working preference (persisted), not a
  // per-message choice, so it lives beside the other composer pills.
  inline: boolean;
  onInlineChange: (v: boolean) => void;
}

const MAX_FILES = 3;
const MAX_FILE_BYTES = 64 * 1024;
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const ACCEPT = '.txt,.md,.json,.ts,.tsx,.js,.py,.yaml,.yml,.css,.html,text/*,image/png,image/jpeg,image/webp';
const MAX_TEXTAREA_ROWS = 8;

// Bottom-docked instruction bar — the single input for both spawning/continuing
// CODE runs (Build) and asking about the active node (Ask), or for a research
// node, going deeper / asking (see App.tsx's showComposer/showComposerResearch
// render gates). Docks as the last in-flow child of .workspace-inner (sticky —
// see .code-composer in globals.css), replacing the old anchored popup.
export const CodeComposer = forwardRef<CodeComposerHandle, CodeComposerProps>(function CodeComposer(
  {
    variant, idToken, onBuild, buildDisabled, onAsk, askDisabled, askLoading,
    onDeeper, deeperDisabled, deeperLoading,
    model, onModelChange, webSearch, onWebSearchChange, webSearchDisabled,
    inline, onInlineChange,
  },
  ref,
) {
  const [text, setText] = useState('');
  const [attachments, setAttachments] = useState<AttachmentChip[]>([]);
  const [attachError, setAttachError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const chipIdRef = useRef(0);

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
  const describing = attachments.some(a => a.describing);
  const canBuild = variant === 'code' && trimmed.length > 0 && !buildDisabled && !describing;
  const canAsk = trimmed.length > 0 && !askDisabled && !askLoading && !describing;
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
    onAsk(trimmed, attachments);
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

  // Images go through Groq describe-image (async) so the chip content is a
  // textual description the LLM prompt can use — same ComposerAttachment
  // shape as a text file, just filled in a moment later.
  async function describeImageFile(file: File) {
    const id = `img-${chipIdRef.current++}`;
    setAttachments(prev => (prev.length >= MAX_FILES ? prev : [...prev, { id, name: file.name, content: '', describing: true }]));
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
        reader.onerror = () => reject(new Error('read failed'));
        reader.readAsDataURL(file);
      });
      const { description } = await describeImage(idToken, dataUrl);
      setAttachments(prev => prev.map(a => (a.id === id ? { ...a, content: `[Image: ${file.name}]\n${description}`, describing: false } : a)));
    } catch {
      setAttachments(prev => prev.filter(a => a.id !== id));
      setAttachError(`Couldn't describe ${file.name}`);
    }
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
      if (file.type.startsWith('image/')) {
        if (file.size > MAX_IMAGE_BYTES) {
          setAttachError(`${file.name} is too large (max 4MB)`);
          continue;
        }
        void describeImageFile(file);
        continue;
      }
      if (file.size > MAX_FILE_BYTES) {
        setAttachError(`${file.name} is too large (max 64KB)`);
        continue;
      }
      const reader = new FileReader();
      reader.onload = () => {
        const content = typeof reader.result === 'string' ? reader.result : '';
        setAttachments(prev => (prev.length >= MAX_FILES ? prev : [...prev, { id: `f-${chipIdRef.current++}`, name: file.name, content }]));
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
            {attachments.map(a => (
              <span key={a.id} className="code-composer-chip">
                {a.name}
                {a.describing && (
                  <>
                    <span className="spinner" style={{ width: 9, height: 9 }} />
                    <span>describing…</span>
                  </>
                )}
                <button
                  type="button"
                  onClick={() => setAttachments(prev => prev.filter(x => x.id !== a.id))}
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
              {/* The <select> is a transparent overlay filling the whole pill so a
                  click anywhere on it opens the dropdown — a content-sized select
                  wedged between the emoji and caret only opened when you hit that
                  tiny middle strip. The visible face (pointer-events: none) shows
                  the emoji + current model + caret on top. */}
              <select value={model} onChange={e => onModelChange(e.target.value as Tweaks['branchModel'])} aria-label="Model">
                {MODEL_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
              <span className="code-composer-pill-face" aria-hidden="true">
                🤖 {MODEL_OPTIONS.find(o => o.value === model)?.label ?? model}
                <span className="code-composer-pill-caret">▾</span>
              </span>
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
            <button
              type="button"
              className={`code-composer-pill code-composer-pill--inline${inline ? ' code-composer-pill--on' : ''}`}
              title={inline ? 'Answering in this node — no new node will be created' : 'Answer here instead of creating a new node'}
              onClick={() => onInlineChange(!inline)}
            >
              ↵ inline
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
