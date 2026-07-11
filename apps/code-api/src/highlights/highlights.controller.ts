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
import { HighlightsService } from './highlights.service';
import { CreateHighlightDto } from './dto/create-highlight.dto';
import { UpdateHighlightDto } from './dto/update-highlight.dto';

@ApiTags('highlights')
@Controller('sessions/:sessionId/highlights')
export class HighlightsController {
  constructor(private readonly highlightsService: HighlightsService) {}

  @Post()
  @ApiOperation({ summary: 'Persist a text highlight mark' })
  @ApiParam({ name: 'sessionId', description: 'ULID session ID' })
  create(
    @CurrentUser() user: CognitoUser,
    @Param('sessionId') sessionId: string,
    @Body() dto: CreateHighlightDto,
  ) {
    return this.highlightsService.create(user.sub, sessionId, dto);
  }

  @Patch(':hlId')
  @ApiOperation({ summary: 'Update highlight colour' })
  @ApiParam({ name: 'sessionId', description: 'ULID session ID' })
  @ApiParam({ name: 'hlId', description: 'ULID highlight ID' })
  update(
    @CurrentUser() user: CognitoUser,
    @Param('sessionId') sessionId: string,
    @Param('hlId') hlId: string,
    @Body() dto: UpdateHighlightDto,
  ) {
    return this.highlightsService.update(user.sub, sessionId, hlId, dto);
  }

  @Delete(':hlId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove a highlight mark' })
  @ApiParam({ name: 'sessionId', description: 'ULID session ID' })
  @ApiParam({ name: 'hlId', description: 'ULID highlight ID' })
  delete(
    @CurrentUser() user: CognitoUser,
    @Param('sessionId') sessionId: string,
    @Param('hlId') hlId: string,
  ) {
    return this.highlightsService.delete(user.sub, sessionId, hlId);
  }
}
