import { Injectable, ForbiddenException, HttpException, HttpStatus } from '@nestjs/common';
import { DynamoRepository } from '@/dynamo/dynamo.repository';
import { SessionsService, FullSession, SessionSummary } from '@/sessions/sessions.service';
import { NodesService } from '@/nodes/nodes.service';
import { HighlightsService } from '@/highlights/highlights.service';
import { CreateNodeDto } from '@/nodes/dto/create-node.dto';
import { CreateHighlightDto } from '@/highlights/dto/create-highlight.dto';
import { UpdateHighlightDto } from '@/highlights/dto/update-highlight.dto';
import { CreateSessionDto } from '@/sessions/dto/create-session.dto';
import type { NodeItem, HighlightItem } from '@/dynamo/dynamo.interfaces';

@Injectable()
export class ShareService {
  constructor(
    private readonly db: DynamoRepository,
    private readonly sessions: SessionsService,
    private readonly nodes: NodesService,
    private readonly highlights: HighlightsService,
  ) {}

  private async resolve(token: string): Promise<{ sessionId: string; ownerSub: string }> {
    const share = await this.db.getShareToken(token);
    if (!share) throw new ForbiddenException('Invalid or revoked share token');
    return { sessionId: share.sessionId, ownerSub: share.ownerSub };
  }

  async createTrialSession(dto: CreateSessionDto, send: (data: object) => void): Promise<void> {
    return this.sessions.createTrialSessionStreaming(dto, send);
  }

  async getSession(token: string): Promise<FullSession> {
    return this.sessions.getSessionByToken(token);
  }

  async createNode(token: string, dto: CreateNodeDto): Promise<NodeItem> {
    const { sessionId, ownerSub } = await this.resolve(token);
    const meta = await this.db.getSessionMeta(ownerSub, sessionId);
    if (meta?.isTrial && (meta.nodeCount ?? 0) >= 5) {
      throw new HttpException('Trial node limit reached', HttpStatus.PAYMENT_REQUIRED);
    }
    return this.nodes.createNode(ownerSub, sessionId, dto, true);
  }

  async createHighlight(token: string, dto: CreateHighlightDto): Promise<HighlightItem> {
    const { sessionId, ownerSub } = await this.resolve(token);
    return this.highlights.create(ownerSub, sessionId, dto);
  }

  async updateHighlight(token: string, hlId: string, dto: UpdateHighlightDto): Promise<void> {
    const { sessionId, ownerSub } = await this.resolve(token);
    return this.highlights.update(ownerSub, sessionId, hlId, dto);
  }

  async deleteHighlight(token: string, hlId: string): Promise<void> {
    const { sessionId, ownerSub } = await this.resolve(token);
    return this.highlights.delete(ownerSub, sessionId, hlId);
  }

  async claimSession(guestSub: string, token: string): Promise<SessionSummary> {
    return this.sessions.claimSession(guestSub, token);
  }
}
