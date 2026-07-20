import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsString, MinLength } from 'class-validator';

export class CreateDeviceDto {
  @ApiProperty({ description: 'APNs device push token' })
  @IsString()
  @MinLength(1)
  token!: string;

  @ApiProperty({ description: 'Device platform', enum: ['ios'] })
  @IsString()
  @IsIn(['ios'])
  platform!: 'ios';
}
