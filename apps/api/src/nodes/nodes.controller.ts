import {
  Controller,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiParam } from '@nestjs/swagger';
import { CurrentUser } from '@/auth/current-user.decorator';
import { CognitoUser } from '@/auth/jwt.strategy';
import { NodesService } from './nodes.service';
import { CreateNodeDto } from './dto/create-node.dto';
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
