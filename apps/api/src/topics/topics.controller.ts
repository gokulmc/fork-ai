import { Controller, Get, InternalServerErrorException, Logger } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '@/auth/public.decorator';
import { LlmService } from '@/llm/llm.service';

// Cache expires at midnight UTC so every user gets the same topics for the full calendar day
let cachedTopics: string[] | null = null;
let cacheExpiresAt = 0;

function nextMidnightUtc(): number {
  const now = new Date();
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
}

@ApiTags('topics')
@Controller('topics')
export class TopicsController {
  private readonly logger = new Logger(TopicsController.name);

  constructor(private readonly llm: LlmService) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'Trending research topics (web-searched once per day, same for all users)' })
  async getTopics(): Promise<{ topics: string[] }> {
    if (cachedTopics && Date.now() < cacheExpiresAt) {
      return { topics: cachedTopics };
    }

    try {
      const topics = await this.llm.getTrendingTopics();
      cachedTopics = topics;
      cacheExpiresAt = nextMidnightUtc();
      return { topics };
    } catch (err) {
      this.logger.error(`Failed to fetch trending topics: ${(err as Error).message}`);
      if (cachedTopics) return { topics: cachedTopics };
      throw new InternalServerErrorException('Could not load trending topics');
    }
  }
}
