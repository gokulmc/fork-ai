import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength, MaxLength } from 'class-validator';

export class UpdateSessionDto {
  @ApiProperty({ description: 'New title for the session', example: 'Neural Networks' })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  title!: string;
}
