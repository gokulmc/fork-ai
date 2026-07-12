import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsOptional, IsString, MaxLength, MinLength, ValidateNested } from 'class-validator';

// Plugin ids a Project may enable. Kept as a plain array (not an enum) so it's
// easy to reuse both as the class-validator allowlist and the Swagger enum.
export const ALLOWED_PLUGINS = ['mem-palace', 'graphify', 'playwright-testing'] as const;
export type PluginName = (typeof ALLOWED_PLUGINS)[number];

class RepoRefDto {
  @ApiProperty({ enum: ['github-mock', 'github', 'new'], description: 'Repo provider — github-mock is a synthesized fixture, github is a real linked repo, new is a from-scratch project with no repo yet' })
  @IsIn(['github-mock', 'github', 'new'])
  provider!: 'github-mock' | 'github' | 'new';

  @ApiProperty({ description: 'Repo owner/org' })
  @IsString()
  @MinLength(1)
  owner!: string;

  @ApiProperty({ description: 'Repo name' })
  @IsString()
  @MinLength(1)
  repo!: string;

  @ApiProperty({ description: 'Default branch name' })
  @IsString()
  @MinLength(1)
  defaultBranch!: string;

  @ApiProperty({ description: 'Repo URL' })
  @IsString()
  @MinLength(1)
  url!: string;
}

export class CreateProjectDto {
  @ApiProperty({ description: 'Project display name' })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;

  @ApiProperty({ description: 'Repo reference the project is scoped to', type: RepoRefDto })
  @ValidateNested()
  @Type(() => RepoRefDto)
  repoRef!: RepoRefDto;

  @ApiProperty({ description: 'Enabled plugin ids', type: [String], enum: ALLOWED_PLUGINS })
  @IsArray()
  @ArrayMaxSize(ALLOWED_PLUGINS.length)
  @IsIn(ALLOWED_PLUGINS, { each: true })
  plugins!: string[];

  // Only meaningful for provider 'new' — the opening question that seeds the
  // project's BRANCH root and streams in as its first answer right after
  // creation (see SessionsService.createProjectSession / createRootNodeStreaming).
  @ApiProperty({ description: 'Opening question for a from-scratch (provider "new") project — seeds the BRANCH root', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  rootQuery?: string;
}
