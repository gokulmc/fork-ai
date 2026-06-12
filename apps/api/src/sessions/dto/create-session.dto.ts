import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, MinLength, IsOptional, IsBoolean, IsInt, Min, Max } from 'class-validator';

export class CreateSessionDto {
  @ApiProperty({ description: 'The root research query', example: 'How do neural networks learn?' })
  @IsString()
  @MinLength(1)
  query!: string;

  @ApiPropertyOptional({ description: 'Override section count (default 5, max 8)', example: 5 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(8)
  sectionCount?: number;

  @ApiPropertyOptional({ description: 'Enable live web search (max 3 searches)', example: false })
  @IsOptional()
  @IsBoolean()
  webSearch?: boolean;
}
