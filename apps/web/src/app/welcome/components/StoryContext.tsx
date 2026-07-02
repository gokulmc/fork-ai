'use client';
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { SOURCES } from './storyContent';

export interface StoryNode {
  id: string;
  parentId: string | null;
  label: string;
  kind: 'story' | 'visitor' | 'guest';
  ring?: boolean;
  satellites?: number;
  // Renders as a solid filled circle (every other node is outlined) — set
  // only on the Mixer's synthesis node, everywhere it's drawn.
  mix?: boolean;
}

interface VisitorActions {
  branches: number;
  estCostUsd: number;
}

interface StoryContextValue {
  nodes: StoryNode[];
  addNode: (node: StoryNode) => void;
  ensureStoryNodes: () => void;
  visitorActions: VisitorActions;
  recordVisitorBranch: (costUsd: number) => void;
}

const StoryContext = createContext<StoryContextValue | null>(null);

// The full "story" (non-visitor) node set — every node a scene along the
// scroll would normally add one at a time. Fast scrollers who jump straight
// to a map scene (ScenePullback / SceneMix / SceneMorning) via anchor link
// or quick flick miss those per-scene mounts entirely, so those three scenes
// call ensureStoryNodes() on entering view as a catch-up. Idempotent by
// construction (addNode already dedupes by id).
const STORY_NODES: StoryNode[] = [
  { id: 'root', parentId: null, label: 'Alex’s question', kind: 'story' },
  { id: 'moderating-factors', parentId: 'root', label: 'Moderating factors', kind: 'story' },
  { id: 'web-branch', parentId: 'root', label: 'Stress biomarkers: meta-evidence', kind: 'story', satellites: SOURCES.length },
];

export function StoryProvider({ children }: { children: ReactNode }) {
  const [nodes, setNodes] = useState<StoryNode[]>([]);
  const [visitorActions, setVisitorActions] = useState<VisitorActions>({ branches: 0, estCostUsd: 0 });

  const addNode = useCallback((node: StoryNode) => {
    setNodes(prev => (prev.some(n => n.id === node.id) ? prev : [...prev, node]));
  }, []);

  const ensureStoryNodes = useCallback(() => {
    setNodes(prev => {
      const missing = STORY_NODES.filter(sn => !prev.some(n => n.id === sn.id));
      return missing.length ? [...prev, ...missing] : prev;
    });
  }, []);

  const recordVisitorBranch = useCallback((costUsd: number) => {
    setVisitorActions(prev => ({ branches: prev.branches + 1, estCostUsd: prev.estCostUsd + costUsd }));
  }, []);

  const value = useMemo(
    () => ({ nodes, addNode, ensureStoryNodes, visitorActions, recordVisitorBranch }),
    [nodes, addNode, ensureStoryNodes, visitorActions, recordVisitorBranch]
  );

  return <StoryContext.Provider value={value}>{children}</StoryContext.Provider>;
}

export function useStory() {
  const ctx = useContext(StoryContext);
  if (!ctx) throw new Error('useStory must be used within a StoryProvider');
  return ctx;
}
