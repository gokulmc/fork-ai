import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, MinLength, MaxLength, IsOptional, IsBoolean } from 'class-validator';

export class UpdateNodeDto {
  @ApiPropertyOptional({ description: 'New title (≤5 words)', example: 'Backpropagation Deep Dive' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  title?: string;

  @ApiPropertyOptional({ description: 'Mark the node as starred/important' })
  @IsOptional()
  @IsBoolean()
  starred?: boolean;
}
