import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, Matches } from 'class-validator';

export class DescribeImageDto {
  @ApiProperty({ description: 'data:image/(png|jpeg|jpg|webp);base64,... URI of the uploaded image' })
  @IsString()
  @IsNotEmpty()
  @Matches(/^data:image\/(png|jpe?g|webp);base64,/, { message: 'dataUrl must be a base64 data:image/(png|jpeg|jpg|webp) URI' })
  dataUrl!: string;
}
