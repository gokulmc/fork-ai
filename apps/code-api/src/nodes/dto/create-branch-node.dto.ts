import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class CreateBranchNodeDto {
  @ApiProperty({ description: 'ID of the parent CODE node — the fork point' })
  @IsString()
  parentNodeId!: string;

  // Free text — nodes.service.ts's slugifyBranchName derives the actual
  // git-ref-safe branchName server-side (dedup'd against every branchName
  // already in the session), so no format constraint is needed here (#219).
  @ApiProperty({ description: 'Free-text branch title, slugified server-side into the git branch name', example: 'Retry logic for flaky uploads' })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  title!: string;
}
