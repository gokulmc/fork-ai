import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, MinLength, MaxLength, IsOptional, IsBoolean } from 'class-validator';

export class CreateSessionDto {
  @ApiProperty({ description: 'The root research query', example: 'How do neural networks learn?' })
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  query!: string;

  @ApiPropertyOptional({ description: 'Override section count (default 5)', example: 5 })
  @IsOptional()
  sectionCount?: number;

  @ApiPropertyOptional({ description: 'Enable live web search (max 3 searches)', example: false })
  @IsOptional()
  @IsBoolean()
  webSearch?: boolean;
}
