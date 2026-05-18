import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsIn, IsOptional, MinLength, MaxLength } from 'class-validator';
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
  @MinLength(2)
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
}
