import { randomBytes } from 'crypto';
import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { ulid } from 'ulid';
import { DynamoRepository } from '@/dynamo/dynamo.repository';
import type { NodeItem, AnnotationItem, HighlightItem, SessionMetaItem } from '@/dynamo/dynamo.interfaces';
import { LlmService } from '@/llm/llm.service';
import { ROOT_MODEL, resolveBranchModel } from '@/llm/models';
import { UsersService } from '@/users/users.service';
import { LEARN_KINDS, assertKindAllowed } from '@/nodes/node-grammar';
import type { NodeKind } from '@/llm/llm.types';
import { CreateSessionDto } from './dto/create-session.dto';
import { CreateDocumentDto } from './dto/create-document.dto';
import { UpdateSessionDto } from './dto/update-session.dto';

export interface ProjectSeedCommit {
  sha: string;
  message: string;
  date: string;
}

// What a Project passes to createProjectSession to seed its map. `imported`
// marks a real repo fetch (GitHub) vs. a synthesized/mock repo — see
// createProjectSession for how it combines with `first` to decide whether the
// root node is marked imported.
export interface ProjectSeed {
  defaultBranch: string;
  first: ProjectSeedCommit | null;
  head: ProjectSeedCommit | null;
  imported: boolean;
}

export interface SessionSummary {
  sessionId: string;
  title: string;
  emoji: string;
  lede: string;
  createdAt: string;
  updatedAt: string;
  nodeCount: number;
  highlightCount: number;
  // Set when this session is a Project's map (see ProjectsService.create).
  projectId?: string;
}

export interface FullSession extends SessionSummary {
  nodes: NodeItem[];
  annotations: AnnotationItem[];
  highlights: HighlightItem[];
}

@Injectable()
export class SessionsService {
  constructor(
    private readonly db: DynamoRepository,
    private readonly llm: LlmService,
    private readonly users: UsersService,
  ) {}

  private readonly logger = new Logger(SessionsService.name);

  // A DynamoDB Query returns ≤1MB/page; queryNodes now paginates via .all(), so
  // a large session loads correctly but costs extra round-trips + a heavy payload.
  // Warn once it crosses ~80% of the single-page limit so we get an early signal
  // of when incremental node loading becomes worth building (vs. full-session load).
  private static readonly LARGE_SESSION_WARN_BYTES = 800_000;

  private warnIfLarge(sessionId: string, nodes: NodeItem[], annotations: AnnotationItem[], highlights: HighlightItem[]): void {
    const bytes = Buffer.byteLength(JSON.stringify(nodes)) +
      Buffer.byteLength(JSON.stringify(annotations)) +
      Buffer.byteLength(JSON.stringify(highlights));
    if (bytes >= SessionsService.LARGE_SESSION_WARN_BYTES) {
      this.logger.warn(`Large session load: ${sessionId} — ${nodes.length} nodes, ~${Math.round(bytes / 1024)}KB (crossed single-page Query limit; multi-page read)`);
    }
  }

  private userPk(sub: string) { return `USER#${sub}`; }
  private sessionSk(sessionId: string) { return `SESSION#${sessionId}`; }

  // Placeholder title shown until the LLM streams the real one. The query is now
  // unbounded, so cap the display copy and mark the truncation with an ellipsis.
  private tempTitle(query: string) { return query.length > 60 ? query.slice(0, 60) + '…' : query; }

  async createStreaming(
    sub: string,
    dto: CreateSessionDto,
    send: (data: object) => void,
  ): Promise<void> {
    await this.users.checkCredit(sub);

    const sessionId = ulid();
    const nodeId = ulid();
    const now = new Date().toISOString();

    // Writes to a disconnected client throw — swallow so the LLM loop still
    // completes and the full result is persisted even if the user navigated away.
    const emit = (data: object) => { try { send(data); } catch { /* client gone */ } };

    const rootNode: NodeItem = {
      PK: `SESSION#${sessionId}`,
      SK: `NODE#${nodeId}`,
      nodeId,
      parentId: null,
      kind: 'QUERY',
      title: this.tempTitle(dto.query),
      emoji: null,
      query: dto.query,
      lede: '',
      sections: [],
      fromSection: null,
      fromText: null,
      createdAt: now,
      model: ROOT_MODEL,
    };
    const sessionMeta: SessionMetaItem = {
      PK: this.userPk(sub),
      SK: this.sessionSk(sessionId),
      sessionId,
      title: this.tempTitle(dto.query),
      emoji: '',
      lede: '',
      rootNodeId: nodeId,
      nodeCount: 1,
      createdAt: now,
      updatedAt: now,
      gsi1pk: this.userPk(sub),
      gsi1sk: `UPDATED#${now}`,
    };

    // Persist the session up-front and tell the client its id NOW (the `init`
    // event), so the URL updates immediately and a refresh mid-stream restores
    // the real session instead of dropping to Landing. Filled in as it streams.
    await Promise.all([this.db.putNode(rootNode), this.db.putSessionMeta(sessionMeta)]);
    emit({ type: 'init', sessionId, nodeId });

    await this.runRootQueryStream(sub, sessionId, rootNode, dto, emit);
  }

  // Root-query streaming into an EXISTING session — a Project's map is seeded
  // by ProjectsService (createProjectSession) with a CODE root (+ optional HEAD
  // node), so its first learn question lands here rather than POST
  // /sessions/stream, which always mints a fresh session.
  //
  // Two shapes, depending on what's already in the session:
  //  - zero nodes (legacy — a pre-D1 project, or any other bare session): the
  //    original behaviour, unchanged — a fresh QUERY root with parentId null.
  //  - a seeded CODE root (D1) and no learn node yet: the "first question"
  //    route (D2) — the new QUERY node hangs off the CODE root instead of
  //    starting a second tree, and the session title (the project name) is
  //    left untouched since this isn't a fresh root query.
  async createRootNodeStreaming(
    sub: string,
    sessionId: string,
    dto: CreateSessionDto,
    send: (data: object) => void,
  ): Promise<void> {
    await this.users.checkCredit(sub);

    // All guards run before any SSE write (the controller surfaces these as a
    // real 4xx, not an error event inside a 200 stream).
    const meta = await this.db.getSessionMeta(sub, sessionId);
    if (!meta) throw new NotFoundException(`Session ${sessionId} not found`);
    const existing = await this.db.queryNodes(sessionId);

    if (existing.length === 0) {
      const nodeId = ulid();
      const now = new Date().toISOString();
      const emit = (data: object) => { try { send(data); } catch { /* client gone */ } };

      const rootNode: NodeItem = {
        PK: `SESSION#${sessionId}`,
        SK: `NODE#${nodeId}`,
        nodeId,
        parentId: null,
        kind: 'QUERY',
        title: this.tempTitle(dto.query),
        emoji: null,
        query: dto.query,
        lede: '',
        sections: [],
        fromSection: null,
        fromText: null,
        createdAt: now,
        model: ROOT_MODEL,
      };

      // Persist-first, but the SessionMeta row already exists and may carry
      // projectId — so this is a PARTIAL update, never a putSessionMeta full
      // replace, which would silently drop the project linkage.
      await Promise.all([
        this.db.putNode(rootNode),
        this.db.updateSessionMeta(sub, sessionId, {
          title: this.tempTitle(dto.query),
          nodeCount: 1,
          updatedAt: now,
          gsi1sk: `UPDATED#${now}`,
        }),
      ]);
      emit({ type: 'init', sessionId, nodeId });

      await this.runRootQueryStream(sub, sessionId, rootNode, dto, emit);
      return;
    }

    // Fill-root (D1/D3): a from-scratch ("new repo") project seeds a BRANCH
    // root carrying the user's opening question with empty sections — the LLM
    // answer streams INTO that node itself (same runRootQueryStream machinery,
    // same event vocabulary), rather than spawning a QUERY child, so the root
    // ends up looking exactly like a normal root query once it's filled in.
    // Only allowed once — a filled root can't be re-filled.
    const rootNodeExisting = existing.find((n) => n.parentId === null);
    if (rootNodeExisting?.kind === 'BRANCH') {
      if (rootNodeExisting.sections.length > 0) {
        throw new BadRequestException('Root BRANCH node already has content — the fill-root route can only run once');
      }
      const emit = (data: object) => { try { send(data); } catch { /* client gone */ } };
      emit({ type: 'init', sessionId, nodeId: rootNodeExisting.nodeId });
      await this.runRootQueryStream(sub, sessionId, rootNodeExisting, dto, emit);
      return;
    }

    // Seeded project session (D1): the first learn question anchors under the
    // CODE root instead of minting a new tree. Only allowed once — a session
    // that already has a learn node has already used this route.
    if (existing.some((n) => LEARN_KINDS.includes(n.kind as NodeKind))) {
      throw new BadRequestException('Session already has a learn node — the first-question route can only run once');
    }

    const parentId = meta.rootNodeId || existing.find((n) => n.parentId === null)?.nodeId;
    const parentNode = parentId ? existing.find((n) => n.nodeId === parentId) : undefined;
    if (!parentNode) throw new NotFoundException(`Session ${sessionId} has no root node to anchor the first question`);
    assertKindAllowed(parentNode.kind as NodeKind, 'QUERY');

    const nodeId = ulid();
    const now = new Date().toISOString();
    const emit = (data: object) => { try { send(data); } catch { /* client gone */ } };

    const rootNode: NodeItem = {
      PK: `SESSION#${sessionId}`,
      SK: `NODE#${nodeId}`,
      nodeId,
      parentId,
      kind: 'QUERY',
      title: this.tempTitle(dto.query),
      emoji: null,
      query: dto.query,
      lede: '',
      sections: [],
      fromSection: null,
      fromText: null,
      createdAt: now,
      model: ROOT_MODEL,
    };

    // Keep the project name as the session title — this is a branch off the
    // seeded map, not a fresh root query, so nothing about the query text
    // belongs in SessionMeta; only the node count/activity timestamp move.
    await Promise.all([
      this.db.putNode(rootNode),
      this.db.updateSessionMeta(sub, sessionId, {
        nodeCount: existing.length + 1,
        updatedAt: now,
        gsi1sk: `UPDATED#${now}`,
      }),
    ]);
    emit({ type: 'init', sessionId, nodeId });

    await this.runRootQueryStream(sub, sessionId, rootNode, dto, emit, false);
  }

  // Shared stream-consumption loop for both root-query entry points. The caller
  // has already persisted the loading root node + session meta and emitted
  // `init`. `patchSessionMetaAtDone` is false on the seeded first-question path
  // (D2) — the session title stays the project name, so `done` writes nothing
  // to SessionMeta beyond the node itself.
  private async runRootQueryStream(
    sub: string,
    sessionId: string,
    rootNode: NodeItem,
    dto: CreateSessionDto,
    emit: (data: object) => void,
    patchSessionMetaAtDone: boolean = true,
  ): Promise<void> {
    const nodeId = rootNode.nodeId;
    let title = '';
    let emoji = '';
    let lede = '';
    const sections: Array<{ id: string; heading: string; body: string }> = [];

    const persona = await this.users.getPersona(sub);
    for await (const event of this.llm.streamAnswerQuery(dto.query, dto.sectionCount ?? 5, dto.webSearch ?? false, persona)) {
      if (event.type === 'meta') {
        title = event.title;
        emoji = event.emoji;
        lede = event.lede;
        emit({ type: 'meta', title, emoji, lede });
      } else if (event.type === 'section') {
        const section = { id: ulid(), heading: event.heading, body: event.body };
        sections.push(section);
        emit({ type: 'section', ...section });
        // Incrementally persist so a refresh shows progress, not an empty node.
        await this.db.putNode({ ...rootNode, title: title || rootNode.title, emoji, lede, sections: [...sections] });
      } else if (event.type === 'done') {
        // Citation-processed bodies arrive only at done; map them onto the streamed
        // sections by index to preserve their ids. Sources are persisted on the node.
        if (event.sections) {
          event.sections.forEach((s, i) => { if (sections[i]) sections[i].body = s.body; });
        }
        const sourcesPatch = event.sources?.length ? { sources: event.sources } : {};
        // The SessionMeta row already exists (written up-front so the session is
        // accessible if the client closes mid-stream). Patch only the title/emoji/lede
        // here — an UPDATE, not a full replace — so the History card shows the real
        // values once the stream finishes server-side (and any projectId survives).
        // Skipped on the seeded first-question path (D2): the session title stays
        // the project name, not the query's LLM-generated title.
        const writes: Promise<unknown>[] = [this.db.putNode({ ...rootNode, title, emoji, lede, sections, ...sourcesPatch })];
        if (patchSessionMetaAtDone) {
          writes.push(this.db.updateSessionMeta(sub, sessionId, { title, emoji, lede }));
        }
        await Promise.all(writes);
        await this.users.billUsage(sub, event.usage.inputTokens, event.usage.outputTokens, 'QUERY', sessionId, nodeId, ROOT_MODEL);
        emit({ type: 'done', sessionId, nodeId, model: ROOT_MODEL, sections, sources: event.sources });
      }
    }
  }

  // Build a whole mind-map session from an uploaded document (authed-only).
  // Two phases over one SSE stream: (1) read the document ONCE and design the
  // tree; (2) generate each node's content from its brief, root→leaf. Follows the
  // same persist-first contract as createStreaming (init up-front, incremental
  // putNode, finalise at done) so a refresh mid-run restores progress.
  async createDocumentStreaming(
    sub: string,
    dto: CreateDocumentDto,
    send: (data: object) => void,
  ): Promise<void> {
    await this.users.checkCredit(sub);

    const sessionId = ulid();
    const rootNodeId = ulid();
    const now = new Date().toISOString();
    const emit = (data: object) => { try { send(data); } catch { /* client gone */ } };

    const placeholderTitle = this.tempTitle(dto.fileName || dto.documentText);

    // Persist-first: minimal session + loading root so a refresh during the slow
    // extraction restores the session instead of dropping the user to Landing.
    const initialRoot: NodeItem = {
      PK: `SESSION#${sessionId}`,
      SK: `NODE#${rootNodeId}`,
      nodeId: rootNodeId,
      parentId: null,
      kind: 'QUERY',
      title: placeholderTitle,
      emoji: null,
      query: dto.fileName || placeholderTitle,
      lede: '',
      sections: [],
      fromSection: null,
      fromText: null,
      createdAt: now,
      model: ROOT_MODEL,
    };
    const sessionMeta: SessionMetaItem = {
      PK: this.userPk(sub),
      SK: this.sessionSk(sessionId),
      sessionId,
      title: placeholderTitle,
      emoji: '',
      lede: '',
      rootNodeId,
      nodeCount: 1,
      createdAt: now,
      updatedAt: now,
      gsi1pk: this.userPk(sub),
      gsi1sk: `UPDATED#${now}`,
    };
    await Promise.all([this.db.putNode(initialRoot), this.db.putSessionMeta(sessionMeta)]);
    emit({ type: 'init', sessionId, nodeId: rootNodeId });

    // ── Phase 1: read the document once, design the tree (always Sonnet). ──
    const outline = await this.llm.extractDocumentOutline(dto.documentText, dto.maxNodes ?? 8);

    // Map outline tempIds → real ULIDs; the root is implicit (rootNodeId). An
    // unknown/missing parentTempId re-parents under the root (defensive).
    const idByTemp = new Map<string, string>();
    for (const n of outline.nodes) idByTemp.set(n.tempId, ulid());
    const parentRealId = (parentTempId: string | null): string =>
      parentTempId && idByTemp.has(parentTempId) ? idByTemp.get(parentTempId)! : rootNodeId;

    interface PlanNode { nodeId: string; parentId: string | null; title: string; emoji: string; description: string; }
    const plans: PlanNode[] = [
      { nodeId: rootNodeId, parentId: null, title: outline.title, emoji: outline.emoji, description: outline.rootDescription },
      ...outline.nodes.map((n) => ({
        nodeId: idByTemp.get(n.tempId)!,
        parentId: parentRealId(n.parentTempId),
        title: n.title,
        emoji: n.emoji,
        description: n.description,
      })),
    ];
    const planById = new Map(plans.map((p) => [p.nodeId, p]));

    // Order content calls root→leaf (BFS) so requirement 6 holds and the map
    // lights up top-down. The BFS index also seeds createdAt so sibling order is stable.
    const order: PlanNode[] = [];
    const queue: string[] = [rootNodeId];
    while (queue.length) {
      const p = planById.get(queue.shift()!);
      if (!p) continue;
      order.push(p);
      for (const c of plans) if (c.parentId === p.nodeId) queue.push(c.nodeId);
    }

    // Persist all node skeletons (loading, empty sections) and tell the client the
    // full shape so the whole map renders at once. createdAt is offset by BFS index
    // so the frontend's createdAt-sorted childMap keeps the intended order.
    const baseMs = Date.parse(now);
    const skeletons: NodeItem[] = order.map((p, i) => ({
      PK: `SESSION#${sessionId}`,
      SK: `NODE#${p.nodeId}`,
      nodeId: p.nodeId,
      parentId: p.parentId,
      kind: p.parentId ? 'DEEPER' : 'QUERY',
      title: p.title,
      emoji: p.emoji || null,
      query: p.title,
      lede: '',
      sections: [],
      fromSection: null,
      fromText: p.description,
      createdAt: new Date(baseMs + i).toISOString(),
      model: ROOT_MODEL,
    }));
    const skeletonById = new Map(skeletons.map((n) => [n.nodeId, n]));
    await Promise.all([
      ...skeletons.map((n) => this.db.putNode(n)),
      this.db.updateSessionMeta(sub, sessionId, {
        title: outline.title, emoji: outline.emoji, lede: outline.lede, nodeCount: skeletons.length,
      }),
      this.users.billUsage(sub, outline.usage.inputTokens, outline.usage.outputTokens, 'QUERY', sessionId, rootNodeId, ROOT_MODEL),
    ]);
    emit({
      type: 'skeleton',
      nodes: skeletons.map((n) => ({ id: n.nodeId, parentId: n.parentId ?? null, kind: n.kind, title: n.title, emoji: n.emoji ?? null })),
    });

    // ── Phase 2: generate content root→leaf, sequentially. ──
    const contentModel = resolveBranchModel(dto.model);
    const persona = await this.users.getPersona(sub);

    for (const p of order) {
      // Ancestor briefs (root → parent) ground the note and prevent repetition.
      const ancestors: Array<{ title: string; description: string }> = [];
      let cur = p.parentId;
      while (cur) {
        const a = planById.get(cur);
        if (!a) break;
        ancestors.unshift({ title: a.title, description: a.description });
        cur = a.parentId;
      }

      const skeleton = skeletonById.get(p.nodeId)!;
      try {
        const result = await this.llm.generateFromBrief(
          ancestors, p.title, p.description,
          dto.sectionCount ?? 4, dto.webSearch ?? false, contentModel, dto.verbose ?? false, true, persona,
        );
        // Keep the outline title/emoji (stable on the map); take content's sections + lede.
        const node: NodeItem = {
          ...skeleton,
          lede: result.lede,
          sections: result.sections.map((s) => ({ id: ulid(), ...s })),
          model: contentModel,
          ...(result.sources?.length ? { sources: result.sources } : {}),
        };
        await this.db.putNode(node);
        // node.kind is always QUERY or DEEPER here — the skeleton above only ever
        // assigns one of those two (see `kind: p.parentId ? 'DEEPER' : 'QUERY'`).
        await this.users.billUsage(sub, result.usage.inputTokens, result.usage.outputTokens, node.kind as 'QUERY' | 'DEEPER', sessionId, node.nodeId, contentModel);
        emit({ type: 'node-done', node });
      } catch (err) {
        // One node failing must not abort the tree — fall back to the brief as the
        // node body so it never hangs as a perpetual loading skeleton, and continue.
        this.logger.warn(`Document node ${p.nodeId} content failed: ${(err as Error).message}`);
        const fallback: NodeItem = {
          ...skeleton,
          lede: p.description.slice(0, 200),
          sections: [{ id: ulid(), heading: '', body: p.description }],
          model: contentModel,
        };
        await this.db.putNode(fallback);
        emit({ type: 'node-done', node: fallback });
      }
    }

    emit({ type: 'done', sessionId, nodeCount: skeletons.length, title: outline.title, emoji: outline.emoji, lede: outline.lede });
  }

  async create(sub: string, dto: CreateSessionDto): Promise<FullSession> {
    await this.users.checkCredit(sub);

    const sessionId = ulid();
    const nodeId = ulid();
    const now = new Date().toISOString();

    const persona = await this.users.getPersona(sub);
    const llmResult = await this.llm.answerQuery(dto.query, dto.sectionCount ?? 4, dto.webSearch ?? false, persona);
    const sections = llmResult.sections.map((s) => ({ id: ulid(), ...s }));

    const rootNode: NodeItem = {
      PK: `SESSION#${sessionId}`,
      SK: `NODE#${nodeId}`,
      nodeId,
      parentId: null,
      kind: 'QUERY',
      title: llmResult.title,
      emoji: llmResult.emoji,
      query: dto.query,
      lede: llmResult.lede,
      sections,
      fromSection: null,
      fromText: null,
      createdAt: now,
      model: ROOT_MODEL,
      ...(llmResult.sources?.length ? { sources: llmResult.sources } : {}),
    };

    const sessionMeta: SessionMetaItem = {
      PK: this.userPk(sub),
      SK: this.sessionSk(sessionId),
      sessionId,
      title: llmResult.title,
      emoji: llmResult.emoji,
      lede: llmResult.lede,
      rootNodeId: nodeId,
      nodeCount: 1,
      createdAt: now,
      updatedAt: now,
      gsi1pk: this.userPk(sub),
      gsi1sk: `UPDATED#${now}`,
    };

    await Promise.all([this.db.putNode(rootNode), this.db.putSessionMeta(sessionMeta)]);
    await this.users.billUsage(sub, llmResult.usage.inputTokens, llmResult.usage.outputTokens, 'QUERY', sessionId, nodeId, ROOT_MODEL);

    return {
      sessionId,
      title: llmResult.title,
      emoji: llmResult.emoji,
      lede: llmResult.lede,
      createdAt: now,
      updatedAt: now,
      nodeCount: 1,
      highlightCount: 0,
      nodes: [rootNode],
      annotations: [],
      highlights: [],
    };
  }

  // Truncates a commit message to ~5 words for a CODE node's map-card title —
  // the same rule createCodeNodeStreaming applies to a finished agent run.
  private commitTitle(message: string): string {
    return message.split(/\s+/).filter(Boolean).slice(0, 5).join(' ') || 'Initial commit';
  }

  // Creates a Project's map session. Two shapes:
  //  - `rootQuery` set (provider 'new', no repo yet): seeds a single BRANCH
  //    root carrying the user's opening question — the frontend immediately
  //    streams the LLM answer into it (see createRootNodeStreaming's fill-root
  //    mode below), so the user lands straight in a filled-in session.
  //  - otherwise: the original behaviour — a CODE root node for the repo's
  //    first commit (plus a second CODE node for HEAD, if it differs from the
  //    first). `seed.imported` marks a real GitHub fetch, but the root node is
  //    only actually flagged `imported` when there's a real first commit to
  //    point at — an empty repo still falls back to a synthesized root, same
  //    as the mock provider (see ProjectsService.buildSeed).
  async createProjectSession(sub: string, title: string, seed: ProjectSeed, rootQuery?: string): Promise<string> {
    const sessionId = ulid();
    const now = new Date().toISOString();
    const rootNodeId = ulid();

    if (rootQuery) {
      const rootNode: NodeItem = {
        PK: `SESSION#${sessionId}`,
        SK: `NODE#${rootNodeId}`,
        nodeId: rootNodeId,
        parentId: null,
        kind: 'BRANCH',
        title: this.tempTitle(rootQuery),
        emoji: null,
        query: rootQuery,
        lede: '',
        sections: [],
        fromSection: null,
        fromText: null,
        createdAt: now,
        branchName: seed.defaultBranch,
        commitSha: randomBytes(20).toString('hex'),
        model: ROOT_MODEL,
      };
      const sessionMeta: SessionMetaItem = {
        PK: this.userPk(sub),
        SK: this.sessionSk(sessionId),
        sessionId,
        title,
        emoji: '',
        lede: '',
        rootNodeId,
        nodeCount: 1,
        createdAt: now,
        updatedAt: now,
        gsi1pk: this.userPk(sub),
        gsi1sk: `UPDATED#${now}`,
      };
      await Promise.all([this.db.putNode(rootNode), this.db.putSessionMeta(sessionMeta)]);
      return sessionId;
    }

    const rootMessage = seed.first?.message || 'Initial commit';
    const rootNode: NodeItem = {
      PK: `SESSION#${sessionId}`,
      SK: `NODE#${rootNodeId}`,
      nodeId: rootNodeId,
      parentId: null,
      kind: 'CODE',
      title: this.commitTitle(rootMessage),
      emoji: null,
      query: rootMessage,
      lede: '',
      sections: [],
      fromSection: null,
      fromText: null,
      createdAt: now,
      branchName: seed.defaultBranch,
      commitSha: seed.first?.sha ?? randomBytes(20).toString('hex'),
      commitMessage: rootMessage,
      ...(seed.imported && seed.first ? { imported: true } : {}),
    };

    const nodes: NodeItem[] = [rootNode];

    if (seed.head && seed.first && seed.head.sha !== seed.first.sha) {
      const headNodeId = ulid();
      const headMessage = seed.head.message || 'Initial commit';
      nodes.push({
        PK: `SESSION#${sessionId}`,
        SK: `NODE#${headNodeId}`,
        nodeId: headNodeId,
        parentId: rootNodeId,
        kind: 'CODE',
        title: this.commitTitle(headMessage),
        emoji: null,
        query: headMessage,
        lede: '',
        sections: [],
        fromSection: null,
        fromText: null,
        // 1ms after the root so createdAt-ordered reads keep root-before-head.
        createdAt: new Date(Date.parse(now) + 1).toISOString(),
        branchName: seed.defaultBranch,
        commitSha: seed.head.sha,
        commitMessage: headMessage,
        imported: true,
      });
    }

    const sessionMeta: SessionMetaItem = {
      PK: this.userPk(sub),
      SK: this.sessionSk(sessionId),
      sessionId,
      title,
      emoji: '',
      lede: '',
      rootNodeId,
      nodeCount: nodes.length,
      createdAt: now,
      updatedAt: now,
      gsi1pk: this.userPk(sub),
      gsi1sk: `UPDATED#${now}`,
    };

    await Promise.all([...nodes.map((n) => this.db.putNode(n)), this.db.putSessionMeta(sessionMeta)]);
    return sessionId;
  }

  // Creates a Project's map session from a fully-built node list (repo-import
  // full-history path — see RepoImportService.buildImportedNodes). The nodes
  // already carry the given sessionId's PK, so this is just persistence:
  // batch-write the nodes and write the SessionMeta row pointing at the root.
  async createImportedProjectSession(sub: string, title: string, sessionId: string, nodes: NodeItem[]): Promise<string> {
    const now = new Date().toISOString();
    const rootNode = nodes.find((n) => !n.parentId);
    const sessionMeta: SessionMetaItem = {
      PK: this.userPk(sub),
      SK: this.sessionSk(sessionId),
      sessionId,
      title,
      emoji: '',
      lede: '',
      rootNodeId: rootNode?.nodeId ?? nodes[0].nodeId,
      nodeCount: nodes.length,
      createdAt: now,
      updatedAt: now,
      gsi1pk: this.userPk(sub),
      gsi1sk: `UPDATED#${now}`,
    };
    await Promise.all([this.db.batchPutNodes(nodes), this.db.putSessionMeta(sessionMeta)]);
    return sessionId;
  }

  async list(sub: string): Promise<SessionSummary[]> {
    const items = await this.db.listSessionMeta(sub);
    const counts = await Promise.all(
      items.map(async (m) => (await this.db.queryHighlights(m.sessionId)).length),
    );
    return items.map((m, i) => ({ ...this.toSummary(m), highlightCount: counts[i] }));
  }

  async getSession(sub: string, sessionId: string): Promise<FullSession> {
    const meta = await this.db.getSessionMeta(sub, sessionId);
    if (!meta) throw new NotFoundException(`Session ${sessionId} not found`);

    const [nodes, annotations, highlights] = await Promise.all([
      this.db.queryNodes(sessionId),
      this.db.queryAnnotations(sessionId),
      this.db.queryHighlights(sessionId),
    ]);

    this.warnIfLarge(sessionId, nodes, annotations, highlights);
    return { ...this.toSummary(meta), highlightCount: highlights.length, nodes, annotations, highlights };
  }

  async update(sub: string, sessionId: string, dto: UpdateSessionDto): Promise<void> {
    const meta = await this.db.getSessionMeta(sub, sessionId);
    if (!meta) throw new NotFoundException(`Session ${sessionId} not found`);
    const now = new Date().toISOString();
    const updates: Partial<Parameters<typeof this.db.updateSessionMeta>[2]> = {
      updatedAt: now,
      gsi1sk: `UPDATED#${now}`,
    };
    if (dto.title !== undefined) updates.title = dto.title;
    await this.db.updateSessionMeta(sub, sessionId, updates);
  }

  async delete(sub: string, sessionId: string): Promise<void> {
    const meta = await this.db.getSessionMeta(sub, sessionId);
    if (!meta) throw new NotFoundException(`Session ${sessionId} not found`);

    const [nodes, annotations, highlights] = await Promise.all([
      this.db.queryNodes(sessionId),
      this.db.queryAnnotations(sessionId),
      this.db.queryHighlights(sessionId),
    ]);

    await Promise.all([
      this.db.batchDeleteNodes(sessionId, nodes.map((n) => n.nodeId)),
      this.db.batchDeleteAnnotations(sessionId, annotations.map((a) => a.annId)),
      this.db.batchDeleteHighlights(sessionId, highlights.map((h) => h.hlId)),
      this.db.deleteSessionMeta(sub, sessionId),
    ]);
  }

  async touchUpdatedAt(sub: string, sessionId: string): Promise<void> {
    const now = new Date().toISOString();
    await this.db.updateSessionMeta(sub, sessionId, { updatedAt: now, gsi1sk: `UPDATED#${now}` });
  }

  async incrementNodeCount(sub: string, sessionId: string, delta: number): Promise<void> {
    const meta = await this.db.getSessionMeta(sub, sessionId);
    if (!meta) return;
    await this.db.updateSessionMeta(sub, sessionId, {
      nodeCount: Math.max(0, (meta.nodeCount ?? 0) + delta),
    });
  }

  private toSummary(item: SessionMetaItem): SessionSummary {
    return {
      sessionId: item.sessionId,
      title: item.title,
      emoji: item.emoji,
      lede: item.lede,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      nodeCount: item.nodeCount ?? 0,
      highlightCount: 0,
      projectId: item.projectId,
    };
  }
}
