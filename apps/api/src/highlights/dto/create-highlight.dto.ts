import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional, MinLength } from 'class-validator';

export class CreateHighlightDto {
  @ApiProperty({ description: 'ID of the node this highlight belongs to' })
  @IsString()
  nodeId!: string;

  @ApiProperty({ description: 'ID of the section this highlight belongs to' })
  @IsString()
  sectionId!: string;

  @ApiProperty({ description: 'The highlighted passage text' })
  @IsString()
  @MinLength(1)
  text!: string;

  @ApiPropertyOptional({ description: 'Background colour hex (e.g. #fef08a), null to clear' })
  @IsOptional()
  @IsString()
  bg?: string | null;

  @ApiPropertyOptional({ description: 'Foreground colour hex, null to use default' })
  @IsOptional()
  @IsString()
  fg?: string | null;
}
