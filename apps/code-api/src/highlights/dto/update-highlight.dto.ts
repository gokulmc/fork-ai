import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional } from 'class-validator';

export class UpdateHighlightDto {
  @ApiPropertyOptional({ description: 'New background colour hex, null to clear' })
  @IsOptional()
  @IsString()
  bg?: string | null;

  @ApiPropertyOptional({ description: 'New foreground colour hex, null to use default' })
  @IsOptional()
  @IsString()
  fg?: string | null;

  @ApiPropertyOptional({ description: 'New Explain note text' })
  @IsOptional()
  @IsString()
  note?: string;

  @ApiPropertyOptional({ description: 'New question that produced `note`' })
  @IsOptional()
  @IsString()
  noteQuestion?: string;
}
