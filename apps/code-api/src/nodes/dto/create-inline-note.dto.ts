import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsIn, IsOptional, IsInt, IsBoolean, Min, MinLength } from 'class-validator';

// "Explain" — a highlight-anchored alternative to "Branch" (#237 Phase 1b): a
// very short answer attached to the highlighted passage itself (as a
// HighlightItem.note) instead of spawning a child node. See NodesService.createInlineNote.
export class CreateInlineNoteDto {
  @ApiProperty({ description: 'ID of the node the highlight is in' })
  @IsString()
  nodeId!: string;

  @ApiProperty({ description: 'ID of the section the highlight is in' })
  @IsString()
  sectionId!: string;

  @ApiProperty({ description: 'The highlighted passage text' })
  @IsString()
  @MinLength(1)
  text!: string;

  @ApiProperty({ description: 'Character offset of highlight start in the section rendered plain text' })
  @IsInt()
  @Min(0)
  start!: number;

  @ApiProperty({ description: 'Character offset of highlight end in the section rendered plain text' })
  @IsInt()
  @Min(0)
  end!: number;

  @ApiProperty({ description: 'The question asked about the highlighted passage' })
  @IsString()
  @MinLength(1)
  question!: string;

  @ApiPropertyOptional({ description: 'Enable live web search (max 3 searches)', example: false })
  @IsOptional()
  @IsBoolean()
  webSearch?: boolean;

  @ApiPropertyOptional({
    enum: ['haiku', 'sonnet', 'opus', 'gemini-pro', 'gemini-flash', 'gemini-flash-lite', 'deepseek-pro', 'deepseek-flash', 'glm', 'glm-air'],
    description: 'Branch model alias (default haiku; top tier clamped to mid for guests: opus→sonnet, gemini-pro→gemini-flash, deepseek-pro→deepseek-flash, glm→glm-air)',
  })
  @IsOptional()
  @IsIn(['haiku', 'sonnet', 'opus', 'gemini-pro', 'gemini-flash', 'gemini-flash-lite', 'deepseek-pro', 'deepseek-flash', 'glm', 'glm-air'])
  model?: 'haiku' | 'sonnet' | 'opus' | 'gemini-pro' | 'gemini-flash' | 'gemini-flash-lite' | 'deepseek-pro' | 'deepseek-flash' | 'glm' | 'glm-air';
}
