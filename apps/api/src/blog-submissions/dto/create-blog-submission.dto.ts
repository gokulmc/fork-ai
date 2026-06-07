import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateBlogSubmissionDto {
  @ApiProperty()
  @IsString()
  @MinLength(4)
  @MaxLength(160)
  title!: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  summary?: string;

  @ApiProperty({ description: 'Markdown body' })
  @IsString()
  @MinLength(50)
  @MaxLength(40000)
  body!: string;
}
