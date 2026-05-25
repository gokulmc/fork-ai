import { Controller, Get, Patch, Body } from '@nestjs/common';
import { ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';
import { CurrentUser } from '@/auth/current-user.decorator';
import { CognitoUser } from '@/auth/jwt.strategy';
import { UsersService } from './users.service';

class PatchMeDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  hasOnboarded?: boolean;
}

@ApiTags('users')
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  @ApiOperation({ summary: 'Get current user profile (auto-creates on first call)' })
  async getMe(@CurrentUser() user: CognitoUser) {
    return this.usersService.upsert(user);
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
}
