import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches, MaxLength, MinLength } from 'class-validator';

// Git-ref-safe: letters, numbers, dots, underscores, hyphens, slashes only.
const BRANCH_NAME_RE = /^[A-Za-z0-9._/-]+$/;

export class CreateBranchNodeDto {
  @ApiProperty({ description: 'ID of the parent CODE node — the fork point' })
  @IsString()
  parentNodeId!: string;

  @ApiProperty({ description: 'Git-ref-safe branch name', example: 'feature/retry-logic' })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  @Matches(BRANCH_NAME_RE, { message: 'branchName must contain only letters, numbers, dots, underscores, hyphens, and slashes' })
  branchName!: string;
}
