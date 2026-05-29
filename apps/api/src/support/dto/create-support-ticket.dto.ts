import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsEnum, IsString, MaxLength, MinLength } from 'class-validator';

export enum SupportSubject {
  Bug = 'Bug',
  Billing = 'Billing',
  Feature = 'Feature Request',
  Other = 'Other',
}

export class CreateSupportTicketDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @ApiProperty()
  @IsEmail()
  email!: string;

  @ApiProperty({ enum: SupportSubject })
  @IsEnum(SupportSubject)
  subject!: SupportSubject;

  @ApiProperty()
  @IsString()
  @MinLength(10)
  @MaxLength(2000)
  message!: string;
}
