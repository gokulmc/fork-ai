export interface SectionItem {
  id: string;
  heading: string;
  body: string;
}

export interface BlogSubmissionItem {
  PK: string; // 'BLOGSUB'
  SK: string; // ULID id
  id: string;
  emoji: string;
  slug: string;
  authorSub: string;
  authorEmail: string;
  title: string;
  summary: string;
  body: string;
  status: 'pending' | 'approved' | 'rejected';
  createdAt: string;
}

export interface BlogViewItem {
  PK: string; // 'BLOGVIEW'
  SK: string; // post slug
  views: number;
}

export interface TrialSpendItem {
  PK: string; // TRIAL#<yyyy-mm-dd> (UTC)
  SK: string; // METADATA
  spentUsd?: number;
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
  signupIp?: string;
  signupCountry?: string;
  signupCity?: string;
  referralSlug?: string;
  referredBy?: string;
  referralCreditAwarded?: boolean;
  // Free-text user persona prepended to every LLM prompt. Absent until the user
  // first saves one — the feature is inert until then.
  persona?: string;
}

export interface ReferralItem {
  PK: string;   // REFERRAL#{slug}
  SK: string;   // METADATA
  slug: string;
  sub: string;
  email: string;
  createdAt: string;
}

export interface CreditEventItem {
  PK: string;               // USER#{sub}
  SK: string;               // CREDITEVT#{ulid}
  creditEventId: string;
  sub: string;
  type: 'REFERRAL' | 'TOPUP';
  amountUsd: number;
  createdAt: string;
}

export interface AdminAuditItem {
  PK: string;
  SK: string;
  auditId: string;
  actorSub: string;
  actorEmail: string;
  action: string;
  targetSub: string;
  detail: string;
  createdAt: string;
}

export interface UsageEventItem {
  PK: string;
  SK: string;
  usageId: string;
  sub: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  kind: 'QUERY' | 'DEEPER' | 'ASK' | 'MIX';
  model: string;
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
  isTrial?: boolean;
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
  kind: 'QUERY' | 'DEEPER' | 'ASK' | 'MIX';
  title: string;
  emoji?: string | null;
  query: string;
  lede: string;
  sections: SectionItem[];
  fromSection?: string | null;
  fromText?: string | null;
  createdAt: string;
  sources?: CitationSource[];
  model?: string; // concrete model id that produced this node
  starred?: boolean;
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
