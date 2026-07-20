import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ulid } from 'ulid';
import { DynamoRepository } from '@/dynamo/dynamo.repository';
import type { ProjectItem } from '@/dynamo/dynamo.interfaces';
import { SessionsService } from '@/sessions/sessions.service';
import type { ProjectSeed } from '@/sessions/sessions.service';
import { GithubService } from '@/github/github.service';
import { RepoImportService } from './repo-import.service';
import { CreateProjectDto } from './dto/create-project.dto';

@Injectable()
export class ProjectsService {
  private readonly logger = new Logger(ProjectsService.name);

  constructor(
    private readonly db: DynamoRepository,
    private readonly sessions: SessionsService,
    private readonly github: GithubService,
    private readonly repoImport: RepoImportService,
  ) {}

  async create(sub: string, dto: CreateProjectDto): Promise<ProjectItem> {
    // The session is the project's map. provider 'new' has no repo to seed
    // from — instead it seeds a BRANCH root carrying dto.rootQuery, which the
    // frontend immediately fills via the fill-root stream
    // (createRootNodeStreaming). provider 'github' without a rootQuery tries a
    // full-history import first (RepoImportService); a 'github' project
    // created with a rootQuery (ADR-0007) skips import and gets the same
    // BRANCH-root seed as 'new'. A synthesized 2-node seed (buildSeed) is the
    // fallback for every other case, including a failed/empty import.
    const { sessionId, branchCount } = await this.buildSession(sub, dto);

    const projectId = ulid();
    const now = new Date().toISOString();
    const project: ProjectItem = {
      PK: `USER#${sub}`,
      SK: `PROJECT#${projectId}`,
      projectId,
      name: dto.name,
      // Dynamoose v4 type-checks nested objects by constructor and rejects the
      // class-transformer RepoRefDto instance — it must be a plain object.
      repoRef: { ...dto.repoRef },
      plugins: [...dto.plugins],
      sessionId,
      createdAt: now,
      updatedAt: now,
      branchCount,
    };

    await this.db.putProject(project);
    // projectId is only known after the project exists, so it's attached to the
    // (already-created) session as a follow-up patch rather than at seed time.
    await this.db.updateSessionMeta(sub, sessionId, { projectId });
    return project;
  }

  // rootQuery present → skip import, seed with rootQuery: an attach-existing
  // import never sends rootQuery (unchanged behaviour), but a repo just
  // created via github.com/new (ADR-0007) is created together with a
  // rootQuery, and has no history worth importing — it gets the same
  // BRANCH-root fill-root seed as provider 'new' (see
  // SessionsService.createProjectSession's rootQuery branch). Every other
  // case (mock, new, github without rootQuery, or a null import) falls back
  // to the synthesized 2-node seed, which has exactly one branch (the default).
  private async buildSession(sub: string, dto: CreateProjectDto): Promise<{ sessionId: string; branchCount: number }> {
    if (dto.repoRef.provider === 'github' && !dto.rootQuery) {
      const sessionId = ulid();
      const nodes = await this.repoImport.buildImportedNodes(sub, dto.repoRef, sessionId);
      if (nodes) {
        // Distinct branchName values actually seeded (not nonDefaultBranches.length
        // — a branch whose merge base got cut off by a cap is silently skipped, so
        // counting the real nodes is the accurate figure). Always includes the
        // default branch since every trunk commit carries it.
        const branchCount = new Set(nodes.map((n) => n.branchName).filter((b): b is string => !!b)).size || 1;
        const importedSessionId = await this.sessions.createImportedProjectSession(sub, dto.name, sessionId, nodes);
        return { sessionId: importedSessionId, branchCount };
      }
    }
    const seed = await this.buildSeed(sub, dto);
    const sessionId = await this.sessions.createProjectSession(sub, dto.name, seed, dto.rootQuery);
    return { sessionId, branchCount: 1 };
  }

  // A mock repo has no real commit history to seed from — every non-github
  // provider (today: github-mock) gets a synthesized, unimported seed. A real
  // github fetch that fails (rate limit, revoked token, network blip) degrades
  // the same way rather than failing project creation outright.
  private async buildSeed(sub: string, dto: CreateProjectDto): Promise<ProjectSeed> {
    if (dto.repoRef.provider !== 'github') {
      return { defaultBranch: dto.repoRef.defaultBranch, first: null, head: null, imported: false };
    }
    try {
      const repoSeed = await this.github.getRepoSeed(sub, dto.repoRef.owner, dto.repoRef.repo, dto.repoRef.defaultBranch);
      return { ...repoSeed, imported: true };
    } catch (err) {
      this.logger.warn(`GitHub repo seed fetch failed for ${dto.repoRef.owner}/${dto.repoRef.repo}: ${(err as Error).message}`);
      return { defaultBranch: dto.repoRef.defaultBranch, first: null, head: null, imported: false };
    }
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
