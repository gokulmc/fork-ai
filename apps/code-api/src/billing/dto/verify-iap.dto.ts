import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

export class VerifyIapDto {
  @ApiProperty({ description: 'StoreKit 2 signed transaction JWS from NativePurchases.purchaseProduct()' })
  @IsString()
  jws!: string;
}
