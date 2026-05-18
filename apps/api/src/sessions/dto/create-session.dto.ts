import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, MinLength, MaxLength, IsOptional } from 'class-validator';

export class CreateSessionDto {
  @ApiProperty({ description: 'The root research query', example: 'How do neural networks learn?' })
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  query!: string;

  @ApiPropertyOptional({ description: 'Override section count (default 5)', example: 5 })
  @IsOptional()
  sectionCount?: number;
}
