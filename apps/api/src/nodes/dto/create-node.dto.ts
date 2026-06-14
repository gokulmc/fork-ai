import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsIn, IsOptional, IsInt, IsBoolean, Min, Max, MinLength } from 'class-validator';
import { NodeKind } from '@/llm/llm.types';

export class CreateNodeDto {
  @ApiProperty({ enum: ['DEEPER', 'ASK'], description: 'DEEPER = expand a section; ASK = follow-up from highlight' })
  @IsIn(['DEEPER', 'ASK'])
  kind!: Extract<NodeKind, 'DEEPER' | 'ASK'>;

  @ApiProperty({ description: 'ID of the parent node' })
  @IsString()
  parentNodeId!: string;

  @ApiProperty({ description: 'ID of the parent section that triggered this branch' })
  @IsString()
  fromSection!: string;

  @ApiProperty({ description: 'For DEEPER: the section heading. For ASK: the user question.' })
  @IsString()
  @MinLength(1)
  query!: string;

  @ApiPropertyOptional({ description: 'For DEEPER: the section body text' })
  @IsOptional()
  @IsString()
  sectionBody?: string;

  @ApiPropertyOptional({ description: 'For ASK: the highlighted passage text' })
  @IsOptional()
  @IsString()
  highlightText?: string;

  @ApiPropertyOptional({ description: 'Max sections the LLM may return (4–8)', minimum: 4, maximum: 8 })
  @IsOptional()
  @IsInt()
  @Min(4)
  @Max(8)
  sectionCount?: number;

  @ApiPropertyOptional({ description: 'Enable live web search (max 3 searches)', example: false })
  @IsOptional()
  @IsBoolean()
  webSearch?: boolean;

  @ApiPropertyOptional({ description: 'Return one flowing essay instead of sections (ignores sectionCount)', example: false })
  @IsOptional()
  @IsBoolean()
  verbose?: boolean;

  @ApiPropertyOptional({ description: 'Retry of a length-limit Cut-Off: double the output budget (authenticated only)', example: false })
  @IsOptional()
  @IsBoolean()
  boost?: boolean;

  @ApiPropertyOptional({
    enum: ['haiku', 'sonnet', 'opus', 'gemini-pro', 'gemini-flash', 'gemini-flash-lite', 'deepseek-pro', 'deepseek-flash'],
    description: 'Branch model alias (default haiku; top tier clamped to mid for guests: opus→sonnet, gemini-pro→gemini-flash, deepseek-pro→deepseek-flash)',
  })
  @IsOptional()
  @IsIn(['haiku', 'sonnet', 'opus', 'gemini-pro', 'gemini-flash', 'gemini-flash-lite', 'deepseek-pro', 'deepseek-flash'])
  model?: 'haiku' | 'sonnet' | 'opus' | 'gemini-pro' | 'gemini-flash' | 'gemini-flash-lite' | 'deepseek-pro' | 'deepseek-flash';
}
