import { Injectable } from '@nestjs/common';
import { DynamoRepository } from '@/dynamo/dynamo.repository';

@Injectable()
export class BlogViewsService {
  constructor(private readonly repo: DynamoRepository) {}

  increment(slug: string): Promise<number> {
    return this.repo.incrementBlogView(slug);
  }

  async getCount(slug: string): Promise<number> {
    const item = await this.repo.getBlogView(slug);
    return item?.views ?? 0;
  }

  async list(): Promise<Record<string, number>> {
    const items = await this.repo.listBlogViews();
    return Object.fromEntries(items.map((i) => [i.SK, i.views ?? 0]));
  }
}
