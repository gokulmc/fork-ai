import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsIn, IsOptional, IsInt, IsArray, ArrayMinSize, ArrayMaxSize, MinLength } from 'class-validator';

export class CreateMixNodeDto {
  @ApiProperty({ description: 'ID of the base node (A) — becomes parentId of the new MIX node' })
  @IsString()
  parentNodeId!: string;

  @ApiProperty({
    description: 'IDs of 1–5 additional nodes whose content will be synthesized (must not include parentNodeId)',
    minItems: 1,
    maxItems: 5,
    type: [String],
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(5)
  @IsString({ each: true })
  sourceNodeIds!: string[];

  @ApiProperty({ description: 'User synthesis question — guides what the LLM focuses on' })
  @IsString()
  @MinLength(1)
  query!: string;

  @ApiPropertyOptional({ description: 'Max sections the LLM may return (4–8)', minimum: 4, maximum: 8 })
  @IsOptional()
  @IsInt()
  sectionCount?: number;

  @ApiPropertyOptional({
    enum: ['haiku', 'sonnet', 'opus', 'gemini-pro', 'gemini-flash', 'gemini-flash-lite', 'deepseek-pro', 'deepseek-flash', 'glm', 'glm-air'],
    description: 'Branch model alias (default haiku)',
  })
  @IsOptional()
  @IsIn(['haiku', 'sonnet', 'opus', 'gemini-pro', 'gemini-flash', 'gemini-flash-lite', 'deepseek-pro', 'deepseek-flash', 'glm', 'glm-air'])
  model?: 'haiku' | 'sonnet' | 'opus' | 'gemini-pro' | 'gemini-flash' | 'gemini-flash-lite' | 'deepseek-pro' | 'deepseek-flash' | 'glm' | 'glm-air';
}
