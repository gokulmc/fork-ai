import { Injectable, NotFoundException } from '@nestjs/common';
import { ulid } from 'ulid';
import { DynamoRepository } from '@/dynamo/dynamo.repository';
import type { AnnotationItem } from '@/dynamo/dynamo.interfaces';
import { SessionsService } from '@/sessions/sessions.service';
import { CreateAnnotationDto } from './dto/create-annotation.dto';

@Injectable()
export class AnnotationsService {
  constructor(
    private readonly db: DynamoRepository,
    private readonly sessions: SessionsService,
  ) {}

  async create(sub: string, sessionId: string, dto: CreateAnnotationDto): Promise<AnnotationItem> {
    await this.sessions.getSession(sub, sessionId);

    const annId = ulid();
    const now = new Date().toISOString();

    const item: AnnotationItem = {
      PK: `SESSION#${sessionId}`,
      SK: `ANN#${annId}`,
      annId,
      kind: dto.kind,
      text: dto.text,
      fromTitle: dto.fromTitle,
      nodeId: dto.nodeId,
      sectionId: dto.sectionId,
      createdAt: now,
    };

    await this.db.putAnnotation(item);
    await this.sessions.touchUpdatedAt(sub, sessionId);
    return item;
  }

  async list(sub: string, sessionId: string): Promise<AnnotationItem[]> {
    await this.sessions.getSession(sub, sessionId);
    return this.db.queryAnnotations(sessionId);
  }

  async delete(sub: string, sessionId: string, annId: string): Promise<void> {
    await this.sessions.getSession(sub, sessionId);
    const item = await this.db.getAnnotation(sessionId, annId);
    if (!item) throw new NotFoundException(`Annotation ${annId} not found`);
    await this.db.deleteAnnotation(sessionId, annId);
  }
}
