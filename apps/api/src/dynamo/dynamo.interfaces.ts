export interface SectionItem {
  id: string;
  heading: string;
  body: string;
}

export interface UserMetaItem {
  PK: string;
  SK: string;
  sub: string;
  email: string;
  createdAt: string;
  updatedAt: string;
  notionAccessToken?: string | null;
}

export interface SessionMetaItem {
  PK: string;
  SK: string;
  sessionId: string;
  title: string;
  emoji: string;
  lede: string;
  rootNodeId: string;
  nodeCount: number;
  createdAt: string;
  updatedAt: string;
  gsi1pk: string;
  gsi1sk: string;
}

export interface NodeItem {
  PK: string;
  SK: string;
  nodeId: string;
  parentId?: string | null;
  kind: 'QUERY' | 'DEEPER' | 'ASK';
  title: string;
  emoji?: string | null;
  query: string;
  lede: string;
  sections: SectionItem[];
  fromSection?: string | null;
  fromText?: string | null;
  createdAt: string;
}

export interface AnnotationItem {
  PK: string;
  SK: string;
  annId: string;
  kind: 'note' | 'callout';
  text: string;
  fromTitle: string;
  nodeId: string;
  sectionId: string;
  createdAt: string;
}

export interface HighlightItem {
  PK: string;
  SK: string;
  hlId: string;
  nodeId: string;
  sectionId: string;
  text: string;
  start?: number | null;
  end?: number | null;
  bg?: string | null;
  fg?: string | null;
  createdAt: string;
}
