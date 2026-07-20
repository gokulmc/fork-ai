import { Body, Controller, Get, Post, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { GithubAppService } from './github-app.service';
import { LinkInstallationDto } from './dto/link-installation.dto';
import { Public } from '@/auth/public.decorator';
import { CurrentUser } from '@/auth/current-user.decorator';
import { CognitoUser } from '@/auth/jwt.strategy';

@ApiTags('github')
@Controller('github')
export class GithubController {
  constructor(private readonly githubApp: GithubAppService) {}

  @Get('repos')
  @ApiOperation({ summary: "List the user's GitHub repos across all installed accounts/orgs" })
  repos(@CurrentUser() user: CognitoUser) {
    return this.githubApp.listInstallationRepos(user.sub);
  }

  @Get('app/status')
  @ApiOperation({ summary: 'GitHub App install status for the current user' })
  status(@CurrentUser() user: CognitoUser) {
    return this.githubApp.listInstallations(user.sub);
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
