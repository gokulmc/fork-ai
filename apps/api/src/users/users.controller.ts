import { Controller, Get, Patch, Post, Body, Req } from '@nestjs/common';
import { ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString } from 'class-validator';
import { Request } from 'express';
import { CurrentUser } from '@/auth/current-user.decorator';
import { CognitoUser } from '@/auth/jwt.strategy';
import { UsersService } from './users.service';

class PatchMeDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  hasOnboarded?: boolean;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  persona?: string;
}

class ReferrerDto {
  @ApiProperty()
  @IsString()
  slug!: string;
}

@ApiTags('users')
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  @ApiOperation({ summary: 'Get current user profile (auto-creates on first call)' })
  async getMe(@CurrentUser() user: CognitoUser, @Req() req: Request) {
    return this.usersService.upsert(user, req.ip);
  }

  @Patch('me')
  @ApiOperation({ summary: 'Update current user profile' })
  async patchMe(@CurrentUser() user: CognitoUser, @Body() body: PatchMeDto) {
    await this.usersService.patchMe(user.sub, body);
  }

  @Get('me/usage')
  @ApiOperation({ summary: 'Get last 50 usage events for billing history' })
  async getUsage(@CurrentUser() user: CognitoUser) {
    return this.usersService.getUsageEvents(user.sub);
  }

  @Get('me/credit-events')
  @ApiOperation({ summary: 'Get last 50 credit events (top-ups and referral awards)' })
  async getCreditEvents(@CurrentUser() user: CognitoUser) {
    return this.usersService.getCreditEvents(user.sub);
  }

  @Post('me/referral-link')
  @ApiOperation({ summary: 'Get or create personal referral link (lazy slug generation)' })
  async getReferralLink(@CurrentUser() user: CognitoUser) {
    return this.usersService.getOrCreateReferralLink(user.sub, user.email);
  }

  @Post('me/referrer')
  @ApiOperation({ summary: 'Record who referred this user (idempotent)' })
  async recordReferrer(@CurrentUser() user: CognitoUser, @Body() body: ReferrerDto) {
    await this.usersService.recordReferral(user.sub, body.slug);
    return { ok: true };
  }
}
