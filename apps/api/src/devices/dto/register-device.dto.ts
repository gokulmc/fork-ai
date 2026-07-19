import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsIn, MinLength, MaxLength } from 'class-validator';

export class RegisterDeviceDto {
  @ApiProperty({ description: 'APNs device push token' })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  token!: string;

  @ApiProperty({ enum: ['ios'], description: 'Device platform' })
  @IsIn(['ios'])
  platform!: 'ios';
}
