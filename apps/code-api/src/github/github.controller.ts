import { Body, Controller, Get, Post, Query, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { ConfigService } from '@nestjs/config';
import { GithubService } from './github.service';
import { GithubAppService } from './github-app.service';
import { LinkInstallationDto } from './dto/link-installation.dto';
import { Public } from '@/auth/public.decorator';
import { CurrentUser } from '@/auth/current-user.decorator';
import { CognitoUser } from '@/auth/jwt.strategy';

@ApiTags('github')
@Controller('github')
export class GithubController {
  constructor(
    private readonly githubSvc: GithubService,
    private readonly githubApp: GithubAppService,
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

  // ── GitHub App (Contents:Read v1 — private-repo sandbox clones) ────────────

  @Public()
  @Get('app/install')
  @ApiOperation({ summary: 'Redirect to the GitHub App installation flow — user picks the account/org during install, so no auth is needed here' })
  installApp(@Res() res: Response) {
    if (!this.githubApp.isConfigured()) {
      return res.status(503).json({ message: 'GitHub App not configured on this server yet.' });
    }
    return res.redirect(this.githubApp.installUrl());
  }

  @Post('app/installations')
  @ApiOperation({ summary: 'Link a completed GitHub App installation to the current user (called by the /github/setup redirect page)' })
  async linkInstallation(@CurrentUser() user: CognitoUser, @Body() dto: LinkInstallationDto) {
    await this.githubApp.verifyAndStoreInstallation(user.sub, dto.installationId);
    return { linked: true };
  }
}
