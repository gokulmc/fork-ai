import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsIn, IsOptional, IsBoolean, IsInt, Min, Max, MinLength, MaxLength } from 'class-validator';

// Builds a whole mind-map session from an uploaded document. The client extracts
// plain text (PDF/text) and sends it here; the server reads it once, designs the
// tree, then generates each node's content root→leaf. See SessionsService.createDocumentStreaming.
export class CreateDocumentDto {
  @ApiProperty({ description: 'Plain text extracted from the uploaded PDF/text file' })
  @IsString()
  @MinLength(1)
  @MaxLength(60000)
  documentText!: string;

  @ApiPropertyOptional({ description: 'Original file name, used as the placeholder title until extraction lands' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  fileName?: string;

  @ApiPropertyOptional({ description: 'Max sections per node (1–8)', minimum: 1, maximum: 8 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(8)
  sectionCount?: number;

  @ApiPropertyOptional({ description: 'Max nodes in the generated tree (2–10)', minimum: 2, maximum: 10 })
  @IsOptional()
  @IsInt()
  @Min(2)
  @Max(10)
  maxNodes?: number;

  @ApiPropertyOptional({ description: 'Enable live web search on per-node content calls (max 3 searches)', example: false })
  @IsOptional()
  @IsBoolean()
  webSearch?: boolean;

  @ApiPropertyOptional({ description: 'Return one flowing essay per node instead of sections (ignores sectionCount)', example: false })
  @IsOptional()
  @IsBoolean()
  verbose?: boolean;

  @ApiPropertyOptional({
    enum: ['haiku', 'sonnet', 'opus', 'gemini-pro', 'gemini-flash', 'gemini-flash-lite', 'deepseek-pro', 'deepseek-flash', 'glm', 'glm-air'],
    description: 'Per-node content model alias (default haiku). Document extraction always runs on Sonnet.',
  })
  @IsOptional()
  @IsIn(['haiku', 'sonnet', 'opus', 'gemini-pro', 'gemini-flash', 'gemini-flash-lite', 'deepseek-pro', 'deepseek-flash', 'glm', 'glm-air'])
  model?: 'haiku' | 'sonnet' | 'opus' | 'gemini-pro' | 'gemini-flash' | 'gemini-flash-lite' | 'deepseek-pro' | 'deepseek-flash' | 'glm' | 'glm-air';
}
