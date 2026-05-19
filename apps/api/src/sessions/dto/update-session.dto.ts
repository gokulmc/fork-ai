import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, MinLength, MaxLength, IsOptional } from 'class-validator';

export class UpdateSessionDto {
  @ApiPropertyOptional({ description: 'New title for the session', example: 'Neural Networks' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  title?: string;

  @ApiPropertyOptional({ description: 'Notion page URL after export' })
  @IsOptional()
  @IsString()
  notionPageUrl?: string;
}
