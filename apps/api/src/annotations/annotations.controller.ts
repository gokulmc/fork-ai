import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiParam } from '@nestjs/swagger';
import { CurrentUser } from '@/auth/current-user.decorator';
import { CognitoUser } from '@/auth/jwt.strategy';
import { AnnotationsService } from './annotations.service';
import { CreateAnnotationDto } from './dto/create-annotation.dto';

@ApiTags('annotations')
@Controller('sessions/:sessionId/annotations')
export class AnnotationsController {
  constructor(private readonly annotationsService: AnnotationsService) {}

  @Post()
  @ApiOperation({ summary: 'Create a note or callout annotation' })
  @ApiParam({ name: 'sessionId', description: 'ULID session ID' })
  create(
    @CurrentUser() user: CognitoUser,
    @Param('sessionId') sessionId: string,
    @Body() dto: CreateAnnotationDto,
  ) {
    return this.annotationsService.create(user.sub, sessionId, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List all annotations for a session' })
  @ApiParam({ name: 'sessionId', description: 'ULID session ID' })
  list(
    @CurrentUser() user: CognitoUser,
    @Param('sessionId') sessionId: string,
  ) {
    return this.annotationsService.list(user.sub, sessionId);
  }

  @Delete(':annId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete an annotation' })
  @ApiParam({ name: 'sessionId', description: 'ULID session ID' })
  @ApiParam({ name: 'annId', description: 'ULID annotation ID' })
  delete(
    @CurrentUser() user: CognitoUser,
    @Param('sessionId') sessionId: string,
    @Param('annId') annId: string,
  ) {
    return this.annotationsService.delete(user.sub, sessionId, annId);
  }
}
