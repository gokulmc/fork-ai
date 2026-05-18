import { Injectable, NotFoundException } from '@nestjs/common';
import { ulid } from 'ulid';
import { DynamoRepository } from '@/dynamo/dynamo.repository';
import type { HighlightItem } from '@/dynamo/dynamo.interfaces';
import { SessionsService } from '@/sessions/sessions.service';
import { CreateHighlightDto } from './dto/create-highlight.dto';
import { UpdateHighlightDto } from './dto/update-highlight.dto';

@Injectable()
export class HighlightsService {
  constructor(
    private readonly db: DynamoRepository,
    private readonly sessions: SessionsService,
  ) {}

  async create(sub: string, sessionId: string, dto: CreateHighlightDto): Promise<HighlightItem> {
    await this.sessions.getSession(sub, sessionId);

    const hlId = ulid();
    const now = new Date().toISOString();

    const item: HighlightItem = {
      PK: `SESSION#${sessionId}`,
      SK: `HL#${hlId}`,
      hlId,
      nodeId: dto.nodeId,
      sectionId: dto.sectionId,
      text: dto.text,
      bg: dto.bg ?? null,
      fg: dto.fg ?? null,
      createdAt: now,
    };

    await this.db.putHighlight(item);
    return item;
  }

  async update(sub: string, sessionId: string, hlId: string, dto: UpdateHighlightDto): Promise<void> {
    await this.sessions.getSession(sub, sessionId);
    const item = await this.db.getHighlight(sessionId, hlId);
    if (!item) throw new NotFoundException(`Highlight ${hlId} not found`);

    const updates: Partial<Pick<HighlightItem, 'bg' | 'fg'>> = {};
    if (dto.bg !== undefined) updates.bg = dto.bg;
    if (dto.fg !== undefined) updates.fg = dto.fg;

    if (Object.keys(updates).length) {
      await this.db.updateHighlight(sessionId, hlId, updates);
    }
  }

  async delete(sub: string, sessionId: string, hlId: string): Promise<void> {
    await this.sessions.getSession(sub, sessionId);
    const item = await this.db.getHighlight(sessionId, hlId);
    if (!item) throw new NotFoundException(`Highlight ${hlId} not found`);
    await this.db.deleteHighlight(sessionId, hlId);
  }
}
