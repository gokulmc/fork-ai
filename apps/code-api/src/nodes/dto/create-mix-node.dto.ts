import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsIn, IsOptional, IsInt, IsArray, IsBoolean, ArrayMaxSize, MinLength } from 'class-validator';

export class CreateMixNodeDto {
  @ApiProperty({ description: 'ID of the base node (A) — becomes parentId of the new MIX node' })
  @IsString()
  parentNodeId!: string;

  @ApiPropertyOptional({
    description: 'IDs of up to 5 additional nodes whose content will be synthesized (must not include parentNodeId). Optional for plan mode, where the base node alone may supply the source material.',
    maxItems: 5,
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5)
  @IsString({ each: true })
  sourceNodeIds?: string[];

  @ApiProperty({ description: 'User synthesis question — guides what the LLM focuses on' })
  @IsString()
  @MinLength(1)
  query!: string;

  @ApiPropertyOptional({ description: 'Max sections the LLM may return (4–8)', minimum: 4, maximum: 8 })
  @IsOptional()
  @IsInt()
  sectionCount?: number;

  @ApiPropertyOptional({ description: 'Synthesize an implementation PLAN node instead of a MIX node — base node and all sources must be learn nodes (QUERY/DEEPER/ASK/MIX)', example: false })
  @IsOptional()
  @IsBoolean()
  plan?: boolean;

  @ApiPropertyOptional({
    enum: ['haiku', 'sonnet', 'opus', 'gemini-pro', 'gemini-flash', 'gemini-flash-lite', 'deepseek-pro', 'deepseek-flash', 'glm', 'glm-air'],
    description: 'Branch model alias (default haiku)',
  })
  @IsOptional()
  @IsIn(['haiku', 'sonnet', 'opus', 'gemini-pro', 'gemini-flash', 'gemini-flash-lite', 'deepseek-pro', 'deepseek-flash', 'glm', 'glm-air'])
  model?: 'haiku' | 'sonnet' | 'opus' | 'gemini-pro' | 'gemini-flash' | 'gemini-flash-lite' | 'deepseek-pro' | 'deepseek-flash' | 'glm' | 'glm-air';
}
