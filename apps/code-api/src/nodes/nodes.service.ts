import { randomBytes } from 'crypto';
import { Inject, Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ulid } from 'ulid';
import { DynamoRepository } from '@/dynamo/dynamo.repository';
import type { NodeItem, AgentRunItem, RepoRef, ProjectItem, HighlightItem } from '@/dynamo/dynamo.interfaces';
import { LlmService, friendlyLlmError } from '@/llm/llm.service';
import { resolveBranchModel, priceFor, CLOUD_CODE_MODEL_ID, PLAN_MODEL_ID, ALIAS_TO_ID } from '@/llm/models';
import { NodeKind } from '@/llm/llm.types';
import { SessionsService } from '@/sessions/sessions.service';
import { UsersService } from '@/users/users.service';
import { GithubAppService } from '@/github/github-app.service';
import { ApnsService } from '@/devices/apns.service';
import { HighlightsService } from '@/highlights/highlights.service';
import { AgentRunFinal, AgentRunContext } from '@/agent/agent-runner';
import { AGENT_RUNNER_REGISTRY, AgentRunnerRegistry } from '@/agent/runner-registry';
import { AgentEvent, serializeEventsCapped } from '@/agent/agent-run.util';
import { CreateNodeDto } from './dto/create-node.dto';
import { CreateMixNodeDto } from './dto/create-mix-node.dto';
import { CreateBranchNodeDto } from './dto/create-branch-node.dto';
import { CreateCodeNodeDto } from './dto/create-code-node.dto';
import { CreatePrNodeDto } from './dto/create-pr-node.dto';
import { CreateInlineNoteDto } from './dto/create-inline-note.dto';
import { UpdateNodeDto } from './dto/update-node.dto';
import { assertKindAllowed, LEARN_KINDS } from './node-grammar';
import { findRailChain, planDocOf, codeSummaryOf, codeContextBlockOf, attachmentsBlockOf } from './context';

@Injectable()
export class NodesService {
  private readonly logger = new Logger(NodesService.name);

  constructor(
    private readonly db: DynamoRepository,
    private readonly llm: LlmService,
    private readonly sessions: SessionsService,
    private readonly users: UsersService,
    private readonly githubApp: GithubAppService,
    private readonly apns: ApnsService,
    private readonly highlights: HighlightsService,
    private readonly cfg: ConfigService,
    @Inject(AGENT_RUNNER_REGISTRY) private readonly runners: AgentRunnerRegistry,
  ) {}

  async createNode(sub: string, sessionId: string, dto: CreateNodeDto): Promise<NodeItem> {
    await this.users.checkCredit(sub);

    const model = resolveBranchModel(dto.model);

    const session = await this.sessions.getSession(sub, sessionId);
    const nodeById = new Map(session.nodes.map((n) => [n.nodeId, n]));

    const parentNode = nodeById.get(dto.parentNodeId);
    if (!parentNode) {
      throw new NotFoundException(`Parent node ${dto.parentNodeId} not found`);
    }
    assertKindAllowed(parentNode.kind as NodeKind, dto.kind);

    // Soft-dedupe emoji against existing siblings (same parent) so the map
    // doesn't repeat the same icon across branches under one node.
    const usedEmojis = new Set(
      session.nodes
        .filter((n) => n.parentId === dto.parentNodeId && n.emoji)
        .map((n) => n.emoji as string),
    );

    // Walk up to root to build context trail (root first), also collecting
    // ancestor emojis so a branch doesn't echo its parent/grandparent icon.
    const ancestors: Array<{ title: string; query: string }> = [];
    let cur: string | null = dto.parentNodeId;
    while (cur) {
      const n = nodeById.get(cur);
      if (!n) break;
      ancestors.unshift({ title: n.title, query: n.query });
      if (n.emoji) usedEmojis.add(n.emoji);
      cur = n.parentId ?? null;
    }
    const avoidEmojis = [...usedEmojis];

    let llmResult;
    let fromText: string;

    // All callers are authenticated now (guest mode removed), so the larger
    // Output Budget and boosted retry are always available. See ADR-0009.
    const boost = dto.boost ?? false;
    const persona = await this.users.getPersona(sub);

    // A DEEPER/ASK hanging directly off a CODE node is grounded in what the agent
    // actually did, not just the parent's title/query like a normal ancestor —
    // fetching the AgentRun is best-effort (skipped silently if absent/erroring).
    let extraContext: string | undefined;
    if (parentNode.kind === 'CODE') {
      const run = await this.db.getAgentRun(sessionId, parentNode.nodeId).catch(() => null);
      let recentEvents: AgentEvent[] = [];
      if (run) {
        try { recentEvents = (JSON.parse(run.events) as AgentEvent[]).slice(-15); } catch { /* malformed events blob — degrade gracefully */ }
      }
      extraContext = codeContextBlockOf(parentNode, recentEvents);
    }

    // Composer attachments (text files, or Groq-described images) — same
    // "--- Attached file ---" block format the CODE path builds into the
    // agent prompt, so attaching a screenshot reads identically whether the
    // user Builds or Asks about it.
    if (dto.attachments?.length) {
      const block = attachmentsBlockOf(dto.attachments);
      extraContext = extraContext ? `${extraContext}\n\n${block}` : block;
    }

    // Inline mode: append a short answer to the parent node's own sections
    // instead of creating a child node — no new node, no map growth.
    if (dto.inline) {
      const anchorText = dto.kind === 'ASK' ? dto.highlightText : dto.sectionBody;
      if (!anchorText) throw new BadRequestException(`${dto.kind === 'ASK' ? 'highlightText' : 'sectionBody'} required for ${dto.kind} nodes`);

      const inlineResult = await this.llm.answerInline(ancestors, anchorText, dto.query, model, dto.webSearch ?? false, 70, extraContext);
      const section = { id: ulid(), heading: '', body: inlineResult.answer, askedQuery: dto.query };
      const updatedParent: NodeItem = { ...parentNode, sections: [...parentNode.sections, section] };

      // Full-item replace, not updateNode — updateNode's field whitelist doesn't
      // include sections, so an update would silently no-op (see sessions.service.ts's
      // incremental section writes for the same pattern).
      await this.db.putNode(updatedParent);
      await Promise.all([
        this.sessions.touchUpdatedAt(sub, sessionId),
        this.users.billUsage(sub, inlineResult.usage.inputTokens, inlineResult.usage.outputTokens, dto.kind, sessionId, parentNode.nodeId, model),
      ]);

      return updatedParent;
    }

    if (dto.kind === 'DEEPER') {
      if (!dto.sectionBody) throw new BadRequestException('sectionBody required for DEEPER nodes');
      llmResult = await this.llm.expandSection(ancestors, dto.query, dto.sectionBody, dto.sectionCount ?? 4, dto.webSearch ?? false, model, dto.verbose ?? false, true, boost, avoidEmojis, persona, extraContext);
      fromText = `${dto.query}: ${dto.sectionBody.slice(0, 200)}…`;
    } else {
      if (!dto.highlightText) throw new BadRequestException('highlightText required for ASK nodes');
      llmResult = await this.llm.followUpFromHighlight(ancestors, dto.highlightText, dto.query, dto.sectionCount ?? 4, dto.webSearch ?? false, model, dto.verbose ?? false, true, boost, avoidEmojis, persona, extraContext);
      fromText = dto.highlightText;
    }

    const nodeId = ulid();
    const now = new Date().toISOString();
    const sections = llmResult.sections.map((s) => ({ id: ulid(), ...s }));

    const node: NodeItem = {
      PK: `SESSION#${sessionId}`,
      SK: `NODE#${nodeId}`,
      nodeId,
      parentId: dto.parentNodeId,
      kind: dto.kind,
      title: llmResult.title,
      emoji: llmResult.emoji,
      query: dto.query,
      lede: llmResult.lede,
      sections,
      fromSection: dto.fromSection,
      fromText,
      createdAt: now,
      model,
      ...(llmResult.sources?.length ? { sources: llmResult.sources } : {}),
    };

    await this.db.putNode(node);
    await Promise.all([
      this.sessions.touchUpdatedAt(sub, sessionId),
      this.sessions.incrementNodeCount(sub, sessionId, 1),
      this.users.billUsage(sub, llmResult.usage.inputTokens, llmResult.usage.outputTokens, dto.kind, sessionId, node.nodeId, model),
    ]);

    return node;
  }

  // "Explain" (#237 Phase 1b) — a highlight-anchored alternative to Branch: a
  // very short answer attached to the highlighted passage itself (as a
  // HighlightItem.note), not a new node. Mirrors createNode's inline-mode
  // branch (same answerInline call, same CODE-parent context enrichment, same
  // ancestor-trail walk) but writes a HighlightItem instead of appending a
  // section, and never touches nodeCount since no node is created.
  async createInlineNote(sub: string, sessionId: string, dto: CreateInlineNoteDto): Promise<HighlightItem> {
    await this.users.checkCredit(sub);

    const model = resolveBranchModel(dto.model);

    const session = await this.sessions.getSession(sub, sessionId);
    const nodeById = new Map(session.nodes.map((n) => [n.nodeId, n]));

    const node = nodeById.get(dto.nodeId);
    if (!node) {
      throw new NotFoundException(`Node ${dto.nodeId} not found`);
    }

    // Walk up to root to build the ancestor context trail (root first),
    // inclusive of the highlight's own node — identical to createNode's inline
    // branch, where the trail is rooted at the node the answer is appended to.
    const ancestors: Array<{ title: string; query: string }> = [];
    let cur: string | null = dto.nodeId;
    while (cur) {
      const n = nodeById.get(cur);
      if (!n) break;
      ancestors.unshift({ title: n.title, query: n.query });
      cur = n.parentId ?? null;
    }

    // A note on a CODE node's passage is grounded in what the agent actually
    // did, not just its title/query — same best-effort AgentRun fetch as
    // createNode's code→learn enrichment (skipped silently if absent/erroring).
    let extraContext: string | undefined;
    if (node.kind === 'CODE') {
      const run = await this.db.getAgentRun(sessionId, node.nodeId).catch(() => null);
      let recentEvents: AgentEvent[] = [];
      if (run) {
        try { recentEvents = (JSON.parse(run.events) as AgentEvent[]).slice(-15); } catch { /* malformed events blob — degrade gracefully */ }
      }
      extraContext = codeContextBlockOf(node, recentEvents);
    }

    // 40 words, tighter than the composer inline turn's 70 — this has to fit in
    // a small popover beside the prose, not a conversational reply.
    const inlineResult = await this.llm.answerInline(ancestors, dto.text, dto.question, model, dto.webSearch ?? false, 40, extraContext);

    // 'note' is a reserved sentinel (like 'branch') the frontend maps to a
    // dedicated ::highlight(fork-hl-note) style — not a hex colour.
    const highlight = await this.highlights.create(sub, sessionId, {
      nodeId: dto.nodeId,
      sectionId: dto.sectionId,
      text: dto.text,
      start: dto.start,
      end: dto.end,
      bg: 'note',
      fg: null,
      note: inlineResult.answer,
      noteQuestion: dto.question,
    });

    await Promise.all([
      this.sessions.touchUpdatedAt(sub, sessionId),
      this.users.billUsage(sub, inlineResult.usage.inputTokens, inlineResult.usage.outputTokens, 'ASK', sessionId, dto.nodeId, model),
    ]);

    return highlight;
  }

  async createMixNode(sub: string, sessionId: string, dto: CreateMixNodeDto): Promise<NodeItem> {
    await this.users.checkCredit(sub);

    // PLAN nodes always synthesize with Opus (product decision: opus plans,
    // sonnet implements); plain MIX nodes keep the user-selectable default.
    const model = dto.plan ? PLAN_MODEL_ID : resolveBranchModel(dto.model);

    const session = await this.sessions.getSession(sub, sessionId);
    const nodeById = new Map(session.nodes.map((n) => [n.nodeId, n]));

    const parentNode = nodeById.get(dto.parentNodeId);
    if (!parentNode) {
      throw new NotFoundException(`Parent node ${dto.parentNodeId} not found`);
    }

    const sourceIds = dto.sourceNodeIds ?? [];

    if (sourceIds.includes(dto.parentNodeId)) {
      throw new BadRequestException('sourceNodeIds must not include parentNodeId');
    }

    const sourceNodeList = sourceIds.map((id) => {
      const n = nodeById.get(id);
      if (!n) throw new NotFoundException(`Source node ${id} not found`);
      return n;
    });

    // A mix can never be built from a PLAN/CODE/BRANCH base node. Non-plan mixes
    // stay MIX-only children of a learn node (checked via the grammar map); plan
    // mode produces a PLAN node instead, which isn't a valid child in that map, so
    // it's checked directly against LEARN_KINDS — along with every source node.
    // Plan mode additionally allows a BRANCH base (forking a plan straight off a
    // fresh branch point), but only once it carries content to plan from.
    if (dto.plan) {
      if (!LEARN_KINDS.includes(parentNode.kind as NodeKind) && parentNode.kind !== 'BRANCH') {
        throw new BadRequestException('Plan base node must be a learn node (QUERY/DEEPER/ASK/MIX) or a BRANCH node with content');
      }
      if (parentNode.kind === 'BRANCH' && parentNode.sections.length === 0) {
        throw new BadRequestException('Plan base BRANCH node has no content to plan from');
      }
      for (const n of sourceNodeList) {
        if (!LEARN_KINDS.includes(n.kind as NodeKind)) {
          throw new BadRequestException(`Source node ${n.nodeId} must be a learn node (QUERY/DEEPER/ASK/MIX) to build a plan`);
        }
      }
    } else {
      if (sourceIds.length === 0) {
        throw new BadRequestException('Mixer requires at least one source node');
      }
      assertKindAllowed(parentNode.kind as NodeKind, 'MIX');
    }

    // Collect sibling + ancestor emojis to avoid icon duplication
    const usedEmojis = new Set(
      session.nodes
        .filter((n) => n.parentId === dto.parentNodeId && n.emoji)
        .map((n) => n.emoji as string),
    );

    // Build ancestor context trail for A (root → parentNode)
    const ancestors: Array<{ title: string; query: string }> = [];
    let cur: string | null = dto.parentNodeId;
    while (cur) {
      const n = nodeById.get(cur);
      if (!n) break;
      ancestors.unshift({ title: n.title, query: n.query });
      if (n.emoji) usedEmojis.add(n.emoji);
      cur = n.parentId ?? null;
    }

    // Build source node content for LLM (title + sections, body capped to keep context size sane).
    // A 0-source plan has no separate sources to synthesize — the base node's own
    // sections ARE the source material.
    const sourceNodes = dto.plan && sourceNodeList.length === 0
      ? [{ title: parentNode.title, sections: parentNode.sections.map((s) => ({ heading: s.heading, body: s.body })) }]
      : sourceNodeList.map((n) => ({
          title: n.title,
          sections: n.sections.map((s) => ({ heading: s.heading, body: s.body })),
        }));

    const persona = await this.users.getPersona(sub);

    const llmResult = await this.llm.mixNodes(
      ancestors,
      sourceNodes,
      dto.query,
      dto.sectionCount ?? 4,
      model,
      true,
      [...usedEmojis],
      persona,
      dto.plan ?? false,
    );

    const kind: NodeKind = dto.plan ? 'PLAN' : 'MIX';
    const nodeId = ulid();
    const now = new Date().toISOString();
    const sections = llmResult.sections.map((s) => ({ id: ulid(), ...s }));

    // sourceNodes (built above for the LLM prompt) already resolved every
    // sourceId to its node — an unresolved id throws NotFoundException earlier
    // in this method, so it never reaches here — and already falls back to the
    // base node's own title for the 0-source plan case. Render the callout from
    // titles, not raw ULIDs; cap the list so a huge mix doesn't become a
    // run-on string (same "+N more" pattern as AgentLogPane's line-count suffix).
    const sourceTitles = sourceNodes.map((n) => n.title).filter(Boolean);
    const MAX_FROM_TEXT_TITLES = 3;
    const fromText =
      sourceTitles.length <= MAX_FROM_TEXT_TITLES
        ? sourceTitles.join(' · ')
        : `${sourceTitles.slice(0, MAX_FROM_TEXT_TITLES).join(' · ')} +${sourceTitles.length - MAX_FROM_TEXT_TITLES} more`;

    // A PLAN forks a new git branch off the tip of its base node's own lane —
    // findLaneBranchName walks up from the base to the nearest ancestor (rail or
    // learn) carrying a branchName, so a plan based off a non-main lane (e.g. a
    // BRANCH node, or a learn node hanging off one) forks from THAT lane's tip,
    // not main's. A legacy learn-only session with no lane at all falls back to
    // the original main-chain behavior (and its no-CODE-root fallback below).
    let planBranchFields: Partial<Pick<NodeItem, 'branchName' | 'commitSha'>> = {};
    if (dto.plan) {
      const laneNode = this.findLaneBranchName(nodeById, dto.parentNodeId);
      // findLaneChainTip only finds a tip once the lane has a CODE commit on it —
      // a plan forked straight off a fresh BRANCH root (no CODE children yet) has
      // no chain to walk, so fall back to the lane node's own commitSha as the
      // fork point (it IS the tip, there's just nothing built on it yet).
      const chainTip = laneNode
        ? this.findLaneChainTip(session.nodes, nodeById, laneNode.branchName!)
          ?? (laneNode.commitSha ? { branchName: laneNode.branchName!, commitSha: laneNode.commitSha } : null)
        : this.findMainChainTip(session.nodes);
      if (chainTip) {
        const existingBranchNames = new Set(
          session.nodes.filter((n) => n.branchName).map((n) => n.branchName as string),
        );
        planBranchFields = {
          branchName: this.slugifyBranchName(llmResult.title, existingBranchNames),
          commitSha: chainTip.commitSha,
        };
      }
    }

    const node: NodeItem = {
      PK: `SESSION#${sessionId}`,
      SK: `NODE#${nodeId}`,
      nodeId,
      parentId: dto.parentNodeId,
      kind,
      title: llmResult.title,
      emoji: llmResult.emoji,
      query: dto.query,
      lede: llmResult.lede,
      sections,
      fromSection: null,
      fromText,
      createdAt: now,
      model,
      ...planBranchFields,
    };

    await this.db.putNode(node);
    await Promise.all([
      this.sessions.touchUpdatedAt(sub, sessionId),
      this.sessions.incrementNodeCount(sub, sessionId, 1),
      this.users.billUsage(sub, llmResult.usage.inputTokens, llmResult.usage.outputTokens, kind, sessionId, node.nodeId, model),
    ]);

    return node;
  }

  // Walks forward from a lane's known CODE root to that lane's tip ("HEAD") —
  // through same-branchName CODE children AND MERGE children (a MERGE sits ON
  // the lane; its own CODE child, once merged, continues it), returning the
  // actual tip NodeItem. The tip is the LAST node encountered that carries a
  // commitSha — a bare open MERGE has none, so it's walked through but never
  // becomes the tip itself (new PRs onto that lane are blocked by the
  // open-PR guard in createPrNode regardless). Shared by walkLaneTip (below)
  // and findLaneChainTipNode, which differ only in how they locate the root.
  private walkLaneTipNode(nodes: NodeItem[], root: NodeItem): NodeItem {
    let cur = root;
    let tipWithSha = root;
    for (;;) {
      const children = nodes.filter(
        (n) => (n.kind === 'CODE' || n.kind === 'MERGE') && n.parentId === cur.nodeId && n.branchName === root.branchName,
      );
      if (!children.length) break;
      // A fork can only happen if the user Continued a lane more than once from
      // the same commit — prefer the newest attempt as the true tip.
      cur = children.reduce((a, b) => (a.createdAt > b.createdAt ? a : b));
      if (cur.commitSha) tipWithSha = cur;
    }
    return tipWithSha;
  }

  // branchName/commitSha-only view of walkLaneTipNode — used by every caller
  // that doesn't need the tip node's own id.
  private walkLaneTip(nodes: NodeItem[], root: NodeItem): { branchName: string; commitSha: string } {
    const tip = this.walkLaneTipNode(nodes, root);
    return { branchName: root.branchName!, commitSha: tip.commitSha ?? root.commitSha! };
  }

  // Walks the main branch's CODE chain to its tip — "main's HEAD" for
  // fork-point purposes, which may differ from the imported HEAD if the user
  // has since Continued main. Returns null when the session has no CODE root
  // at all (a legacy learn-only session), so the caller can omit
  // branchName/commitSha entirely.
  private findMainChainTip(nodes: NodeItem[]): { branchName: string; commitSha: string } | null {
    const root = nodes.find((n) => n.kind === 'CODE' && (n.parentId ?? null) === null);
    if (!root || !root.branchName || !root.commitSha) return null;
    return this.walkLaneTip(nodes, root);
  }

  // Generalizes findMainChainTip to an arbitrary lane: the lane's root is the
  // CODE node whose parent isn't itself part of the same-branchName chain (the
  // BRANCH/PLAN node that forked the lane — or, for main, no parent at all),
  // then walks forward to the tip node. A MERGE node counts as "part of the
  // chain" here too — otherwise a post-merge CODE commit (whose parent is the
  // MERGE node, not another CODE node) would be misidentified as a second lane
  // root, and `.find` would nondeterministically return either it or the real
  // genesis commit depending on array order. Returns null if the lane has no
  // CODE commits yet (e.g. a freshly-forked BRANCH with nothing built on it).
  private findLaneChainTipNode(
    nodes: NodeItem[],
    nodeById: Map<string, NodeItem>,
    branchName: string,
  ): NodeItem | null {
    const root = nodes.find((n) => {
      if (n.kind !== 'CODE' || n.branchName !== branchName) return false;
      const parent = n.parentId ? nodeById.get(n.parentId) : undefined;
      const parentContinuesLane = !!parent && (parent.kind === 'CODE' || parent.kind === 'MERGE') && parent.branchName === branchName;
      return !parentContinuesLane;
    });
    if (!root || !root.commitSha) return null;
    return this.walkLaneTipNode(nodes, root);
  }

  // branchName/commitSha-only view of findLaneChainTipNode — used by every
  // existing caller that doesn't need the tip node's own id.
  private findLaneChainTip(
    nodes: NodeItem[],
    nodeById: Map<string, NodeItem>,
    branchName: string,
  ): { branchName: string; commitSha: string } | null {
    const tip = this.findLaneChainTipNode(nodes, nodeById, branchName);
    return tip ? { branchName: tip.branchName!, commitSha: tip.commitSha! } : null;
  }

  // Finds which git lane a base node sits on by walking parentId links upward
  // (inclusive of the base node itself) to the nearest ancestor carrying a
  // branchName — a rail node (BRANCH/PLAN/CODE) or a learn node hanging off
  // one. Returns the NODE itself (not just its name) so a caller with no
  // further CODE chain to walk (findLaneChainTip) can still fall back to this
  // node's own commitSha as the fork point. Returns null when no ancestor has
  // one (a legacy learn-only session).
  private findLaneBranchName(nodeById: Map<string, NodeItem>, fromNodeId: string): NodeItem | null {
    let cur: string | null | undefined = fromNodeId;
    while (cur) {
      const n = nodeById.get(cur);
      if (!n) break;
      if (n.branchName) return n;
      cur = n.parentId ?? null;
    }
    return null;
  }

  // Slugifies an LLM-returned plan title into a `fork/<slug>` branch name,
  // de-duped (suffix -2, -3…) against every branchName already in the session.
  private slugifyBranchName(title: string, existing: Set<string>): string {
    const slug = title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60)
      .replace(/-+$/g, '') || 'plan';

    let branchName = `fork/${slug}`;
    for (let n = 2; existing.has(branchName); n++) branchName = `fork/${slug}-${n}`;
    return branchName;
  }

  // Eagerly creates the real GitHub ref for a freshly-forked branch node (#216)
  // — best-effort, NEVER throws, so a create-ref failure can never abort the
  // branch creation itself, nor (for the auto-branch call site) the CODE run
  // it's a part of. Only attempted when the project is a real (non-mock)
  // GitHub repo AND the parent commit was itself actually pushed there — an
  // unpushed parent's sha doesn't exist on the remote yet, so GitHub would
  // just 422 "Object does not exist" (which createBranchRef already degrades
  // to 'skipped' for, but there's no point making the call at all).
  private async tryEagerBranchPush(
    sub: string,
    project: ProjectItem | null,
    parentNode: NodeItem,
    branchName: string,
  ): Promise<Partial<Pick<NodeItem, 'pushed'>>> {
    if (project?.repoRef.provider !== 'github' || parentNode.pushed !== true || !parentNode.commitSha) return {};
    try {
      const result = await this.githubApp.createBranchRef(sub, project.repoRef.owner, project.repoRef.repo, branchName, parentNode.commitSha);
      return result === 'created' || result === 'exists' ? { pushed: true } : {};
    } catch (err) {
      this.logger.warn(`createBranchRef threw for ${project.repoRef.owner}/${project.repoRef.repo}@${branchName} — leaving branch node unpushed: ${String(err)}`);
      return {};
    }
  }

  async createBranchNode(sub: string, sessionId: string, dto: CreateBranchNodeDto): Promise<NodeItem> {
    const session = await this.sessions.getSession(sub, sessionId);
    const nodeById = new Map(session.nodes.map((n) => [n.nodeId, n]));

    const parentNode = nodeById.get(dto.parentNodeId);
    if (!parentNode) {
      throw new NotFoundException(`Parent node ${dto.parentNodeId} not found`);
    }
    assertKindAllowed(parentNode.kind as NodeKind, 'BRANCH');

    if (!parentNode.commitSha) {
      throw new BadRequestException('Parent CODE node has no commit to fork from');
    }

    const existingNames = new Set(session.nodes.map((n) => n.branchName).filter((b): b is string => !!b));
    const branchName = this.slugifyBranchName(dto.title, existingNames);

    const project = session.projectId ? await this.db.getProject(sub, session.projectId) : null;
    const pushedField = await this.tryEagerBranchPush(sub, project, parentNode, branchName);

    const nodeId = ulid();
    const now = new Date().toISOString();

    const node: NodeItem = {
      PK: `SESSION#${sessionId}`,
      SK: `NODE#${nodeId}`,
      nodeId,
      parentId: dto.parentNodeId,
      kind: 'BRANCH',
      title: dto.title,
      emoji: null,
      query: `Fork from ${parentNode.commitSha.slice(0, 7)}`,
      lede: '',
      sections: [],
      fromSection: null,
      fromText: null,
      createdAt: now,
      branchName,
      commitSha: parentNode.commitSha,
      ...pushedField,
    };

    await this.db.putNode(node);
    await Promise.all([
      this.sessions.touchUpdatedAt(sub, sessionId),
      this.sessions.incrementNodeCount(sub, sessionId, 1),
      // Only when the map belongs to a Project — a bare session has no
      // ProjectItem to bump (see root CLAUDE.md's §2b note).
      session.projectId ? this.db.incrementProjectBranchCount(sub, session.projectId, 1) : Promise.resolve(),
    ]);

    return node;
  }

  // Opens a PR: a MERGE node parented onto the TARGET branch's tip commit,
  // carrying the SOURCE commit as a second, render-only parent
  // (mergeFromNodeId — see ADR-0005). No LLM call. MERGE is deliberately absent
  // from every ALLOWED_CHILD_KINDS entry in node-grammar.ts (it's only ever
  // created here, like BRANCH is only ever created by createBranchNode above)
  // so this method owns its own validation instead of calling assertKindAllowed.
  async createPrNode(sub: string, sessionId: string, dto: CreatePrNodeDto): Promise<NodeItem> {
    const session = await this.sessions.getSession(sub, sessionId);
    const nodeById = new Map(session.nodes.map((n) => [n.nodeId, n]));

    const sourceNode = nodeById.get(dto.sourceNodeId);
    if (!sourceNode) {
      throw new NotFoundException(`Source node ${dto.sourceNodeId} not found`);
    }
    if (sourceNode.kind !== 'CODE' || !sourceNode.commitSha) {
      throw new BadRequestException('PR source must be a CODE node with a commit');
    }

    const targetNode = nodeById.get(dto.targetNodeId);
    if (!targetNode) {
      throw new NotFoundException(`Target node ${dto.targetNodeId} not found`);
    }

    const sourceLaneNode = this.findLaneBranchName(nodeById, sourceNode.nodeId);
    const targetLaneNode = this.findLaneBranchName(nodeById, targetNode.nodeId);
    if (!sourceLaneNode?.branchName || !targetLaneNode?.branchName) {
      throw new BadRequestException('Could not resolve a branch for the PR source or target');
    }
    const sourceBranch = sourceLaneNode.branchName;
    const targetBranch = targetLaneNode.branchName;
    if (sourceBranch === targetBranch) {
      throw new BadRequestException('PR source and target must be on different branches');
    }

    const targetTip = this.findLaneChainTipNode(session.nodes, nodeById, targetBranch);
    if (!targetTip) {
      throw new BadRequestException('Target branch has no commits to merge onto');
    }

    const hasOpenPr = session.nodes.some(
      (n) => n.kind === 'MERGE' && n.prStatus === 'open' && n.parentId === targetTip.nodeId,
    );
    if (hasOpenPr) {
      throw new BadRequestException('Target branch already has an open PR');
    }

    const nodeId = ulid();
    const now = new Date().toISOString();
    const title = `PR: ${sourceBranch} → ${targetBranch}`;

    // Real GitHub PR (ADR-0002/0005 extension, WS-E) — only attempted when the
    // project is a real github repo AND both ends were actually pushed there;
    // a mock/github-mock/new-project repo or an unpushed commit has nothing on
    // GitHub to open a PR against, so no attempt is made and BOTH prNumber/prUrl
    // and prError stay absent (a pure internal MERGE node, unchanged). Once an
    // attempt IS made, the outcome is recorded on the node so the frontend can
    // render distinct states: success sets prNumber/prUrl; every failure sets
    // prError instead. Any failure (typed result, null token, or a thrown
    // error) degrades to internal-only and is logged — it never 500s.
    let prFields: Partial<Pick<NodeItem, 'prNumber' | 'prUrl' | 'prError'>> = {};
    const project = session.projectId ? await this.db.getProject(sub, session.projectId) : null;
    if (project?.repoRef.provider === 'github' && sourceNode.pushed === true && targetTip.pushed === true) {
      try {
        const result = await this.githubApp.createPullRequest(sub, project.repoRef.owner, project.repoRef.repo, {
          head: sourceBranch,
          base: targetBranch,
          title,
          body: `Opened automatically by forkai code (${sourceNode.commitSha!.slice(0, 7)} → ${targetBranch}).`,
        });
        if (result && 'number' in result) {
          prFields = { prNumber: result.number, prUrl: result.url };
        } else if (result) {
          prFields = { prError: result.error };
          this.logger.warn(`GitHub PR create degraded to internal-only for ${project.repoRef.owner}/${project.repoRef.repo} (${sourceBranch} → ${targetBranch}): ${result.error}`);
        } else {
          // null ⇒ no installation token (App not installed/configured for this owner).
          prFields = { prError: 'app_not_enabled' };
          this.logger.warn(`GitHub PR create found no App installation for ${project.repoRef.owner}/${project.repoRef.repo} — recording app_not_enabled`);
        }
      } catch (err) {
        prFields = { prError: 'failed' };
        this.logger.warn(`GitHub PR create threw for ${project.repoRef.owner}/${project.repoRef.repo} — degrading to internal-only: ${String(err)}`);
      }
    }

    const node: NodeItem = {
      PK: `SESSION#${sessionId}`,
      SK: `NODE#${nodeId}`,
      nodeId,
      parentId: targetTip.nodeId,
      kind: 'MERGE',
      title,
      emoji: '',
      query: title,
      lede: '',
      sections: [],
      fromSection: null,
      fromText: null,
      createdAt: now,
      branchName: targetBranch,
      mergeFromNodeId: sourceNode.nodeId,
      prStatus: 'open',
      ...prFields,
    };

    await this.db.putNode(node);
    await Promise.all([
      this.sessions.touchUpdatedAt(sub, sessionId),
      this.sessions.incrementNodeCount(sub, sessionId, 1),
    ]);

    return node;
  }

  // Merges an open PR: spawns the merge-commit CODE node (parented on the
  // MERGE node) and flips the MERGE node's prStatus to 'merged'. No LLM call —
  // the commit sha is mocked the same way createCodeNodeStreaming mocks one.
  // The merge commit deliberately omits agentStatus (rather than 'done'):
  // AgentLogPane only fetches an AgentRun when agentStatus is 'done'/'error',
  // and none exists for a merge commit — omitting the field skips that dead
  // fetch entirely while `node.agentStatus ?? 'done'` still renders the pane's
  // status chip as "done".
  async mergePrNode(sub: string, sessionId: string, nodeId: string): Promise<{ mergeNode: NodeItem; commitNode: NodeItem }> {
    const session = await this.sessions.getSession(sub, sessionId);
    const nodeById = new Map(session.nodes.map((n) => [n.nodeId, n]));

    const mergeNode = nodeById.get(nodeId);
    if (!mergeNode) {
      throw new NotFoundException(`Node ${nodeId} not found`);
    }
    if (mergeNode.kind !== 'MERGE' || mergeNode.prStatus !== 'open') {
      throw new BadRequestException('Node is not an open PR');
    }

    const sourceNode = mergeNode.mergeFromNodeId ? nodeById.get(mergeNode.mergeFromNodeId) : undefined;
    const sourceLaneNode = sourceNode ? this.findLaneBranchName(nodeById, sourceNode.nodeId) : null;
    const sourceBranch = sourceLaneNode?.branchName ?? 'source';
    const targetBranch = mergeNode.branchName!;

    // Real GitHub merge (ADR-0002/0005 extension, WS-E) — only when createPrNode
    // actually opened one (mergeNode.prNumber set); an internal-only PR has
    // nothing to merge on GitHub. Never blocks the internal merge-commit below
    // — any failure here is logged and the app-side record still lands.
    if (mergeNode.prNumber !== undefined && session.projectId) {
      try {
        const project = await this.db.getProject(sub, session.projectId);
        if (project?.repoRef.provider === 'github') {
          const merged = await this.githubApp.mergePullRequest(sub, project.repoRef.owner, project.repoRef.repo, mergeNode.prNumber);
          if (!merged) this.logger.warn(`GitHub PR #${mergeNode.prNumber} merge failed for ${project.repoRef.owner}/${project.repoRef.repo} — internal merge-commit still recorded`);
        }
      } catch (err) {
        this.logger.warn(`GitHub PR merge threw for node ${nodeId} — degrading to internal-only: ${String(err)}`);
      }
    }

    const commitNodeId = ulid();
    const commitSha = randomBytes(20).toString('hex');
    const now = new Date().toISOString();
    const commitMessage = `Merge branch '${sourceBranch}' into ${targetBranch}`;

    const commitNode: NodeItem = {
      PK: `SESSION#${sessionId}`,
      SK: `NODE#${commitNodeId}`,
      nodeId: commitNodeId,
      parentId: mergeNode.nodeId,
      kind: 'CODE',
      title: commitMessage.slice(0, 60),
      emoji: null,
      query: commitMessage,
      lede: '',
      sections: [],
      fromSection: null,
      fromText: null,
      createdAt: now,
      branchName: targetBranch,
      commitSha,
      commitMessage,
    };

    await Promise.all([
      this.db.putNode(commitNode),
      this.db.updateNode(sessionId, mergeNode.nodeId, { prStatus: 'merged' }),
    ]);
    await Promise.all([
      this.sessions.touchUpdatedAt(sub, sessionId),
      this.sessions.incrementNodeCount(sub, sessionId, 1),
    ]);

    return { mergeNode: { ...mergeNode, prStatus: 'merged' }, commitNode };
  }

  // Resolves what a real runner works against, from the project's repoRef —
  // or the LOCAL_AGENT_REPO_* env fallback when there's no project (dev/mock
  // convenience, unchanged from before the GitHub App slice). 'new' has no
  // repo yet, so the runner git-inits one instead of cloning. 'github-mock'
  // has no real repo either, but that's fine for mock/local runs — only an
  // explicit cloud request needs to 400, since MockAgentRunner never reads
  // ctx.repo. A private 'github' repo needs an installation token; no
  // installation covering the owner is a friendly 400, not a 500.
  private async resolveRunRepo(
    sub: string,
    repoRef: RepoRef | null,
    environment: 'cloud' | 'mock' | 'blaxel' | undefined,
  ): Promise<NonNullable<AgentRunContext['repo']> | undefined> {
    if (!repoRef) {
      return process.env.LOCAL_AGENT_REPO_PATH
        ? { localPath: process.env.LOCAL_AGENT_REPO_PATH }
        : process.env.LOCAL_AGENT_REPO_URL
          ? { cloneUrl: process.env.LOCAL_AGENT_REPO_URL }
          : undefined;
    }
    if (repoRef.provider === 'new') {
      return { init: { defaultBranch: repoRef.defaultBranch } };
    }
    if (repoRef.provider === 'github-mock') {
      // Any real sandbox (Fly cloud or Blaxel) actually clones the repo, so a
      // mock repo can't run there — only mock/local (which never read ctx.repo).
      if (environment === 'cloud' || environment === 'blaxel') {
        throw new BadRequestException(
          'This project uses a mock repo — attach a real GitHub repo (or run on Demo) to use a Cloud environment.',
        );
      }
      return undefined;
    }
    // provider === 'github' — try an installation token regardless of `private`
    // first: a tokenless clone has no push credentials, so a public repo would
    // otherwise clone fine but silently fail to push.
    const token = await this.githubApp.mintInstallationToken(sub, repoRef.owner, repoRef.repo);
    if (token) {
      return { cloneUrl: `https://x-access-token:${token}@github.com/${repoRef.owner}/${repoRef.repo}.git` };
    }
    if (!repoRef.private) {
      return { cloneUrl: `${repoRef.url}.git` };
    }
    throw new BadRequestException(
      `${repoRef.owner}/${repoRef.repo} is private — install the forkai code GitHub App (Connect GitHub → Install App) to run the coding agent on it.`,
    );
  }

  // Cloud-only (ADR-0004): releases a still-open hold with zero token usage —
  // used by every failure path once placeHold has succeeded (the runner's own
  // error, or anything that throws before the run even starts). reconcileHold
  // is a conditional flip guarded by HoldItem.status, so calling it again after
  // the run's own done/error path already settled it is a harmless no-op.
  // Swallows its own errors — a reconcile failure must never mask the run's
  // real error from the client; reconcileStaleHolds is the eventual backstop.
  private async releaseHoldOnFailure(sub: string, sessionId: string, nodeId: string, model: string): Promise<void> {
    await this.users.reconcileHold(sub, sessionId, nodeId, 0, 0, 0, model, 'CODE').catch((err) => {
      this.logger.warn(`reconcileHold failed while releasing cloud hold sub=${sub} nodeId=${nodeId}: ${String(err)}`);
    });
  }

  // Money basis for a cloud run (ADR-0004 redesign): claude's own reported
  // total_cost_usd — cache-accurate, present on both a normal finish and a
  // `--max-budget-usd` stop — mapped to the BILLED figure via creditMultiplier.
  // The per-message token counts the sandbox stream carries are placeholder
  // values and can never be trusted as a cost basis; the token×priceFor
  // estimate below is only a fallback for the rare run that produced no
  // result line at all (e.g. a CLAUDE_TIMEOUT_MS kill).
  private runCostUsd(final: AgentRunFinal, multiplier: number): number {
    if (final.claudeCostUsd !== undefined) {
      return Math.round(final.claudeCostUsd * multiplier * 1_000_000) / 1_000_000;
    }
    const rate = priceFor(final.model);
    const raw = (final.inputTokens * rate.input / 1_000_000) + (final.outputTokens * rate.output / 1_000_000);
    return Math.round(raw * multiplier * 1_000_000) / 1_000_000;
  }

  // Streaming CODE-node creation: persist-first (loading node + running AgentRun,
  // `init` emitted before any agent-event — see root CLAUDE.md's root-query
  // streaming contract, followed here for the same refresh-survives-mid-run
  // reason), then a single mocked agent run replayed over SSE with jittered
  // pacing. `send` is wrapped in a swallow-errors `emit` exactly like
  // SessionsService.createStreaming so a client disconnect never aborts the run —
  // it still lands fully in the DB. Cloud runs additionally gate on a strict
  // pre-auth hold (ADR-0004), placed right after nodeId is minted and before
  // any node is persisted — see placeHold/reconcileHold in UsersService.
  async createCodeNodeStreaming(
    sub: string,
    sessionId: string,
    dto: CreateCodeNodeDto,
    send: (data: object) => void,
  ): Promise<void> {
    // Cloud runs are gated by the strict pre-auth hold below instead of the
    // bare balance check — checkCredit stays for mock/local, unchanged.
    const isCloud = this.runners.isCloud(dto.environment);
    if (!isCloud) await this.users.checkCredit(sub);

    // Cloud CODE runs always use Sonnet (product decision: opus plans, sonnet
    // implements), overriding whatever dto.model requested — this is also
    // what fixes the model-mismatch bug where the hold/usage-event bookkeeping
    // and the sandbox's actual --model flag could disagree (see models.ts).
    const model = isCloud ? CLOUD_CODE_MODEL_ID : resolveBranchModel(dto.model);
    const creditMultiplier = this.cfg.get<number>('billing.creditMultiplier') ?? 1.5;
    const session = await this.sessions.getSession(sub, sessionId);
    const nodeById = new Map(session.nodes.map((n) => [n.nodeId, n]));

    const parentNode = nodeById.get(dto.parentNodeId);
    if (!parentNode) {
      throw new NotFoundException(`Parent node ${dto.parentNodeId} not found`);
    }
    assertKindAllowed(parentNode.kind as NodeKind, 'CODE');

    // A CODE built from a PLAN reads the plan's content (planDocOf → its
    // sections). If the PLAN hasn't finished streaming it has no sections yet,
    // so building now would hand the agent an empty plan ("implement the plan"
    // with no plan) — reject rather than run an empty query. The frontend also
    // disables Build until the PLAN settles; this is the backstop.
    if (parentNode.kind === 'PLAN' && !parentNode.sections?.length) {
      throw new BadRequestException('The plan is still being generated — wait for it to finish before building.');
    }

    // Resolve BEFORE any write below (auto-branch or the CODE node itself) —
    // an invalid/unavailable environment must 400 cleanly, never leave an
    // orphaned 'running' node (or a stray auto-branch fork) behind it. The
    // project/repo lookup is a pure read, so it's hoisted up here too (used
    // again for branchName below) — an unreachable-private-repo or a
    // github-mock+explicit-cloud combination must 400 the same way.
    const runner = this.runners.resolve(dto.environment);
    const project = session.projectId ? await this.db.getProject(sub, session.projectId) : null;
    const repo = await this.resolveRunRepo(sub, project?.repoRef ?? null, dto.environment);

    const emit = (data: object) => { try { send(data); } catch { /* client gone */ } };

    // nodeId is minted here — BEFORE the auto-branch fork below — so the cloud
    // hold (keyed by nodeId) can be placed before ANY node for this request is
    // persisted. A 402 here leaves nothing behind, the same clean-failure
    // property checkCredit had at the very top before this change.
    const nodeId = ulid();
    let maxBudgetUsd: number | undefined;
    if (isCloud) {
      const { ceilingUsd } = await this.users.placeHold(sub, sessionId, nodeId, model);
      // ceilingUsd is a BILLED dollar figure (what the user is charged, i.e.
      // claudeCost × multiplier) — claude's own --max-budget-usd is denominated
      // in its RAW cost, so map back down by the multiplier before passing it
      // through, otherwise the sandbox would let claude spend multiplier×
      // too much before its own cap trips.
      maxBudgetUsd = ceilingUsd / creditMultiplier;
    }

    try {
      // Auto-branch on a parallel instruction: submitting a NEW instruction while
      // sitting on a CODE node that already has a *finished* CODE child means this
      // is a second, independent line of work off the same commit — not a
      // continuation of that child — so fork a BRANCH node first rather than
      // silently adding a second child under the same parent. A running/errored
      // existing child is left alone (retry semantics, newest-wins, no branch) so
      // a failed/in-flight attempt can still just be retried directly.
      let autoBranchNode: NodeItem | null = null;
      if (parentNode.kind === 'CODE') {
        const existingCodeChildren = session.nodes.filter((n) => n.kind === 'CODE' && n.parentId === parentNode.nodeId);
        const tip = existingCodeChildren.length
          ? existingCodeChildren.reduce((a, b) => (a.createdAt > b.createdAt ? a : b))
          : null;
        if (tip?.agentStatus === 'done' && parentNode.commitSha) {
          const existingBranchNames = new Set(
            session.nodes.filter((n) => n.branchName).map((n) => n.branchName as string),
          );
          const branchNodeId = ulid();
          const branchNow = new Date().toISOString();
          const newBranchName = this.slugifyBranchName(dto.instruction, existingBranchNames);
          const pushedField = await this.tryEagerBranchPush(sub, project, parentNode, newBranchName);
          autoBranchNode = {
            PK: `SESSION#${sessionId}`,
            SK: `NODE#${branchNodeId}`,
            nodeId: branchNodeId,
            parentId: parentNode.nodeId,
            kind: 'BRANCH',
            title: newBranchName,
            emoji: null,
            query: `Fork from ${parentNode.commitSha.slice(0, 7)}`,
            lede: '',
            sections: [],
            fromSection: null,
            fromText: null,
            createdAt: branchNow,
            branchName: newBranchName,
            commitSha: parentNode.commitSha,
            ...pushedField,
          };
          await this.db.putNode(autoBranchNode);
          nodeById.set(branchNodeId, autoBranchNode);
          await Promise.all([
            this.sessions.touchUpdatedAt(sub, sessionId),
            this.sessions.incrementNodeCount(sub, sessionId, 1),
          ]);
          emit({ type: 'branch-init', node: autoBranchNode });
        }
      }

      // The CODE node's real parent is the auto-branch node when one was just
      // forked, otherwise the requested parent, unchanged.
      const codeParentId = autoBranchNode?.nodeId ?? dto.parentNodeId;

      // Lane identity: the nearest BRANCH ancestor's branchName wins; otherwise a
      // PLAN's own forked branchName (F1); otherwise the project's default
      // branch; otherwise a bare 'main' (no project at all).
      const chain = findRailChain(nodeById, codeParentId);
      const branchName = chain.branchNode?.branchName ?? chain.planNode?.branchName ?? project?.repoRef.defaultBranch ?? 'main';
      // A from-scratch ('new') project has no real git history — the sandbox
      // git-inits an empty repo, so the parent's synthesized/placeholder commitSha
      // is not a real tree to check out. Same for a parent that predates a repo
      // attach (PATCH /projects/:id/repo): its sha was fabricated against the old
      // fake repo and doesn't exist on the just-attached remote — clone
      // default-branch HEAD instead of a doomed baseRef checkout.
      const parentPredatesAttach = !!project?.repoAttachedAt && parentNode.createdAt < project.repoAttachedAt;
      const baseCommitSha = repo?.init || parentPredatesAttach ? null : (parentNode.commitSha ?? null);

      // Tracks the cloud sandbox's REAL boot progress (provisioning → image
      // pull → starting agent), updated via ctx.onPhase below — the heartbeat
      // timer (further down) reads this on every tick. Mock/local runners never
      // call onPhase, so their heartbeat just stays on this generic default.
      let latestPhase = 'Working…';

      const ctx: AgentRunContext = {
        instruction: dto.instruction,
        planDoc: chain.planNode ? planDocOf(chain.planNode) : null,
        // The rail's BRANCH node (if any) carries the OKR a user set on the
        // fork point (#220) — fed to the agent alongside the plan doc.
        okr: chain.branchNode?.okr ?? null,
        branchName,
        baseCommitSha,
        repoRef: project?.repoRef ?? null,
        plugins: project?.plugins ?? [],
        ancestorCodeSummaries: chain.codeAncestors.slice(0, 10).map(codeSummaryOf),
        model,
        // Attachments only ever feed the prompt — never spread onto the NodeItem
        // below (Dynamoose saveUnknown:false would silently strip them anyway,
        // but the node schema doesn't declare the field at all; see root CLAUDE.md).
        attachments: dto.attachments?.map((a) => ({ name: a.name, content: a.content })),
        runId: nodeId,
        repo,
        // Billing plumbing (ADR-0004) — sub/sessionId complete the identity
        // tagged onto a cloud sandbox at create; mock/local ignore all three.
        sub,
        sessionId,
        maxBudgetUsd,
        onPhase: (msg) => { latestPhase = msg; },
      };

      const now = new Date().toISOString();

      const node: NodeItem = {
        PK: `SESSION#${sessionId}`,
        SK: `NODE#${nodeId}`,
        nodeId,
        parentId: codeParentId,
        kind: 'CODE',
        title: dto.instruction.slice(0, 60),
        emoji: null,
        query: dto.instruction,
        lede: '',
        sections: [],
        fromSection: null,
        fromText: null,
        createdAt: now,
        model,
        branchName,
        agentStatus: 'running',
      };
      const agentRun: AgentRunItem = {
        PK: `SESSION#${sessionId}`,
        SK: `AGENTRUN#${nodeId}`,
        nodeId,
        status: 'running',
        events: '[]',
        createdAt: now,
        updatedAt: now,
      };

      // Persist BEFORE any SSE event — a refresh mid-run must restore a real node,
      // not drop back to nothing. Denormalize the run status onto the session
      // (History "Continue" rail) in the same write — mirrors node.agentStatus.
      await Promise.all([
        this.db.putNode(node),
        this.db.putAgentRun(agentRun),
        this.db.updateSessionMeta(sub, sessionId, { lastRunStatus: 'running' }),
      ]);
      emit({ type: 'init', node });

      // MockAgentRunner (and any future non-streaming runner) awaits a full LLM
      // transcript before yielding its first event — without this, the client
      // sees a frozen "Starting…" for the entire LLM latency (~18s on the mock).
      // These synthetic events go over SSE only (never pushed to `events` below,
      // so they're never persisted to the AgentRun row). Negative, descending
      // seqs can never collide with the runner's own server-assigned seqs
      // (0, 1, 2, ... below), so the frontend can always tell a heartbeat apart
      // from a real event. Cleared on the first real yield (in the loop) and
      // again in `finally` as a leak-proof backstop for a runner that throws
      // before ever yielding. Each tick emits `latestPhase` (above) — real
      // cloud boot progress when the runner reports it via ctx.onPhase, or the
      // one generic default for a mock/local run that never calls it.
      let heartbeatSeq = -1;
      const heartbeatTimer = setInterval(() => {
        emit({
          type: 'agent-event',
          event: {
            seq: heartbeatSeq--,
            ts: new Date().toISOString(),
            kind: 'text',
            payload: latestPhase,
          },
        });
      }, 3000);

      const events: AgentEvent[] = [];
      let final: AgentRunFinal | null = null;
      let lastPersistAt = Date.now();
      let seq = 0;
      try {
        for await (const item of runner.run(ctx)) {
          clearInterval(heartbeatTimer); // first real yield ends the heartbeat window
          if (item.type === 'result') { final = item.result; continue; }
          const event: AgentEvent = { ...item.event, seq: seq++ }; // server owns seq numbering
          events.push(event);
          emit({ type: 'agent-event', event });
          if (events.length % 10 === 0 || Date.now() - lastPersistAt >= 2000) {
            await this.db.updateAgentRun(sessionId, nodeId, { events: serializeEventsCapped(events), updatedAt: new Date().toISOString() });
            lastPersistAt = Date.now();
          }
        }
        if (!final) throw new Error('Agent runner ended without a result');
      } catch (err) {
        // Log the real cause — the client only gets friendlyLlmError's generic
        // message and the node keeps just agentStatus:'error', so without this a
        // run failure (e.g. a mock-transcript validation throw) is invisible in
        // the server logs.
        this.logger.error(`Agent run failed for node ${nodeId} (env=${dto.environment ?? 'default'}): ${String(err)}`, (err as Error)?.stack);
        // persist events accumulated so far — a refresh after a mid-run failure must
        // show the log up to the failure, not a stale snapshot
        await Promise.all([
          this.db.updateNode(sessionId, nodeId, { agentStatus: 'error' }),
          this.db.updateAgentRun(sessionId, nodeId, { status: 'error', events: serializeEventsCapped(events), updatedAt: new Date().toISOString() }),
          this.db.updateSessionMeta(sub, sessionId, { lastRunStatus: 'error' }),
        ]);
        if (isCloud) await this.releaseHoldOnFailure(sub, sessionId, nodeId, model);
        // Fire-and-forget — a push failure must never affect the run pipeline
        // (agent runs take ~7 minutes, so the notification is the whole point).
        this.apns.sendToUser(sub, 'Run failed', dto.instruction.slice(0, 60)).catch(() => {});
        emit({ type: 'error', message: friendlyLlmError(err as Error) });
        return;
      } finally {
        clearInterval(heartbeatTimer);
      }

      // No real git backend exists yet (mock-first per ADR-0001) — a random
      // SHA-1-shaped hex string stands in for the commit this run "produces"
      // when the runner itself doesn't supply a real one.
      const commitSha = final.commitSha ?? randomBytes(20).toString('hex');

      // Fallback title/lede — a simple truncation of the commit message — used
      // whenever generateCodeMeta below fails or is unavailable. Trim trailing
      // punctuation the word cut leaves behind ("feat: Scaffold CLI with Commander,").
      const fallbackTitle = final.commitMessage.split(/\s+/).filter(Boolean).slice(0, 5).join(' ').replace(/[,;:.]+$/, '') || node.title;
      const fallbackLede = final.commitMessage.length > 140 ? `${final.commitMessage.slice(0, 140)}…` : final.commitMessage;

      // LLM-generated title/emoji/lede (haiku — cheap) reads far better on the
      // map card than the raw commit-message truncation. Never let a flaky call
      // here break the commit — any error falls back to the truncation above.
      let title = fallbackTitle;
      let lede = fallbackLede;
      let emoji: string | undefined;
      try {
        const meta = await this.llm.generateCodeMeta(dto.instruction, final.commitMessage, final.diffSummary, ALIAS_TO_ID.haiku);
        title = meta.title;
        lede = meta.lede;
        emoji = meta.emoji;
      } catch (err) {
        this.logger.warn(`generateCodeMeta failed for node ${nodeId} — falling back to commit-message truncation: ${String(err)}`);
      }

      // Hoisted above the billing ternary so BOTH the cloud (reconcileHold) and
      // mock (billUsage) paths get a persisted per-commit cost on the node —
      // previously this was computed only inside the cloud arm, for billing
      // only, so a mock run's node never carried a cost at all.
      const runCost = this.runCostUsd(final, creditMultiplier);

      await Promise.all([
        this.db.updateNode(sessionId, nodeId, {
          title,
          lede,
          commitSha,
          commitMessage: final.commitMessage,
          diffSummary: final.diffSummary,
          agentStatus: 'done',
          runCostUsd: runCost,
          ...(final.runSummary ? { runSummary: final.runSummary } : {}),
          ...(emoji ? { emoji } : {}),
          ...(final.workspace
            ? { workspace: final.workspace, ...(final.workspaceExpiresAt ? { workspaceExpiresAt: final.workspaceExpiresAt } : {}) }
            : {}),
          ...(final.pushed !== undefined
            ? { pushed: final.pushed, ...(final.pushError ? { pushError: final.pushError } : {}) }
            : {}),
          ...(final.budgetExceeded !== undefined ? { budgetExceeded: final.budgetExceeded } : {}),
        }),
        this.db.updateAgentRun(sessionId, nodeId, {
          status: 'done',
          events: serializeEventsCapped(events),
          commitSha,
          branchName,
          commitMessage: final.commitMessage,
          diffSummary: final.diffSummary,
          updatedAt: new Date().toISOString(),
        }),
        this.db.updateSessionMeta(sub, sessionId, { lastRunStatus: 'done' }),
      ]);
      await Promise.all([
        this.sessions.touchUpdatedAt(sub, sessionId),
        this.sessions.incrementNodeCount(sub, sessionId, 1),
        isCloud
          ? this.users.reconcileHold(
              sub, sessionId, nodeId,
              runCost,
              final.inputTokens, final.outputTokens, final.model, 'CODE',
            )
          : this.users.billUsage(sub, final.inputTokens, final.outputTokens, 'CODE', sessionId, nodeId, final.model),
      ]);

      // Fire-and-forget — see the error-path note above.
      this.apns.sendToUser(sub, 'Run complete', title).catch(() => {});

      emit({ type: 'commit', sha: commitSha, branchName, message: final.commitMessage, diffSummary: final.diffSummary });
      emit({
        type: 'done',
        node: {
          ...node,
          title,
          lede,
          commitMessage: final.commitMessage,
          diffSummary: final.diffSummary,
          agentStatus: 'done',
          commitSha,
          runCostUsd: runCost,
          ...(final.runSummary ? { runSummary: final.runSummary } : {}),
          ...(emoji ? { emoji } : {}),
          ...(final.workspace
            ? { workspace: final.workspace, ...(final.workspaceExpiresAt ? { workspaceExpiresAt: final.workspaceExpiresAt } : {}) }
            : {}),
          ...(final.pushed !== undefined
            ? { pushed: final.pushed, ...(final.pushError ? { pushError: final.pushError } : {}) }
            : {}),
          ...(final.budgetExceeded !== undefined ? { budgetExceeded: final.budgetExceeded } : {}),
        },
      });
    } catch (err) {
      // Anything that throws between placeHold and the handled runner-error
      // path above (auto-branch persistence, chain resolution, persist-first
      // writes, the done-block's own writes) must still release the reserve
      // for cloud — reconcileStaleHolds is only a 30-minute crash-net backstop,
      // not the primary release path for an in-process failure.
      this.logger.error(`CODE stream setup failed for node ${nodeId} (env=${dto.environment ?? 'default'}): ${String(err)}`, (err as Error)?.stack);
      if (isCloud) await this.releaseHoldOnFailure(sub, sessionId, nodeId, model);
      throw err;
    }
  }

  async getAgentRun(sub: string, sessionId: string, nodeId: string): Promise<AgentRunItem> {
    await this.sessions.getSession(sub, sessionId); // ownership check
    const run = await this.db.getAgentRun(sessionId, nodeId);
    if (!run) throw new NotFoundException(`AgentRun for node ${nodeId} not found`);
    return run;
  }

  async updateNode(sub: string, sessionId: string, nodeId: string, dto: UpdateNodeDto): Promise<void> {
    await this.sessions.getSession(sub, sessionId);
    const node = await this.db.getNode(sessionId, nodeId);
    if (!node) throw new NotFoundException(`Node ${nodeId} not found`);

    const updates: Partial<Pick<NodeItem, 'title' | 'starred' | 'okr'>> = {};
    if (dto.title !== undefined) updates.title = dto.title;
    if (dto.starred !== undefined) updates.starred = dto.starred;
    // Omitted (not sent at all) leaves okr unchanged — there is no clear path
    // (updateNode does not null-strip; see root CLAUDE.md's Dynamoose note).
    if (dto.okr !== undefined) updates.okr = dto.okr;
    if (!Object.keys(updates).length) return;

    await this.db.updateNode(sessionId, nodeId, updates);
  }

  async deleteBranch(sub: string, sessionId: string, nodeId: string): Promise<void> {
    await this.sessions.getSession(sub, sessionId);

    const allNodes = await this.db.queryNodes(sessionId);
    const nodeMap = new Map(allNodes.map((n) => [n.nodeId, n]));

    if (!nodeMap.has(nodeId)) throw new NotFoundException(`Node ${nodeId} not found`);

    // BFS to collect the full subtree
    const toDelete = new Set<string>([nodeId]);
    const queue = [nodeId];
    while (queue.length) {
      const current = queue.shift()!;
      for (const n of nodeMap.values()) {
        if (n.parentId === current && !toDelete.has(n.nodeId)) {
          toDelete.add(n.nodeId);
          queue.push(n.nodeId);
        }
      }
    }

    const [allAnnotations, allHighlights] = await Promise.all([
      this.db.queryAnnotations(sessionId),
      this.db.queryHighlights(sessionId),
    ]);

    const annIds = allAnnotations.filter((a) => toDelete.has(a.nodeId)).map((a) => a.annId);
    const hlIds = allHighlights.filter((h) => toDelete.has(h.nodeId)).map((h) => h.hlId);

    await Promise.all([
      this.db.batchDeleteNodes(sessionId, [...toDelete]),
      this.db.batchDeleteAnnotations(sessionId, annIds),
      this.db.batchDeleteHighlights(sessionId, hlIds),
    ]);

    await Promise.all([
      this.sessions.touchUpdatedAt(sub, sessionId),
      this.sessions.incrementNodeCount(sub, sessionId, -toDelete.size),
    ]);
  }
}
