import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsIn, IsOptional, IsInt, Min, Max, MinLength, MaxLength } from 'class-validator';
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
  @MaxLength(500)
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
}
