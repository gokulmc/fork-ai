import { Body, Controller, Get, NotFoundException, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '@/auth/current-user.decorator';
import { AdminGuard } from '@/auth/admin.guard';
import { Public } from '@/auth/public.decorator';
import type { CognitoUser } from '@/auth/jwt.strategy';
import { BlogSubmissionsService } from './blog-submissions.service';
import { CreateBlogSubmissionDto } from './dto/create-blog-submission.dto';
import { UpdateBlogSubmissionDto } from './dto/update-blog-submission.dto';

@ApiTags('blog-submissions')
@ApiBearerAuth()
@Controller('blog-submissions')
export class BlogSubmissionsController {
  constructor(private readonly svc: BlogSubmissionsService) {}

  // Authenticated (global JwtAuthGuard) — any logged-in user may submit.
  @Post()
  @ApiOperation({ summary: 'Submit a blog post for review' })
  create(@CurrentUser() user: CognitoUser, @Body() dto: CreateBlogSubmissionDto): Promise<{ id: string }> {
    return this.svc.create(user, dto);
  }

  // The current user's own submissions.
  @Get('mine')
  @ApiOperation({ summary: "List the current user's blog submissions" })
  listMine(@CurrentUser() user: CognitoUser) {
    return this.svc.listMine(user.sub);
  }

  // Public: approved posts shown on the blog.
  @Public()
  @Get('published')
  @ApiOperation({ summary: 'List published (approved) community posts' })
  listPublished() {
    return this.svc.listPublished();
  }

  @Public()
  @Get('by-slug/:slug')
  @ApiOperation({ summary: 'Get a published community post by slug' })
  async getBySlug(@Param('slug') slug: string) {
    const post = await this.svc.getPublishedBySlug(slug);
    if (!post) throw new NotFoundException('Post not found');
    return post;
  }

  @Get()
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: 'List blog submissions for review (admin)' })
  list() {
    return this.svc.list();
  }

  @Patch(':id')
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: 'Approve / reject a blog submission (admin)' })
  setStatus(@Param('id') id: string, @Body() dto: UpdateBlogSubmissionDto) {
    return this.svc.setStatus(id, dto.status);
  }
}
