import {
  Controller, Get, Post, Patch, Delete,
  Body, Param, HttpCode, HttpStatus, Res, Header,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiParam } from '@nestjs/swagger';
import { Response } from 'express';
import { Public } from '@/auth/public.decorator';
import { CurrentUser } from '@/auth/current-user.decorator';
import { CognitoUser } from '@/auth/jwt.strategy';
import { ShareService } from './share.service';
import { CreateNodeDto } from '@/nodes/dto/create-node.dto';
import { CreateHighlightDto } from '@/highlights/dto/create-highlight.dto';
import { UpdateHighlightDto } from '@/highlights/dto/update-highlight.dto';
import { CreateSessionDto } from '@/sessions/dto/create-session.dto';

@ApiTags('share')
@Controller('share')
export class ShareController {
  constructor(private readonly shareService: ShareService) {}

  @Public()
  @Post()
  @Header('Content-Type', 'text/event-stream')
  @Header('Cache-Control', 'no-cache')
  @Header('Connection', 'keep-alive')
  @ApiOperation({ summary: 'Create a trial session — streams root node, returns token in done event (public)' })
  async createTrialSession(@Body() dto: CreateSessionDto, @Res() res: Response) {
    const send = (data: object) => res.write(`data: ${JSON.stringify(data)}\n\n`);
    try {
      await this.shareService.createTrialSession(dto, send);
    } catch (err) {
      send({ type: 'error', message: (err as Error).message });
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
  @ApiOperation({ summary: 'Create a branch node as a guest (public)' })
  @ApiParam({ name: 'token', description: 'Opaque share token' })
  createNode(@Param('token') token: string, @Body() dto: CreateNodeDto) {
    return this.shareService.createNode(token, dto);
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
