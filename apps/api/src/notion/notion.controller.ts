import {
  Controller, Get, Post, Query, Body, Res, Req,
  HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiOperation, ApiTags, ApiQuery, ApiBody } from '@nestjs/swagger';
import { Response, Request } from 'express';
import { ConfigService } from '@nestjs/config';
import { NotionService } from './notion.service';
import { Public } from '@/auth/public.decorator';
import { CurrentUser } from '@/auth/current-user.decorator';
import { CognitoUser } from '@/auth/jwt.strategy';
import { IsString, IsOptional, IsArray } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

class PushDto {
  @ApiProperty() @IsString() title!: string;
  @ApiProperty() @IsString() parentPageId!: string;
  @ApiProperty({ type: [Object] }) @IsArray() blocks!: unknown[];
  @ApiProperty({ type: [Object] }) @IsArray() childrenMap!: unknown[];
}

class SearchQueryDto {
  @ApiProperty({ required: false }) @IsOptional() @IsString() q?: string;
}

@ApiTags('notion')
@Controller('notion')
export class NotionController {
  constructor(
    private readonly notionSvc: NotionService,
    private readonly cfg: ConfigService,
  ) {}

  @Get('auth')
  @ApiOperation({ summary: 'Redirect user to Notion OAuth' })
  auth(@CurrentUser() user: CognitoUser, @Res() res: Response) {
    const url = this.notionSvc.buildAuthUrl(user.sub);
    res.redirect(url);
  }

  @Public()
  @Get('callback')
  @ApiOperation({ summary: 'Notion OAuth callback — exchanges code, saves token, redirects to frontend' })
  async callback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Query('error') error: string,
    @Res() res: Response,
  ) {
    const frontendUrl = this.cfg.get<string>('frontendUrl')!;
    if (error || !code) {
      return res.redirect(`${frontendUrl}?notion=error`);
    }
    try {
      await this.notionSvc.handleCallback(code, state);
      res.redirect(`${frontendUrl}?notion=connected`);
    } catch {
      res.redirect(`${frontendUrl}?notion=error`);
    }
  }

  @Get('status')
  @ApiOperation({ summary: 'Check whether the user has connected Notion' })
  status(@CurrentUser() user: CognitoUser) {
    return this.notionSvc.getStatus(user.sub);
  }

  @Get('pages')
  @ApiOperation({ summary: 'Search Notion pages to pick a parent' })
  @ApiQuery({ name: 'q', required: false })
  pages(@CurrentUser() user: CognitoUser, @Query() dto: SearchQueryDto) {
    return this.notionSvc.searchPages(user.sub, dto.q ?? '');
  }

  @Post('push')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Create a Notion page with the session content' })
  @ApiBody({ type: PushDto })
  push(@CurrentUser() user: CognitoUser, @Body() dto: PushDto) {
    return this.notionSvc.pushPage(user.sub, dto.title, dto.blocks, dto.childrenMap, dto.parentPageId);
  }
}
