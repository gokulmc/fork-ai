import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength, MaxLength } from 'class-validator';

export class UpdateNodeDto {
  @ApiProperty({ description: 'New title (≤5 words)', example: 'Backpropagation Deep Dive' })
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  title!: string;
}
