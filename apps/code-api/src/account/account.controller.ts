import { Controller, Delete, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { CurrentUser } from '@/auth/current-user.decorator';
import { CognitoUser } from '@/auth/jwt.strategy';
import { AccountService } from './account.service';

@ApiTags('account')
@Controller('users')
export class AccountController {
  constructor(private readonly accountService: AccountService) {}

  @Delete('me')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Permanently delete the current user: all sessions/data, then the Cognito identity' })
  deleteMe(@CurrentUser() user: CognitoUser) {
    return this.accountService.deleteAccount(user);
  }
}
