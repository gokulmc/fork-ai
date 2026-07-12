import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  HttpCode,
  HttpStatus,
  Res,
  Header,
  HttpException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiParam } from '@nestjs/swagger';
import { Response } from 'express';
import { friendlyLlmError } from '@/llm/llm.service';
import { CurrentUser } from '@/auth/current-user.decorator';
import { CognitoUser } from '@/auth/jwt.strategy';
import { NodesService } from './nodes.service';
import { CreateNodeDto } from './dto/create-node.dto';
import { CreateMixNodeDto } from './dto/create-mix-node.dto';
import { CreateBranchNodeDto } from './dto/create-branch-node.dto';
import { CreateCodeNodeDto } from './dto/create-code-node.dto';
import { CreatePrNodeDto } from './dto/create-pr-node.dto';
import { UpdateNodeDto } from './dto/update-node.dto';

@ApiTags('nodes')
@Controller('sessions/:sessionId/nodes')
export class NodesController {
  constructor(private readonly nodesService: NodesService) {}

  @Post()
  @ApiOperation({ summary: 'Create a child node — fires LLM expandSection or followUpFromHighlight' })
  @ApiParam({ name: 'sessionId', description: 'ULID session ID' })
  create(
    @CurrentUser() user: CognitoUser,
    @Param('sessionId') sessionId: string,
    @Body() dto: CreateNodeDto,
  ) {
    return this.nodesService.createNode(user.sub, sessionId, dto);
  }

  @Post('mix')
  @ApiOperation({ summary: 'Create a MIX node — synthesizes content from multiple selected nodes' })
  @ApiParam({ name: 'sessionId', description: 'ULID session ID' })
  createMix(
    @CurrentUser() user: CognitoUser,
    @Param('sessionId') sessionId: string,
    @Body() dto: CreateMixNodeDto,
  ) {
    return this.nodesService.createMixNode(user.sub, sessionId, dto);
  }

  @Post('branch')
  @ApiOperation({ summary: 'Fork a git branch from a CODE node commit — no LLM call' })
  @ApiParam({ name: 'sessionId', description: 'ULID session ID' })
  createBranch(
    @CurrentUser() user: CognitoUser,
    @Param('sessionId') sessionId: string,
    @Body() dto: CreateBranchNodeDto,
  ) {
    return this.nodesService.createBranchNode(user.sub, sessionId, dto);
  }

  @Post('pr')
  @ApiOperation({ summary: 'Open a PR — creates a MERGE node onto the target branch tip, no LLM call' })
  @ApiParam({ name: 'sessionId', description: 'ULID session ID' })
  createPr(
    @CurrentUser() user: CognitoUser,
    @Param('sessionId') sessionId: string,
    @Body() dto: CreatePrNodeDto,
  ) {
    return this.nodesService.createPrNode(user.sub, sessionId, dto);
  }

  @Post(':nodeId/merge')
  @ApiOperation({ summary: 'Merge an open PR — spawns the merge commit CODE node, no LLM call' })
  @ApiParam({ name: 'sessionId', description: 'ULID session ID' })
  @ApiParam({ name: 'nodeId', description: 'ULID node ID — the open MERGE node' })
  mergePr(
    @CurrentUser() user: CognitoUser,
    @Param('sessionId') sessionId: string,
    @Param('nodeId') nodeId: string,
  ) {
    return this.nodesService.mergePrNode(user.sub, sessionId, nodeId);
  }

  @Post('code/stream')
  @Header('Content-Type', 'text/event-stream')
  @Header('Cache-Control', 'no-cache')
  @Header('Connection', 'keep-alive')
  @ApiOperation({ summary: 'Create a CODE node with streaming SSE — replays a mocked agent run (init → agent-event… → commit → done)' })
  @ApiParam({ name: 'sessionId', description: 'ULID session ID' })
  async createCodeStream(
    @CurrentUser() user: CognitoUser,
    @Param('sessionId') sessionId: string,
    @Body() dto: CreateCodeNodeDto,
    @Res() res: Response,
  ) {
    const send = (data: object) => res.write(`data: ${JSON.stringify(data)}\n\n`);
    try {
      await this.nodesService.createCodeNodeStreaming(user.sub, sessionId, dto, send);
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

  @Get(':nodeId/agent-run')
  @ApiOperation({ summary: 'Get the AgentRun record for a CODE node — persisted agent events + commit info' })
  @ApiParam({ name: 'sessionId', description: 'ULID session ID' })
  @ApiParam({ name: 'nodeId', description: 'ULID node ID' })
  getAgentRun(
    @CurrentUser() user: CognitoUser,
    @Param('sessionId') sessionId: string,
    @Param('nodeId') nodeId: string,
  ) {
    return this.nodesService.getAgentRun(user.sub, sessionId, nodeId);
  }

  @Patch(':nodeId')
  @ApiOperation({ summary: 'Update a node (rename and/or star)' })
  @ApiParam({ name: 'sessionId', description: 'ULID session ID' })
  @ApiParam({ name: 'nodeId', description: 'ULID node ID' })
  update(
    @CurrentUser() user: CognitoUser,
    @Param('sessionId') sessionId: string,
    @Param('nodeId') nodeId: string,
    @Body() dto: UpdateNodeDto,
  ) {
    return this.nodesService.updateNode(user.sub, sessionId, nodeId, dto);
  }

  @Delete(':nodeId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a branch and all its descendants' })
  @ApiParam({ name: 'sessionId', description: 'ULID session ID' })
  @ApiParam({ name: 'nodeId', description: 'ULID node ID' })
  deleteBranch(
    @CurrentUser() user: CognitoUser,
    @Param('sessionId') sessionId: string,
    @Param('nodeId') nodeId: string,
  ) {
    return this.nodesService.deleteBranch(user.sub, sessionId, nodeId);
  }
}
