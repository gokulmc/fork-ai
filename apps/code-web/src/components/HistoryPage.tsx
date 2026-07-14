'use client';
import { useState } from 'react';
import { Plus, Trash, Check, X } from './Icons';
import { HistoryBubbles } from './HistoryBubbles';
import { NewProjectModal } from './NewProjectModal';
import type { CreateProjectPayload, SessionSummary } from '@/lib/api';
import { stripCite, relativeTime } from '@/lib/utils';
import { BRAND_TAGLINE } from '@/lib/brand';

interface HistoryPageProps {
  sessions: SessionSummary[];
  loading: boolean;
  onLoadSession: (sessionId: string) => void;
  onDeleteSession: (sessionId: string) => void;
  idToken: string;
  onCreateProject: (payload: CreateProjectPayload) => Promise<void>;
}

function dayKey(iso: string): string {
  const d = new Date(iso);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).toISOString();
}

// Recency dot on the card — the grid's primary momentum signal (day dividers
// already carry the coarse "Today"/"Yesterday" grouping; this adds a finer cue).
const RECENT_ACTIVITY_MS = 24 * 60 * 60 * 1000;
function isRecentlyActive(iso: string): boolean {
  return Date.now() - new Date(iso).getTime() < RECENT_ACTIVITY_MS;
}

function dividerLabel(dayIso: string): string {
  const d = new Date(dayIso);
  const today = new Date();
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const diffDays = Math.round((startOfToday.getTime() - d.getTime()) / 86_400_000);
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return d.toLocaleDateString(undefined, { weekday: 'long' });
  if (d.getFullYear() === today.getFullYear()) {
    return d.toLocaleDateString(undefined, { month: 'long', day: 'numeric' });
  }
  return d.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
}

export function HistoryPage({ sessions, loading, onLoadSession, onDeleteSession, idToken, onCreateProject }: HistoryPageProps) {
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set());
  const [showModal, setShowModal] = useState(false);
  // Arms a card for delete confirmation; reset on rerender (e.g. list refresh) is fine
  // since it's a transient UI state, not something that needs to survive a re-fetch.
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  const groups: Array<{ day: string; items: SessionSummary[] }> = [];
  for (const s of sessions) {
    const day = dayKey(s.updatedAt);
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.items.push(s);
    else groups.push({ day, items: [s] });
  }

  const isEmpty = !loading && sessions.length === 0;

  return (
    <div className="history-page">
      <header className="history-topbar">
        <div style={{ flex: 1 }} />
        <button className="proj-btn-primary" onClick={() => setShowModal(true)}>
          <Plus size={14} /> New project
        </button>
      </header>

      {isEmpty ? (
        <div className="history-game-wrapper">
          <p className="history-game-tagline">Nothing here yet</p>
          <p className="history-game-sub">{BRAND_TAGLINE}</p>
        </div>
      ) : (
        <div className="history-body">
          <div className="history-title">
            <h2>Projects</h2>
            <p className="history-sub">Every project tracks one repo. Branch into learn nodes, plan nodes, and code runs from any commit.</p>
          </div>

          {loading ? (
            <div className="history-loading">
              <span className="spinner" style={{ width: 22, height: 22 }} />
            </div>
          ) : (
            <>
              <HistoryBubbles sessions={sessions} onLoadSession={onLoadSession} />
              <div className="history-groups">
              {groups.map(group => (
                <section key={group.day} className="history-group">
                  <div className="history-divider">
                    <span className="history-divider-label">{dividerLabel(group.day)}</span>
                    <span className="history-divider-line" />
                  </div>
                  <div className="project-grid">
                    {group.items.map(s => {
                      const isDeleting = deletingIds.has(s.sessionId);
                      return (
                        <div
                          key={s.sessionId}
                          className="project-card"
                          role="button"
                          tabIndex={0}
                          onClick={() => onLoadSession(s.sessionId)}
                          onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') onLoadSession(s.sessionId); }}
                        >
                          {confirmingId === s.sessionId ? (
                            <div
                              className="project-card-confirm"
                              // Disarm when focus leaves the whole confirm group (click elsewhere,
                              // tab away) — relatedTarget is null for a mouse click outside any
                              // focusable element, which also correctly disarms.
                              onBlur={e => {
                                if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
                                  setConfirmingId(null);
                                }
                              }}
                              onKeyDown={e => {
                                if (e.key === 'Escape') { e.stopPropagation(); setConfirmingId(null); }
                              }}
                            >
                              <span className="project-card-confirm-label">Delete?</span>
                              <button
                                className="project-card-confirm-btn project-card-confirm-yes"
                                aria-label="Confirm delete"
                                title="Confirm delete"
                                onClick={e => {
                                  e.stopPropagation();
                                  setConfirmingId(null);
                                  setDeletingIds(prev => new Set(prev).add(s.sessionId));
                                  onDeleteSession(s.sessionId);
                                }}
                              >
                                <Check size={13} />
                              </button>
                              <button
                                className="project-card-confirm-btn project-card-confirm-no"
                                aria-label="Cancel delete"
                                title="Cancel"
                                // Autofocus the safe (cancel) action: gives the group focus so the
                                // onBlur-outside-click handler above can fire, and means a stray
                                // Enter keypress cancels rather than deletes.
                                autoFocus
                                onClick={e => { e.stopPropagation(); setConfirmingId(null); }}
                              >
                                <X size={13} />
                              </button>
                            </div>
                          ) : (
                            // Revealed on hover/focus-within (see .project-card-del in globals.css) —
                            // keeps the grid calm; :focus-within keeps it reachable by keyboard.
                            <button
                              className="project-card-del"
                              aria-label="Delete project"
                              title="Delete project"
                              disabled={isDeleting}
                              onClick={e => {
                                e.stopPropagation();
                                setConfirmingId(s.sessionId);
                              }}
                            >
                              {isDeleting
                                ? <span className="spinner" style={{ width: 12, height: 12 }} />
                                : <Trash size={13} />}
                            </button>
                          )}
                          <div className="project-card-head">
                            <span className="project-card-emoji">{s.emoji}</span>
                            <div className="project-card-title">{s.title}</div>
                          </div>
                          {s.repoRef && (
                            <div className="project-card-repo">{s.repoRef.owner}/{s.repoRef.repo}</div>
                          )}
                          <div className="project-card-lede">{stripCite(s.lede)}</div>
                          <div className="project-card-footer">
                            {/* Degrade path: a bare session or a zero-commit fresh project has no
                                branchCount — omit the badge entirely rather than show "0 branches". */}
                            {!!s.branchCount && (
                              <>
                                <span>{s.branchCount} branch{s.branchCount !== 1 ? 'es' : ''}</span>
                                <span className="project-card-footer-sep" aria-hidden="true">·</span>
                              </>
                            )}
                            {isRecentlyActive(s.updatedAt) && (
                              <span className="project-card-recency" aria-hidden="true" title="Active in the last day" />
                            )}
                            <span title={new Date(s.updatedAt).toLocaleString()}>{relativeTime(s.updatedAt)}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </section>
              ))}
              </div>
            </>
          )}
        </div>
      )}

      {!isEmpty && <div className="landing-foot">{BRAND_TAGLINE}</div>}

      {showModal && (
        <NewProjectModal
          idToken={idToken}
          onClose={() => setShowModal(false)}
          onCreate={async payload => {
            await onCreateProject(payload);
            setShowModal(false);
          }}
        />
      )}
    </div>
  );
}
