import { Injectable } from '@nestjs/common';
import { ulid } from 'ulid';
import { DynamoRepository } from '@/dynamo/dynamo.repository';
import type { BlogSubmissionItem } from '@/dynamo/dynamo.interfaces';
import { LlmService } from '@/llm/llm.service';
import type { CognitoUser } from '@/auth/jwt.strategy';
import type { CreateBlogSubmissionDto } from './dto/create-blog-submission.dto';

const BLOG_SUB_PK = 'BLOGSUB';

// Public-facing shape for a published (approved) post — no author email.
export interface PublicBlogPost {
  id: string;
  slug: string;
  emoji: string;
  title: string;
  summary: string;
  body: string;
  createdAt: string;
}

function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'post'
  );
}

function toPublic(s: BlogSubmissionItem): PublicBlogPost {
  return {
    id: s.id,
    slug: s.slug,
    emoji: s.emoji || '📝',
    title: s.title,
    summary: s.summary ?? '',
    body: s.body,
    createdAt: s.createdAt,
  };
}

@Injectable()
export class BlogSubmissionsService {
  constructor(
    private readonly repo: DynamoRepository,
    private readonly llm: LlmService,
  ) {}

  async create(user: CognitoUser, dto: CreateBlogSubmissionDto): Promise<{ id: string }> {
    const id = ulid();
    const emoji = await this.llm.pickEmoji(dto.title, dto.body);
    const slug = `${slugify(dto.title)}-${id.slice(-6).toLowerCase()}`;
    await this.repo.putBlogSubmission({
      PK: BLOG_SUB_PK,
      SK: id,
      id,
      emoji,
      slug,
      authorSub: user.sub,
      authorEmail: user.email,
      title: dto.title,
      summary: dto.summary ?? '',
      body: dto.body,
      status: 'pending',
      createdAt: new Date().toISOString(),
    });
    return { id };
  }

  list(limit = 100): Promise<BlogSubmissionItem[]> {
    return this.repo.listBlogSubmissions(limit);
  }

  listMine(sub: string): Promise<BlogSubmissionItem[]> {
    return this.repo.listBlogSubmissionsByAuthor(sub);
  }

  async setStatus(id: string, status: 'approved' | 'rejected' | 'pending'): Promise<{ id: string; status: string }> {
    await this.repo.updateBlogSubmissionStatus(id, status);
    return { id, status };
  }

  async listPublished(): Promise<PublicBlogPost[]> {
    const subs = await this.repo.listApprovedBlogSubmissions();
    return subs.map(toPublic);
  }

  async getPublishedBySlug(slug: string): Promise<PublicBlogPost | null> {
    const sub = await this.repo.getApprovedBlogSubmissionBySlug(slug);
    return sub ? toPublic(sub) : null;
  }
}
