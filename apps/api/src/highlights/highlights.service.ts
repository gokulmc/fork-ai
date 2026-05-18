import { Injectable, NotFoundException } from '@nestjs/common';
import { ulid } from 'ulid';
import { DynamoRepository } from '@/dynamo/dynamo.repository';
import { SessionsService } from '@/sessions/sessions.service';
import { CreateHighlightDto } from './dto/create-highlight.dto';
import { UpdateHighlightDto } from './dto/update-highlight.dto';

@Injectable()
export class HighlightsService {
  constructor(
    private readonly db: DynamoRepository,
    private readonly sessions: SessionsService,
  ) {}

  private sessionPk(sessionId: string) { return `SESSION#${sessionId}`; }
  private hlSk(hlId: string) { return `HL#${hlId}`; }

  async create(
    sub: string,
    sessionId: string,
    dto: CreateHighlightDto,
  ): Promise<Record<string, unknown>> {
    await this.sessions.getSession(sub, sessionId);

    const hlId = ulid();
    const now = new Date().toISOString();

    const item: Record<string, unknown> = {
      PK: this.sessionPk(sessionId),
      SK: this.hlSk(hlId),
      hlId,
      nodeId: dto.nodeId,
      sectionId: dto.sectionId,
      text: dto.text,
      bg: dto.bg ?? null,
      fg: dto.fg ?? null,
      createdAt: now,
    };

    await this.db.put(item);
    return item;
  }

  async update(
    sub: string,
    sessionId: string,
    hlId: string,
    dto: UpdateHighlightDto,
  ): Promise<void> {
    await this.sessions.getSession(sub, sessionId);
    const item = await this.db.get(this.sessionPk(sessionId), this.hlSk(hlId));
    if (!item) throw new NotFoundException(`Highlight ${hlId} not found`);

    const updates: Record<string, unknown> = {};
    if (dto.bg !== undefined) updates['bg'] = dto.bg;
    if (dto.fg !== undefined) updates['fg'] = dto.fg;

    if (Object.keys(updates).length > 0) {
      await this.db.update(this.sessionPk(sessionId), this.hlSk(hlId), updates);
    }
  }

  async delete(sub: string, sessionId: string, hlId: string): Promise<void> {
    await this.sessions.getSession(sub, sessionId);
    const item = await this.db.get(this.sessionPk(sessionId), this.hlSk(hlId));
    if (!item) throw new NotFoundException(`Highlight ${hlId} not found`);
    await this.db.delete(this.sessionPk(sessionId), this.hlSk(hlId));
  }
}
