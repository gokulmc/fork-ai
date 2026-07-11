import { Controller, Get, Post, Body, Param } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiParam } from '@nestjs/swagger';
import { CurrentUser } from '@/auth/current-user.decorator';
import { CognitoUser } from '@/auth/jwt.strategy';
import { ProjectsService } from './projects.service';
import { CreateProjectDto } from './dto/create-project.dto';

@ApiTags('projects')
@Controller('projects')
export class ProjectsController {
  constructor(private readonly projectsService: ProjectsService) {}

  @Post()
  @ApiOperation({ summary: 'Create a project — creates its repo ref and an empty session (map)' })
  create(@CurrentUser() user: CognitoUser, @Body() dto: CreateProjectDto) {
    return this.projectsService.create(user.sub, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List projects' })
  list(@CurrentUser() user: CognitoUser) {
    return this.projectsService.list(user.sub);
  }

  @Get(':projectId')
  @ApiOperation({ summary: 'Get a single project' })
  @ApiParam({ name: 'projectId', description: 'ULID project ID' })
  getOne(@CurrentUser() user: CognitoUser, @Param('projectId') projectId: string) {
    return this.projectsService.getOne(user.sub, projectId);
  }
}
