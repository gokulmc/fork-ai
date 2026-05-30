import { Injectable, UnauthorizedException, BadGatewayException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client } from '@notionhq/client';
import { DynamoRepository } from '@/dynamo/dynamo.repository';

interface ChildEntry {
  index: number;
  children: unknown[];
  childrenMap: ChildEntry[];
}

@Injectable()
export class NotionService {
  // Short-lived in-memory map: state → sub+email (survives only the OAuth round-trip, ~60 s)
  private readonly pendingStates = new Map<string, { sub: string; email: string; expiresAt: number }>();

  constructor(
    private readonly cfg: ConfigService,
    private readonly db: DynamoRepository,
  ) {}

  // ── OAuth ──────────────────────────────────────────────────────────────────

  buildAuthUrl(sub: string, email: string): string {
    const state = `${sub}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    this.pendingStates.set(state, { sub, email, expiresAt: Date.now() + 5 * 60_000 });
    const params = new URLSearchParams({
      client_id: this.cfg.get<string>('notion.clientId')!,
      redirect_uri: this.cfg.get<string>('notion.redirectUri')!,
      response_type: 'code',
      owner: 'user',
      state,
    });
    return `https://api.notion.com/v1/oauth/authorize?${params}`;
  }

  async handleCallback(code: string, state: string): Promise<string> {
    const entry = this.pendingStates.get(state);
    if (!entry || Date.now() > entry.expiresAt) {
      throw new UnauthorizedException('Invalid or expired OAuth state');
    }
    this.pendingStates.delete(state);

    const { sub, email } = entry;
    const token = await this.exchangeCode(code);
    // Upsert UserMeta so the record exists even if the user never called GET /users/me
    const existing = await this.db.getUserMeta(sub);
    if (!existing) {
      const now = new Date().toISOString();
      await this.db.putUserMeta({ PK: `USER#${sub}`, SK: 'METADATA', sub, email, createdAt: now, updatedAt: now });
    }
    await this.db.updateNotionToken(sub, token);
    return sub;
  }

  private async exchangeCode(code: string): Promise<string> {
    const clientId = this.cfg.get<string>('notion.clientId')!;
    const clientSecret = this.cfg.get<string>('notion.clientSecret')!;
    const redirectUri = this.cfg.get<string>('notion.redirectUri')!;

    const res = await fetch('https://api.notion.com/v1/oauth/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
      },
      body: JSON.stringify({ grant_type: 'authorization_code', code, redirect_uri: redirectUri }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new UnauthorizedException(`Notion token exchange failed: ${text}`);
    }
    const data = await res.json() as { access_token: string };
    return data.access_token;
  }

  // ── Status ─────────────────────────────────────────────────────────────────

  async getStatus(sub: string): Promise<{ connected: boolean }> {
    const user = await this.db.getUserMeta(sub);
    return { connected: !!user?.notionAccessToken };
  }

  // ── Page search ────────────────────────────────────────────────────────────

  async searchPages(sub: string, query: string): Promise<{ id: string; title: string; url: string }[]> {
    const token = await this.requireToken(sub);
    const notion = new Client({ auth: token });
    const res = await notion.search({
      query,
      filter: { value: 'page', property: 'object' },
      page_size: 10,
    });
    return res.results.map((page: any) => ({
      id: page.id,
      title: page.properties?.title?.title?.[0]?.plain_text
        ?? page.properties?.Name?.title?.[0]?.plain_text
        ?? 'Untitled',
      url: page.url,
    }));
  }

  // ── Push page ──────────────────────────────────────────────────────────────

  async pushPage(
    sub: string,
    title: string,
    blocks: unknown[],
    childrenMap: unknown[],
    parentPageId?: string,
  ): Promise<{ url: string }> {
    const token = await this.requireToken(sub);
    const notion = new Client({ auth: token });

    // blocks contain flat blocks (toggle children stripped) + inline table rows.
    const firstBatch = blocks.slice(0, 100) as any[];
    const rest = blocks.slice(100);

    // No parentPageId → create a private page at the workspace top level. This
    // only succeeds if the integration was granted workspace-level access.
    const parent = parentPageId
      ? { page_id: parentPageId }
      : { workspace: true as const };

    let page: Awaited<ReturnType<typeof notion.pages.create>>;
    try {
      page = await notion.pages.create({
        parent,
        properties: {
          title: { title: [{ type: 'text', text: { content: title } }] },
        },
        children: firstBatch,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : JSON.stringify(err);
      console.error('[notion/push] pages.create failed:', msg);
      // Sentinel the frontend can detect to show grant-workspace-access guidance.
      if (!parentPageId) throw new BadGatewayException('NOTION_WORKSPACE_DENIED');
      throw new BadGatewayException(`Notion pages.create: ${msg}`);
    }

    if (rest.length) {
      for (let i = 0; i < rest.length; i += 100) {
        try {
          await notion.blocks.children.append({
            block_id: page.id,
            children: rest.slice(i, i + 100) as any[],
          });
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : JSON.stringify(err);
          console.error(`[notion/push] append batch ${i} failed:`, msg);
          throw new BadGatewayException(`Notion append batch ${i}: ${msg}`);
        }
      }
    }

    if (childrenMap.length) {
      const createdIds = await this.listAllBlockIds(notion, page.id);
      await this.appendChildrenRecursive(notion, createdIds, childrenMap as ChildEntry[]);
    }

    return { url: (page as any).url };
  }

  private async appendChildrenRecursive(
    notion: Client,
    parentIds: string[],
    childrenMap: ChildEntry[],
  ): Promise<void> {
    for (const { index, children, childrenMap: subMap } of childrenMap) {
      if (index >= parentIds.length || children.length === 0) continue;
      const blockId = parentIds[index];

      for (let i = 0; i < children.length; i += 100) {
        try {
          await notion.blocks.children.append({
            block_id: blockId,
            children: children.slice(i, i + 100) as any[],
          });
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : JSON.stringify(err);
          console.error(`[notion/push] appendChildren (blockId=${blockId} index=${index} batch=${i}) failed:`, msg);
          throw new BadGatewayException(`Notion appendChildren blockId=${blockId}: ${msg}`);
        }
      }

      if (subMap.length > 0) {
        const subIds = await this.listAllBlockIds(notion, blockId);
        await this.appendChildrenRecursive(notion, subIds, subMap);
      }
    }
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private async listAllBlockIds(notion: Client, blockId: string): Promise<string[]> {
    const ids: string[] = [];
    let cursor: string | undefined;
    do {
      const result = await notion.blocks.children.list({
        block_id: blockId,
        page_size: 100,
        ...(cursor ? { start_cursor: cursor } : {}),
      });
      ids.push(...result.results.map((b: any) => b.id));
      cursor = result.has_more && result.next_cursor ? result.next_cursor : undefined;
    } while (cursor);
    return ids;
  }

  private async requireToken(sub: string): Promise<string> {
    const user = await this.db.getUserMeta(sub);
    if (!user?.notionAccessToken) {
      throw new UnauthorizedException('Notion account not connected');
    }
    return user.notionAccessToken;
  }
}
