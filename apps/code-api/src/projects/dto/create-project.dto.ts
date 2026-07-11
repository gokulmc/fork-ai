import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsString, MaxLength, MinLength, ValidateNested } from 'class-validator';

// Plugin ids a Project may enable. Kept as a plain array (not an enum) so it's
// easy to reuse both as the class-validator allowlist and the Swagger enum.
export const ALLOWED_PLUGINS = ['mem-palace', 'graphify', 'playwright-testing'] as const;
export type PluginName = (typeof ALLOWED_PLUGINS)[number];

class RepoRefDto {
  @ApiProperty({ enum: ['github-mock', 'github'], description: 'Repo provider — github-mock is a synthesized fixture, github is a real linked repo' })
  @IsIn(['github-mock', 'github'])
  provider!: 'github-mock' | 'github';

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
}
