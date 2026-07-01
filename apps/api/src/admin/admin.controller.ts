import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Query,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
  BadRequestException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsNumber, IsOptional, IsString } from 'class-validator';
import { AdminGuard } from '@/auth/admin.guard';
import { CurrentUser } from '@/auth/current-user.decorator';
import { CognitoUser } from '@/auth/jwt.strategy';
import { AdminService } from './admin.service';

class AdjustCreditDto {
  @ApiProperty({ description: 'USD amount — delta for "add" (may be negative) or absolute for "set"' })
  @IsNumber()
  amountUsd!: number;

  @ApiProperty({ enum: ['add', 'set'], default: 'add', required: false })
  @IsOptional()
  @IsIn(['add', 'set'])
  mode?: 'add' | 'set';
}

class PageQueryDto {
  @ApiProperty({ required: false, default: 25 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  limit?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  cursor?: string;
}

@ApiTags('admin')
@ApiBearerAuth()
@UseGuards(AdminGuard)
@Controller('admin')
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get('config')
  @ApiOperation({ summary: 'Current billing config values (read-only from env)' })
  getConfig() {
    return this.admin.getConfig();
  }

  @Get('metrics')
  @ApiOperation({ summary: 'Platform-wide totals (cached 60s; pass ?fresh=1 to bypass)' })
  getMetrics(@Query('fresh') fresh?: string) {
    return this.admin.getMetrics(fresh === '1' || fresh === 'true');
  }

  @Get('metrics/day/:date')
  @ApiOperation({ summary: 'One day drill-down: user-level usage + queries asked (date = YYYY-MM-DD)' })
  getDayMetrics(@Param('date') date: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new BadRequestException('date must be YYYY-MM-DD');
    }
    return this.admin.getDayMetrics(date);
  }

  @Get('users')
  @ApiOperation({ summary: 'All users, newest first' })
  listUsers() {
    return this.admin.listUsers();
  }

  @Get('users/:sub')
  @ApiOperation({ summary: 'User drill-down: profile + sessions + usage + payments' })
  getUser(@Param('sub') sub: string) {
    return this.admin.getUser(sub);
  }

  @Get('payments')
  @ApiOperation({ summary: 'All payments, newest first' })
  listPayments() {
    return this.admin.listPayments();
  }

  @Get('deployment')
  @ApiOperation({ summary: 'This API instance build/runtime info (version, commit, uptime)' })
  getDeployment() {
    return this.admin.getDeployment();
  }

  @Get('audit')
  @ApiOperation({ summary: 'Recent admin actions (credit adjustments, deletions)' })
  listAudit(@Query() q: PageQueryDto) {
    return this.admin.listAudit(clampLimit(q.limit));
  }

  @Get('trial-locations')
  @ApiOperation({ summary: 'Geolocated trial/guest sessions + conversion status, for the world map' })
  getTrialLocations() {
    return this.admin.getTrialLocations();
  }

  @Get('funnel')
  @ApiOperation({ summary: 'Top-of-funnel counts: views, first query, account, share/Notion, recharges, referral' })
  getFunnel() {
    return this.admin.getFunnel();
  }

  @Post('users/:sub/credit')
  @ApiOperation({ summary: 'Grant or set a user credit balance (USD)' })
  adjustCredit(
    @CurrentUser() actor: CognitoUser,
    @Param('sub') sub: string,
    @Body() dto: AdjustCreditDto,
  ) {
    return this.admin.adjustCredit(actor, sub, dto.amountUsd, dto.mode ?? 'add');
  }

  @Delete('sessions/:sub/:sessionId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Delete any user's session + all its nodes/annotations/highlights" })
  deleteSession(
    @CurrentUser() actor: CognitoUser,
    @Param('sub') sub: string,
    @Param('sessionId') sessionId: string,
  ) {
    return this.admin.deleteSession(actor, sub, sessionId);
  }
}

function clampLimit(limit?: number): number {
  if (!limit || limit < 1) return 25;
  return Math.min(limit, 100);
}
