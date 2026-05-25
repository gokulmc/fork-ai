import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

export class VerifyPaymentDto {
  @ApiProperty() @IsString() orderId!: string;
  @ApiProperty() @IsString() paymentId!: string;
  @ApiProperty() @IsString() signature!: string;
}
