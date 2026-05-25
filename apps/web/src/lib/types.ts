export interface Section {
  id: string;
  heading: string;
  body: string;
}

export interface ForkNode {
  id: string;
  parentId: string | null;
  kind: 'QUERY' | 'DEEPER' | 'ASK';
  title: string;
  emoji: string | null;
  query: string;
  lede: string;
  sections: Section[];
  fromSection: string | null;
  fromText: string | null;
  createdAt: number;
  loading: boolean;
  error?: string;
}

export interface Annotation {
  id: string;
  kind: 'callout';
  text: string;
  fromTitle: string;
  nodeId: string;
  sectionId: string;
  createdAt: number;
}

export interface PersistentHighlight {
  hlId?: string;
  text: string;
  start?: number;
  end?: number;
  bg: string | null;
  fg: string | null;
}

export interface HighlightRecord {
  hlId: string;
  text: string;
  nodeId: string;
  sectionId: string;
  fromTitle: string;
}

export interface Tweaks {
  theme: 'light' | 'dark';
  accent: string;
  density: 'comfortable' | 'compact';
  mapLayout: 'vertical' | 'horizontal';
  fontPair: string;
  maxSections: number;
}

export interface HlMenuState {
  rect: { left: number; top: number; width: number; height: number; bottom: number };
  text: string;
  nodeId: string;
  sectionId: string;
  start: number;
  end: number;
}

export interface FollowUpState {
  rect: { left: number; top: number; width: number; height: number; bottom: number };
  text: string;
  nodeId: string;
  sectionId: string;
  start: number;
  end: number;
  loading: boolean;
}

export interface ContextMenuState {
  x: number;
  y: number;
  nodeId: string;
}

export interface LlmResponse {
  title: string;
  emoji: string;
  lede: string;
  sections: Array<{ heading: string; body: string }>;
}
