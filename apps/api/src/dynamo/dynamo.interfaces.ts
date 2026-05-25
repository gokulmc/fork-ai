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
  hasOnboarded?: boolean;
  creditUsd?: number;
}

export interface UsageEventItem {
  PK: string;
  SK: string;
  usageId: string;
  sub: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  kind: 'QUERY' | 'DEEPER' | 'ASK';
  sessionId: string;
  nodeId: string;
  createdAt: string;
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
  notionPageUrl?: string | null;
  shareToken?: string | null;
  ownerSub?: string | null;
  createdAt: string;
  updatedAt: string;
  gsi1pk: string;
  gsi1sk: string;
}

export interface ShareTokenItem {
  PK: string;
  SK: string;
  token: string;
  sessionId: string;
  ownerSub: string;
  createdAt: string;
}

export interface CitationSource {
  title: string;
  url: string;
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
  sources?: CitationSource[];
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

export interface PaymentItem {
  PK: string;
  SK: string;
  paymentId: string;
  orderId: string;
  sub: string;
  amountUsd: number;
  amountInr: number;
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
