'use client';
import { forwardRef, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import { Paperclip, ArrowUp, X as XIcon } from './Icons';

export interface ComposerAttachment {
  name: string;
  content: string;
}

export interface CodeComposerHandle {
  focus: () => void;
}

interface CodeComposerProps {
  onSubmit: (instruction: string, attachments: ComposerAttachment[]) => void;
  disabled?: boolean; // true while a run is already in flight for the active lane
}

const MAX_FILES = 3;
const MAX_FILE_BYTES = 64 * 1024;
const ACCEPT = '.txt,.md,.json,.ts,.tsx,.js,.py,.yaml,.yml,.css,.html,text/*';
const MAX_TEXTAREA_ROWS = 8;

// Bottom-docked instruction bar for spawning/continuing CODE nodes — replaces
// the old anchored CodeInstructionPopup with a persistent Claude-Code-like
// composer (see App.tsx's canSpawn(active.kind, 'CODE') render gate).
export const CodeComposer = forwardRef<CodeComposerHandle, CodeComposerProps>(function CodeComposer(
  { onSubmit, disabled },
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
  const canSend = trimmed.length > 0 && !disabled;

  function submit() {
    if (!canSend) return;
    onSubmit(trimmed, attachments);
    setText('');
    setAttachments([]);
    setAttachError(null);
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
        <div className="code-composer-row">
          <button
            type="button"
            className="code-composer-attach-btn"
            title="Attach files"
            onClick={() => fileInputRef.current?.click()}
          >
            <Paperclip size={15} />
          </button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept={ACCEPT}
            className="code-composer-file-input"
            onChange={e => { handleFiles(e.target.files); e.target.value = ''; }}
          />
          <textarea
            ref={textareaRef}
            className="code-composer-textarea"
            rows={1}
            placeholder="Describe what the agent should build…"
            value={text}
            onChange={e => setText(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                submit();
              } else if (e.key === 'Escape') {
                (e.target as HTMLTextAreaElement).blur();
              }
            }}
          />
          <button
            type="button"
            className="code-composer-send-btn"
            title="Send (Enter)"
            disabled={!canSend}
            onClick={submit}
          >
            <ArrowUp size={15} />
          </button>
        </div>
      </div>
    </div>
  );
});
