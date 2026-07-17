import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsOptional, IsString, MaxLength, MinLength, ValidateNested } from 'class-validator';

// A composer-attached text file (or a Groq-described image, same shape) —
// feeds the agent/LLM prompt only (see buildPrompt in mock-agent.service.ts,
// and attachmentsBlockOf for the DEEPER/ASK path in create-node.dto.ts).
// Never persisted on the NodeItem, so the Dynamoose saveUnknown:false
// stripping (root CLAUDE.md) doesn't apply.
export class AttachmentDto {
  @ApiProperty({ description: 'File name (display only)', minLength: 1, maxLength: 200 })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;

  @ApiProperty({ description: 'File contents (plain text, read client-side)', maxLength: 65536 })
  @IsString()
  @MaxLength(65536)
  content!: string;
}

export class CreateCodeNodeDto {
  @ApiProperty({ description: 'ID of the parent node — PLAN, CODE, or BRANCH' })
  @IsString()
  parentNodeId!: string;

  @ApiProperty({ description: 'Natural-language instruction for the coding agent', minLength: 1, maxLength: 10000 })
  @IsString()
  @MinLength(1)
  @MaxLength(10000)
  instruction!: string;

  @ApiPropertyOptional({
    enum: ['haiku', 'sonnet', 'opus', 'gemini-pro', 'gemini-flash', 'gemini-flash-lite', 'deepseek-pro', 'deepseek-flash', 'glm', 'glm-air'],
    description: 'Branch model alias (default haiku)',
  })
  @IsOptional()
  @IsIn(['haiku', 'sonnet', 'opus', 'gemini-pro', 'gemini-flash', 'gemini-flash-lite', 'deepseek-pro', 'deepseek-flash', 'glm', 'glm-air'])
  model?: 'haiku' | 'sonnet' | 'opus' | 'gemini-pro' | 'gemini-flash' | 'gemini-flash-lite' | 'deepseek-pro' | 'deepseek-flash' | 'glm' | 'glm-air';

  @ApiPropertyOptional({ description: 'Small text-file attachments from the composer, appended to the agent prompt', type: [AttachmentDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(3)
  @ValidateNested({ each: true })
  @Type(() => AttachmentDto)
  attachments?: AttachmentDto[];

  // 'local' is deliberately excluded — desktop local runs go through the
  // (future) ingestion API, never this route. 'cloud' = Fly, 'blaxel' = Blaxel
  // (both real billed sandboxes; see runner-registry isCloud).
  @ApiPropertyOptional({ enum: ['cloud', 'mock', 'blaxel'], description: 'Execution environment for this run (default: server-configured AGENT_RUNNER)' })
  @IsOptional()
  @IsIn(['cloud', 'mock', 'blaxel'])
  environment?: 'cloud' | 'mock' | 'blaxel';
}
