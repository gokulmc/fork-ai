import { Controller, Get, Query, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { ConfigService } from '@nestjs/config';
import { GithubService } from './github.service';
import { Public } from '@/auth/public.decorator';
import { CurrentUser } from '@/auth/current-user.decorator';
import { CognitoUser } from '@/auth/jwt.strategy';

@ApiTags('github')
@Controller('github')
export class GithubController {
  constructor(
    private readonly githubSvc: GithubService,
    private readonly cfg: ConfigService,
  ) {}

  @Get('auth')
  @ApiOperation({ summary: 'Return GitHub OAuth URL for the frontend to redirect to' })
  auth(@CurrentUser() user: CognitoUser) {
    return { url: this.githubSvc.buildAuthUrl(user.sub, user.email) };
  }

  @Public()
  @Get('callback')
  @ApiOperation({ summary: 'GitHub OAuth callback — exchanges code, saves token, redirects to frontend' })
  async callback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Query('error') error: string,
    @Res() res: Response,
  ) {
    const frontendUrl = this.cfg.get<string>('frontendUrl')!;
    if (error || !code) {
      return res.redirect(`${frontendUrl}?github=error`);
    }
    try {
      await this.githubSvc.handleCallback(code, state);
      res.redirect(`${frontendUrl}?github=connected`);
    } catch {
      res.redirect(`${frontendUrl}?github=error`);
    }
  }

  @Get('status')
  @ApiOperation({ summary: 'Check whether the user has connected GitHub' })
  status(@CurrentUser() user: CognitoUser) {
    return this.githubSvc.getStatus(user.sub);
  }

  @Get('repos')
  @ApiOperation({ summary: "List the user's GitHub repos (owner/updated, up to 50)" })
  repos(@CurrentUser() user: CognitoUser) {
    return this.githubSvc.listRepos(user.sub);
  }
}
