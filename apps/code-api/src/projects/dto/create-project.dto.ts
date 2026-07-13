import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsOptional, IsString, MaxLength, MinLength, ValidateNested } from 'class-validator';
import { ALLOWED_PLUGINS } from '../plugin-catalog';

// Re-exported so existing importers of the allowlist from this DTO module keep
// working — the catalog (id/name/icon/instruction) now lives in plugin-catalog.ts.
export { ALLOWED_PLUGINS };

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

  // Only meaningful for provider 'github' — read client-side off the GitHub
  // API's own `private` field (see GithubService.listRepos) at repo-pick time
  // rather than re-fetched server-side; the frontend already has it in hand
  // from the same /github/repos call that populated the picker.
  @ApiPropertyOptional({ description: 'Whether this GitHub repo is private — gates whether a cloud run needs a GitHub App installation token to clone it' })
  @IsOptional()
  @IsBoolean()
  private?: boolean;
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
