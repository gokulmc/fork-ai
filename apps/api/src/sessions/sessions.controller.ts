import { Controller, Get, Post, Patch, Delete, Body, Param, HttpCode, HttpStatus, Res, Header } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiParam } from '@nestjs/swagger';
import { Response } from 'express';
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

  @Post('stream')
  @Header('Content-Type', 'text/event-stream')
  @Header('Cache-Control', 'no-cache')
  @Header('Connection', 'keep-alive')
  @ApiOperation({ summary: 'Create a session with streaming SSE — sections appear as LLM generates them' })
  async createStream(
    @CurrentUser() user: CognitoUser,
    @Body() dto: CreateSessionDto,
    @Res() res: Response,
  ) {
    const send = (data: object) => res.write(`data: ${JSON.stringify(data)}\n\n`);
    try {
      await this.sessionsService.createStreaming(user.sub, dto, send);
    } catch (err) {
      send({ type: 'error', message: (err as Error).message });
    } finally {
      res.end();
    }
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
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Update session (rename, notionPageUrl)' })
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

  @Post(':sessionId/share')
  @ApiOperation({ summary: 'Generate a share token for this session' })
  @ApiParam({ name: 'sessionId', description: 'ULID session ID' })
  generateShare(@CurrentUser() user: CognitoUser, @Param('sessionId') sessionId: string) {
    return this.sessionsService.generateShareToken(user.sub, sessionId);
  }

  @Delete(':sessionId/share')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Revoke the active share token for this session' })
  @ApiParam({ name: 'sessionId', description: 'ULID session ID' })
  revokeShare(@CurrentUser() user: CognitoUser, @Param('sessionId') sessionId: string) {
    return this.sessionsService.revokeShareToken(user.sub, sessionId);
  }

  @Get(':sessionId/share')
  @ApiOperation({ summary: 'Get share status for this session' })
  @ApiParam({ name: 'sessionId', description: 'ULID session ID' })
  getShare(@CurrentUser() user: CognitoUser, @Param('sessionId') sessionId: string) {
    return this.sessionsService.getShareStatus(user.sub, sessionId);
  }
}
