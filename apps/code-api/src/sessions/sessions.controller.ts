import { Controller, Get, Post, Patch, Delete, Body, Param, HttpCode, HttpStatus, Res, Header, HttpException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiParam } from '@nestjs/swagger';
import { Response } from 'express';
import { friendlyLlmError } from '@/llm/llm.service';
import { CurrentUser } from '@/auth/current-user.decorator';
import { CognitoUser } from '@/auth/jwt.strategy';
import { SessionsService } from './sessions.service';
import { CreateSessionDto } from './dto/create-session.dto';
import { CreateDocumentDto } from './dto/create-document.dto';
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
      // Intentional HttpExceptions (out of credit, trial cap) pass through with
      // their status; anything else is sanitized so internals never reach the client.
      const isHttp = err instanceof HttpException;
      send({
        type: 'error',
        message: isHttp ? err.message : friendlyLlmError(err as Error),
        status: isHttp ? err.getStatus() : 500,
      });
    } finally {
      res.end();
    }
  }

  @Post('document/stream')
  @Header('Content-Type', 'text/event-stream')
  @Header('Cache-Control', 'no-cache')
  @Header('Connection', 'keep-alive')
  @ApiOperation({ summary: 'Build a whole mind-map from an uploaded document — streaming SSE (init → skeleton → node-done… → done)' })
  async createDocumentStream(
    @CurrentUser() user: CognitoUser,
    @Body() dto: CreateDocumentDto,
    @Res() res: Response,
  ) {
    const send = (data: object) => res.write(`data: ${JSON.stringify(data)}\n\n`);
    try {
      await this.sessionsService.createDocumentStreaming(user.sub, dto, send);
    } catch (err) {
      const isHttp = err instanceof HttpException;
      send({
        type: 'error',
        message: isHttp ? err.message : friendlyLlmError(err as Error),
        status: isHttp ? err.getStatus() : 500,
      });
    } finally {
      res.end();
    }
  }

  // Registered AFTER the static 'stream' and 'document/stream' routes — the
  // :sessionId param segment would otherwise capture 'document' for
  // POST /sessions/document/stream (Express matches in declaration order).
  @Post(':sessionId/stream')
  @Header('Content-Type', 'text/event-stream')
  @Header('Cache-Control', 'no-cache')
  @Header('Connection', 'keep-alive')
  @ApiOperation({ summary: 'Stream a root query into an EXISTING empty session (a Project map) — same SSE vocabulary as POST /sessions/stream' })
  @ApiParam({ name: 'sessionId', description: 'ULID session ID (must be owned by the caller and have zero nodes)' })
  async createRootNodeStream(
    @CurrentUser() user: CognitoUser,
    @Param('sessionId') sessionId: string,
    @Body() dto: CreateSessionDto,
    @Res() res: Response,
  ) {
    let wrote = false;
    const send = (data: object) => { wrote = true; res.write(`data: ${JSON.stringify(data)}\n\n`); };
    try {
      await this.sessionsService.createRootNodeStreaming(user.sub, sessionId, dto, send);
    } catch (err) {
      const isHttp = err instanceof HttpException;
      // Guard failures (not found / non-empty / out of credit) all throw before
      // the service's first emit — surface them as a real 4xx HTTP status, not a
      // 200 stream carrying only an error event. Headers aren't flushed until the
      // first write, so setting the status here is still possible.
      if (!wrote && isHttp) res.status(err.getStatus());
      send({
        type: 'error',
        message: isHttp ? err.message : friendlyLlmError(err as Error),
        status: isHttp ? err.getStatus() : 500,
      });
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
  @ApiOperation({ summary: 'Update session (rename)' })
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
