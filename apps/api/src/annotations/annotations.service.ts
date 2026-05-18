import { Injectable, NotFoundException } from '@nestjs/common';
import { ulid } from 'ulid';
import { DynamoRepository } from '@/dynamo/dynamo.repository';
import { SessionsService } from '@/sessions/sessions.service';
import { CreateAnnotationDto } from './dto/create-annotation.dto';

@Injectable()
export class AnnotationsService {
  constructor(
    private readonly db: DynamoRepository,
    private readonly sessions: SessionsService,
  ) {}

  private sessionPk(sessionId: string) { return `SESSION#${sessionId}`; }
  private annSk(annId: string) { return `ANN#${annId}`; }

  async create(
    sub: string,
    sessionId: string,
    dto: CreateAnnotationDto,
  ): Promise<Record<string, unknown>> {
    await this.sessions.getSession(sub, sessionId);

    const annId = ulid();
    const now = new Date().toISOString();

    const item: Record<string, unknown> = {
      PK: this.sessionPk(sessionId),
      SK: this.annSk(annId),
      annId,
      kind: dto.kind,
      text: dto.text,
      fromTitle: dto.fromTitle,
      nodeId: dto.nodeId,
      sectionId: dto.sectionId,
      createdAt: now,
    };

    await this.db.put(item);
    await this.sessions.touchUpdatedAt(sub, sessionId);
    return item;
  }

  async list(sub: string, sessionId: string): Promise<Record<string, unknown>[]> {
    await this.sessions.getSession(sub, sessionId);
    return this.db.query(this.sessionPk(sessionId), 'ANN#');
  }

  async delete(sub: string, sessionId: string, annId: string): Promise<void> {
    await this.sessions.getSession(sub, sessionId);
    const item = await this.db.get(this.sessionPk(sessionId), this.annSk(annId));
    if (!item) throw new NotFoundException(`Annotation ${annId} not found`);
    await this.db.delete(this.sessionPk(sessionId), this.annSk(annId));
  }
}
