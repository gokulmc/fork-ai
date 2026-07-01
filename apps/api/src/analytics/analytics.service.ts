import { Injectable } from '@nestjs/common';
import { DynamoRepository } from '@/dynamo/dynamo.repository';

@Injectable()
export class AnalyticsService {
  constructor(private readonly repo: DynamoRepository) {}

  recordPageview(): Promise<number> {
    return this.repo.incrementPageView();
  }

  getPageviews(): Promise<number> {
    return this.repo.getPageViews();
  }
}
