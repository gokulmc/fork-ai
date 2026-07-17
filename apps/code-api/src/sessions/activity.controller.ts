import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { CurrentUser } from '@/auth/current-user.decorator';
import { CognitoUser } from '@/auth/jwt.strategy';
import { SessionsService } from './sessions.service';

// Separate controller (not GET /sessions/activity on SessionsController) so
// this static route can never collide with GET /sessions/:sessionId.
@ApiTags('activity')
@Controller('activity')
export class ActivityController {
  constructor(private readonly sessionsService: SessionsService) {}

  @Get()
  @ApiOperation({ summary: 'Commit-activity aggregates for the current user — 30-day per-session counts + a 366-day per-day contribution calendar' })
  activity(@CurrentUser() user: CognitoUser) {
    return this.sessionsService.activity(user.sub);
  }
}
