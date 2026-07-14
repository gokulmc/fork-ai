import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsString, MinLength, MaxLength, IsOptional, IsBoolean, IsArray, ValidateNested } from 'class-validator';

export class OkrDto {
  @ApiPropertyOptional({ description: 'The objective', example: 'Ship the retry logic' })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  objective!: string;

  @ApiPropertyOptional({ description: 'Key results', example: ['p99 latency < 200ms', 'zero flaky test failures'] })
  @IsArray()
  @IsString({ each: true })
  keyResults!: string[];
}

export class UpdateNodeDto {
  @ApiPropertyOptional({ description: 'New title (≤5 words)', example: 'Backpropagation Deep Dive' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  title?: string;

  @ApiPropertyOptional({ description: 'Mark the node as starred/important' })
  @IsOptional()
  @IsBoolean()
  starred?: boolean;

  // Omit the field entirely to leave the node's okr unchanged — updateNode does
  // NOT null-strip (see root CLAUDE.md's Dynamoose null-handling note), so the
  // client must never send `okr: null` to clear it; there is no clear path yet.
  @ApiPropertyOptional({ description: 'Structured objective/key-results, fed into the agent prompt on every CODE run down this rail' })
  @IsOptional()
  @ValidateNested()
  @Type(() => OkrDto)
  okr?: OkrDto;
}
