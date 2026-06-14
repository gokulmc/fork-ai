import {
  Controller, Get, Post, Patch, Delete,
  Body, Param, HttpCode, HttpStatus, Res, Header, HttpException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiParam } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Response } from 'express';
import { Public } from '@/auth/public.decorator';
import { CurrentUser } from '@/auth/current-user.decorator';
import { CognitoUser } from '@/auth/jwt.strategy';
import { ShareService } from './share.service';
import { CreateNodeDto } from '@/nodes/dto/create-node.dto';
import { UpdateNodeDto } from '@/nodes/dto/update-node.dto';
import { CreateHighlightDto } from '@/highlights/dto/create-highlight.dto';
import { UpdateHighlightDto } from '@/highlights/dto/update-highlight.dto';
import { CreateSessionDto } from '@/sessions/dto/create-session.dto';
import { friendlyLlmError } from '@/llm/llm.service';

@ApiTags('share')
@Controller('share')
export class ShareController {
  constructor(private readonly shareService: ShareService) {}

  @Public()
  @Post()
  @Throttle({ default: { ttl: 3_600_000, limit: 5 } }) // 5 trial sessions/hour/IP — each fires a root LLM stream
  @Header('Content-Type', 'text/event-stream')
  @Header('Cache-Control', 'no-cache')
  @Header('Connection', 'keep-alive')
  @ApiOperation({ summary: 'Create a trial session — streams root node, returns token in done event (public)' })
  async createTrialSession(@Body() dto: CreateSessionDto, @Res() res: Response) {
    const send = (data: object) => res.write(`data: ${JSON.stringify(data)}\n\n`);
    try {
      await this.shareService.createTrialSession(dto, send);
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

  @Public()
  @Get(':token')
  @ApiOperation({ summary: 'Resolve share token — returns full session (public)' })
  @ApiParam({ name: 'token', description: 'Opaque share token from share URL' })
  getSession(@Param('token') token: string) {
    return this.shareService.getSession(token);
  }

  @Public()
  @Post(':token/nodes')
  @Throttle({ default: { ttl: 3_600_000, limit: 30 } }) // 30 guest branches/hour/IP — each fires a branch LLM call
  @ApiOperation({ summary: 'Create a branch node as a guest (public)' })
  @ApiParam({ name: 'token', description: 'Opaque share token' })
  createNode(@Param('token') token: string, @Body() dto: CreateNodeDto) {
    return this.shareService.createNode(token, dto);
  }

  @Public()
  @Patch(':token/nodes/:nodeId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Update a node (rename and/or star) as a guest (public)' })
  @ApiParam({ name: 'token', description: 'Opaque share token' })
  updateNode(
    @Param('token') token: string,
    @Param('nodeId') nodeId: string,
    @Body() dto: UpdateNodeDto,
  ) {
    return this.shareService.updateNode(token, nodeId, dto);
  }

  @Public()
  @Post(':token/highlights')
  @ApiOperation({ summary: 'Create a highlight as a guest (public)' })
  @ApiParam({ name: 'token', description: 'Opaque share token' })
  createHighlight(@Param('token') token: string, @Body() dto: CreateHighlightDto) {
    return this.shareService.createHighlight(token, dto);
  }

  @Public()
  @Patch(':token/highlights/:hlId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Update a highlight colour as a guest (public)' })
  @ApiParam({ name: 'token', description: 'Opaque share token' })
  updateHighlight(
    @Param('token') token: string,
    @Param('hlId') hlId: string,
    @Body() dto: UpdateHighlightDto,
  ) {
    return this.shareService.updateHighlight(token, hlId, dto);
  }

  @Public()
  @Delete(':token/highlights/:hlId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a highlight as a guest (public)' })
  @ApiParam({ name: 'token', description: 'Opaque share token' })
  deleteHighlight(@Param('token') token: string, @Param('hlId') hlId: string) {
    return this.shareService.deleteHighlight(token, hlId);
  }

  @Post(':token/claim')
  @ApiOperation({ summary: 'Claim shared session into authenticated user history (requires login)' })
  @ApiParam({ name: 'token', description: 'Opaque share token' })
  claimSession(@CurrentUser() user: CognitoUser, @Param('token') token: string) {
    return this.shareService.claimSession(user.sub, token);
  }
}
