import { Injectable, NotFoundException } from '@nestjs/common';
import { ulid } from 'ulid';
import { DynamoRepository } from '@/dynamo/dynamo.repository';
import type { ProjectItem } from '@/dynamo/dynamo.interfaces';
import { SessionsService } from '@/sessions/sessions.service';
import { CreateProjectDto } from './dto/create-project.dto';

@Injectable()
export class ProjectsService {
  constructor(
    private readonly db: DynamoRepository,
    private readonly sessions: SessionsService,
  ) {}

  async create(sub: string, dto: CreateProjectDto): Promise<ProjectItem> {
    // The session is the project's map — create it empty (no root query) so it
    // exists before any CODE/learn node does.
    const sessionId = await this.sessions.createEmpty(sub, dto.name);

    const projectId = ulid();
    const now = new Date().toISOString();
    const project: ProjectItem = {
      PK: `USER#${sub}`,
      SK: `PROJECT#${projectId}`,
      projectId,
      name: dto.name,
      repoRef: dto.repoRef,
      plugins: dto.plugins,
      sessionId,
      createdAt: now,
      updatedAt: now,
    };

    await this.db.putProject(project);
    // projectId is only known after the project exists, so it's attached to the
    // (already-created) session as a follow-up patch rather than at createEmpty time.
    await this.db.updateSessionMeta(sub, sessionId, { projectId });
    return project;
  }

  async list(sub: string): Promise<ProjectItem[]> {
    return this.db.listProjects(sub);
  }

  async getOne(sub: string, projectId: string): Promise<ProjectItem> {
    const project = await this.db.getProject(sub, projectId);
    if (!project) throw new NotFoundException(`Project ${projectId} not found`);
    return project;
  }
}
