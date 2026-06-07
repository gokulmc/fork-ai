import { Controller, Get, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '@/auth/public.decorator';
import { BlogViewsService } from './blog-views.service';

@ApiTags('blog-views')
@Controller('blog-views')
export class BlogViewsController {
  constructor(private readonly svc: BlogViewsService) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'View counts for all posts (slug → count)' })
  list(): Promise<Record<string, number>> {
    return this.svc.list();
  }

  @Public()
  @Get(':slug')
  @ApiOperation({ summary: 'View count for one post' })
  async count(@Param('slug') slug: string): Promise<{ slug: string; views: number }> {
    return { slug, views: await this.svc.getCount(slug) };
  }

  @Public()
  @Post(':slug')
  @ApiOperation({ summary: 'Increment a post view count' })
  async increment(@Param('slug') slug: string): Promise<{ slug: string; views: number }> {
    const views = await this.svc.increment(slug);
    return { slug, views };
  }
}
