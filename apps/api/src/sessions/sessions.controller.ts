import { Controller, Get, Post, Patch, Delete, Body, Param, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiParam } from '@nestjs/swagger';
import { CurrentUser } from '@/auth/current-user.decorator';
import { CognitoUser } from '@/auth/jwt.strategy';
import { SessionsService } from './sessions.service';
import { CreateSessionDto } from './dto/create-session.dto';
import { UpdateSessionDto } from './dto/update-session.dto';

@ApiTags('sessions')
@Controller('sessions')
export class SessionsController {
  constructor(private readonly sessionsService: SessionsService) {}

  @Post()
  @ApiOperation({ summary: 'Create a session — fires LLM answerQuery and persists root node' })
  create(@CurrentUser() user: CognitoUser, @Body() dto: CreateSessionDto) {
    return this.sessionsService.create(user.sub, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List sessions (newest first)' })
  list(@CurrentUser() user: CognitoUser) {
    return this.sessionsService.list(user.sub);
  }

  @Get(':sessionId')
  @ApiOperation({ summary: 'Get full session — all nodes, annotations, highlights in one call' })
  @ApiParam({ name: 'sessionId', description: 'ULID session ID' })
  getOne(@CurrentUser() user: CognitoUser, @Param('sessionId') sessionId: string) {
    return this.sessionsService.getSession(user.sub, sessionId);
  }

  @Patch(':sessionId')
  @ApiOperation({ summary: 'Rename session' })
  update(
    @CurrentUser() user: CognitoUser,
    @Param('sessionId') sessionId: string,
    @Body() dto: UpdateSessionDto,
  ) {
    return this.sessionsService.update(user.sub, sessionId, dto);
  }

  @Delete(':sessionId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete session + all nodes, annotations, highlights' })
  delete(@CurrentUser() user: CognitoUser, @Param('sessionId') sessionId: string) {
    return this.sessionsService.delete(user.sub, sessionId);
  }
}
