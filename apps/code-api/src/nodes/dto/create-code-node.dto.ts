import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsIn, IsOptional, MaxLength, MinLength } from 'class-validator';

export class CreateCodeNodeDto {
  @ApiProperty({ description: 'ID of the parent node — PLAN, CODE, or BRANCH' })
  @IsString()
  parentNodeId!: string;

  @ApiProperty({ description: 'Natural-language instruction for the coding agent', minLength: 1, maxLength: 2000 })
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  instruction!: string;

  @ApiPropertyOptional({
    enum: ['haiku', 'sonnet', 'opus', 'gemini-pro', 'gemini-flash', 'gemini-flash-lite', 'deepseek-pro', 'deepseek-flash', 'glm', 'glm-air'],
    description: 'Branch model alias (default haiku)',
  })
  @IsOptional()
  @IsIn(['haiku', 'sonnet', 'opus', 'gemini-pro', 'gemini-flash', 'gemini-flash-lite', 'deepseek-pro', 'deepseek-flash', 'glm', 'glm-air'])
  model?: 'haiku' | 'sonnet' | 'opus' | 'gemini-pro' | 'gemini-flash' | 'gemini-flash-lite' | 'deepseek-pro' | 'deepseek-flash' | 'glm' | 'glm-air';
}
